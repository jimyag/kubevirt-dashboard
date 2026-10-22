// Package helm serves Helm release management for the dashboard: list, inspect, install, upgrade
// (edit values), roll back and uninstall releases in the cluster of the request's kube context.
// Release state lives in the cluster as Helm's own release Secrets, so the dashboard and the helm
// CLI see the same releases.
package helm

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/chart"
	"helm.sh/helm/v3/pkg/chart/loader"
	"helm.sh/helm/v3/pkg/cli"
	"helm.sh/helm/v3/pkg/getter"
	"helm.sh/helm/v3/pkg/registry"
	"helm.sh/helm/v3/pkg/release"
	"helm.sh/helm/v3/pkg/releaseutil"
	"helm.sh/helm/v3/pkg/repo"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/discovery/cached/memory"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/restmapper"
	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
	"sigs.k8s.io/yaml"
)

// RESTConfigFunc returns the REST config of the kube context a request targets.
type RESTConfigFunc func(r *http.Request) (*rest.Config, error)

type handler struct {
	restConfig RESTConfigFunc
	settings   *cli.EnvSettings
}

// Register adds the /api/v1/helm endpoints to mux.
func Register(mux *http.ServeMux, restConfig RESTConfigFunc) {
	h := &handler{restConfig: restConfig, settings: newSettings()}
	mux.HandleFunc("GET /api/v1/helm/releases", h.list)
	mux.HandleFunc("POST /api/v1/helm/releases", h.install)
	mux.HandleFunc("GET /api/v1/helm/releases/{namespace}/{name}", h.get)
	mux.HandleFunc("PUT /api/v1/helm/releases/{namespace}/{name}", h.upgrade)
	mux.HandleFunc("DELETE /api/v1/helm/releases/{namespace}/{name}", h.uninstall)
	mux.HandleFunc("GET /api/v1/helm/releases/{namespace}/{name}/history", h.history)
	mux.HandleFunc("GET /api/v1/helm/releases/{namespace}/{name}/resources", h.resources)
	mux.HandleFunc("POST /api/v1/helm/releases/{namespace}/{name}/rollback", h.rollback)
	mux.HandleFunc("GET /api/v1/helm/chart", h.chartInfo)
}

// newSettings keeps Helm's repository cache and registry config in a private directory, so the
// dashboard neither needs nor touches the user's ~/.config/helm.
func newSettings() *cli.EnvSettings {
	settings := cli.New()
	base := filepath.Join(os.TempDir(), "kubevirt-dashboard-helm")
	settings.RepositoryCache = filepath.Join(base, "cache")
	settings.RepositoryConfig = filepath.Join(base, "repositories.yaml")
	settings.RegistryConfig = filepath.Join(base, "registry.json")
	return settings
}

// --- Kubernetes access ---

// restGetter adapts a rest.Config to the RESTClientGetter Helm expects.
type restGetter struct {
	config    *rest.Config
	namespace string
}

func (g *restGetter) ToRESTConfig() (*rest.Config, error) { return rest.CopyConfig(g.config), nil }

func (g *restGetter) ToDiscoveryClient() (discovery.CachedDiscoveryInterface, error) {
	client, err := discovery.NewDiscoveryClientForConfig(g.config)
	if err != nil {
		return nil, err
	}
	return memory.NewMemCacheClient(client), nil
}

func (g *restGetter) ToRESTMapper() (meta.RESTMapper, error) {
	client, err := g.ToDiscoveryClient()
	if err != nil {
		return nil, err
	}
	mapper := restmapper.NewDeferredDiscoveryRESTMapper(client)
	return restmapper.NewShortcutExpander(mapper, client, nil), nil
}

// ToRawKubeConfigLoader only has to report the namespace; Helm uses it as the default namespace.
func (g *restGetter) ToRawKubeConfigLoader() clientcmd.ClientConfig {
	return clientcmd.NewDefaultClientConfig(*clientcmdapi.NewConfig(), &clientcmd.ConfigOverrides{Context: clientcmdapi.Context{Namespace: g.namespace}})
}

func (h *handler) configuration(r *http.Request, namespace string) (*action.Configuration, error) {
	restConfig, err := h.restConfig(r)
	if err != nil {
		return nil, err
	}
	cfg := new(action.Configuration)
	if err := cfg.Init(&restGetter{config: restConfig, namespace: namespace}, namespace, "secret", log.Printf); err != nil {
		return nil, err
	}
	registryClient, err := registry.NewClient(registry.ClientOptCredentialsFile(h.settings.RegistryConfig))
	if err != nil {
		return nil, err
	}
	cfg.RegistryClient = registryClient
	return cfg, nil
}

// --- Responses ---

type releaseSummary struct {
	Name         string `json:"name"`
	Namespace    string `json:"namespace"`
	Revision     int    `json:"revision"`
	Status       string `json:"status"`
	Chart        string `json:"chart"`
	ChartVersion string `json:"chartVersion"`
	AppVersion   string `json:"appVersion"`
	Updated      string `json:"updated"`
	Description  string `json:"description"`
}

type releaseDetail struct {
	releaseSummary
	// Where the chart comes from, when known; needed to change values of charts with subcharts.
	Source *chartSource `json:"source,omitempty"`
	// Values supplied by the user, as YAML; what an upgrade from the dashboard replaces.
	Values string `json:"values"`
	// Values of the chart itself, as YAML, for reference while editing.
	ChartValues string            `json:"chartValues"`
	Manifest    string            `json:"manifest"`
	Notes       string            `json:"notes"`
	ChartInfo   chartMetadataInfo `json:"chartInfo"`
}

type chartMetadataInfo struct {
	Description string   `json:"description"`
	Home        string   `json:"home"`
	Sources     []string `json:"sources"`
	Icon        string   `json:"icon"`
}

func summarize(rel *release.Release) releaseSummary {
	summary := releaseSummary{Name: rel.Name, Namespace: rel.Namespace, Revision: rel.Version}
	if rel.Info != nil {
		summary.Status = rel.Info.Status.String()
		summary.Description = rel.Info.Description
		if !rel.Info.LastDeployed.IsZero() {
			summary.Updated = rel.Info.LastDeployed.UTC().Format(time.RFC3339)
		}
	}
	if rel.Chart != nil && rel.Chart.Metadata != nil {
		summary.Chart = rel.Chart.Metadata.Name
		summary.ChartVersion = rel.Chart.Metadata.Version
		summary.AppVersion = rel.Chart.Metadata.AppVersion
	}
	return summary
}

func toYAML(values map[string]interface{}) string {
	if len(values) == 0 {
		return ""
	}
	out, err := yaml.Marshal(values)
	if err != nil {
		return ""
	}
	return string(out)
}

func chartValuesYAML(c *chart.Chart) string {
	for _, file := range c.Raw {
		if file.Name == "values.yaml" {
			return string(file.Data)
		}
	}
	return toYAML(c.Values)
}

func writeJSON(w http.ResponseWriter, status int, body interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// writeError answers with a Kubernetes-style Status body, which the UI already knows how to show.
func writeError(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]interface{}{"kind": "Status", "status": "Failure", "message": err.Error(), "code": status})
}

func parseValues(text string) (map[string]interface{}, error) {
	values := map[string]interface{}{}
	if strings.TrimSpace(text) == "" {
		return values, nil
	}
	if err := yaml.Unmarshal([]byte(text), &values); err != nil {
		return nil, fmt.Errorf("values are not valid YAML: %w", err)
	}
	return values, nil
}

// --- Chart sources ---

// Helm does not keep a chart's subcharts in the release record, so changing values needs the chart
// again. The dashboard remembers where it installed each release from in one ConfigMap per namespace.
const sourcesConfigMap = "kubevirt-dashboard-helm-sources"

func (h *handler) clientset(r *http.Request) (kubernetes.Interface, error) {
	config, err := h.restConfig(r)
	if err != nil {
		return nil, err
	}
	return kubernetes.NewForConfig(config)
}

func (h *handler) readSource(r *http.Request, namespace, name string) *chartSource {
	client, err := h.clientset(r)
	if err != nil {
		return nil
	}
	cm, err := client.CoreV1().ConfigMaps(namespace).Get(r.Context(), sourcesConfigMap, metav1.GetOptions{})
	if err != nil {
		return nil
	}
	var source chartSource
	if json.Unmarshal([]byte(cm.Data[name]), &source) != nil || source.Chart == "" {
		return nil
	}
	return &source
}

// writeSource records (or with nil, forgets) where a release's chart comes from.
func (h *handler) writeSource(r *http.Request, namespace, name string, source *chartSource) error {
	client, err := h.clientset(r)
	if err != nil {
		return err
	}
	configMaps := client.CoreV1().ConfigMaps(namespace)
	cm, err := configMaps.Get(r.Context(), sourcesConfigMap, metav1.GetOptions{})
	if apierrors.IsNotFound(err) {
		if source == nil {
			return nil
		}
		cm = &corev1.ConfigMap{ObjectMeta: metav1.ObjectMeta{Name: sourcesConfigMap, Namespace: namespace, Labels: map[string]string{"app.kubernetes.io/managed-by": "kubevirt-dashboard"}}}
		cm, err = configMaps.Create(r.Context(), cm, metav1.CreateOptions{})
	}
	if err != nil {
		return err
	}
	if cm.Data == nil {
		cm.Data = map[string]string{}
	}
	if source == nil {
		delete(cm.Data, name)
	} else {
		data, _ := json.Marshal(source)
		cm.Data[name] = string(data)
	}
	_, err = configMaps.Update(r.Context(), cm, metav1.UpdateOptions{})
	return err
}

// errSourceRequired tells the UI to ask where the chart comes from.
var errSourceRequired = errors.New("this chart has subcharts, which Helm does not keep in the release; enter the chart repository to change its values")

// --- Handlers ---

func (h *handler) list(w http.ResponseWriter, r *http.Request) {
	namespace := r.URL.Query().Get("namespace")
	cfg, err := h.configuration(r, namespace)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	list := action.NewList(cfg)
	list.AllNamespaces = namespace == ""
	list.All = true
	list.SetStateMask()
	releases, err := list.Run()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	items := make([]releaseSummary, 0, len(releases))
	for _, rel := range releases {
		items = append(items, summarize(rel))
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].Namespace != items[j].Namespace {
			return items[i].Namespace < items[j].Namespace
		}
		return items[i].Name < items[j].Name
	})
	writeJSON(w, http.StatusOK, map[string]interface{}{"items": items})
}

func (h *handler) get(w http.ResponseWriter, r *http.Request) {
	namespace, name := r.PathValue("namespace"), r.PathValue("name")
	cfg, err := h.configuration(r, namespace)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	rel, err := action.NewGet(cfg).Run(name)
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	detail := releaseDetail{releaseSummary: summarize(rel), Values: toYAML(rel.Config), Manifest: rel.Manifest, Source: h.readSource(r, namespace, name)}
	if rel.Info != nil {
		detail.Notes = rel.Info.Notes
	}
	if rel.Chart != nil {
		detail.ChartValues = chartValuesYAML(rel.Chart)
		if rel.Chart.Metadata != nil {
			detail.ChartInfo = chartMetadataInfo{Description: rel.Chart.Metadata.Description, Home: rel.Chart.Metadata.Home, Sources: rel.Chart.Metadata.Sources, Icon: rel.Chart.Metadata.Icon}
		}
	}
	writeJSON(w, http.StatusOK, detail)
}

func (h *handler) history(w http.ResponseWriter, r *http.Request) {
	namespace, name := r.PathValue("namespace"), r.PathValue("name")
	cfg, err := h.configuration(r, namespace)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	history := action.NewHistory(cfg)
	history.Max = 50
	releases, err := history.Run(name)
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	items := make([]releaseSummary, 0, len(releases))
	for _, rel := range releases {
		items = append(items, summarize(rel))
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Revision > items[j].Revision })
	writeJSON(w, http.StatusOK, map[string]interface{}{"items": items})
}

// releaseResource is one object of a release's manifest and its live state in the cluster.
type releaseResource struct {
	APIVersion string `json:"apiVersion"`
	Kind       string `json:"kind"`
	Namespace  string `json:"namespace,omitempty"`
	Name       string `json:"name"`
	// Plural resource name from discovery; empty when the cluster does not serve the kind.
	Resource string `json:"resource,omitempty"`
	Exists   bool   `json:"exists"`
	// Status summary for the status dot ("Ready", "Running", "Missing", ...) and a detail such as "2/3".
	Status  string `json:"status"`
	Detail  string `json:"detail,omitempty"`
	Created string `json:"created,omitempty"`
}

// resources lists the objects of the release's current manifest with their live status, so the
// console can show what a release owns and link to each object.
func (h *handler) resources(w http.ResponseWriter, r *http.Request) {
	namespace, name := r.PathValue("namespace"), r.PathValue("name")
	cfg, err := h.configuration(r, namespace)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	rel, err := action.NewGet(cfg).Run(name)
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	restConfig, err := h.restConfig(r)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	getter := &restGetter{config: restConfig, namespace: namespace}
	mapper, err := getter.ToRESTMapper()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	client, err := dynamic.NewForConfig(restConfig)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	items := []releaseResource{}
	for _, manifest := range releaseutil.SplitManifests(rel.Manifest) {
		var head unstructured.Unstructured
		if err := yaml.Unmarshal([]byte(manifest), &head.Object); err != nil || head.Object == nil || head.GetKind() == "" {
			continue
		}
		item := releaseResource{APIVersion: head.GetAPIVersion(), Kind: head.GetKind(), Name: head.GetName(), Status: "Unknown"}
		mapping, err := mapper.RESTMapping(schema.FromAPIVersionAndKind(item.APIVersion, item.Kind).GroupKind(), schema.FromAPIVersionAndKind(item.APIVersion, item.Kind).Version)
		if err != nil {
			item.Namespace = head.GetNamespace()
			items = append(items, item)
			continue
		}
		item.Resource = mapping.Resource.Resource
		var resource dynamic.ResourceInterface = client.Resource(mapping.Resource)
		if mapping.Scope.Name() == meta.RESTScopeNameNamespace {
			item.Namespace = head.GetNamespace()
			if item.Namespace == "" {
				item.Namespace = namespace
			}
			resource = client.Resource(mapping.Resource).Namespace(item.Namespace)
		}
		live, err := resource.Get(r.Context(), item.Name, metav1.GetOptions{})
		switch {
		case apierrors.IsNotFound(err):
			item.Status = "Missing"
		case err != nil:
			item.Status = "Unknown"
			item.Detail = err.Error()
		default:
			item.Exists = true
			item.Created = live.GetCreationTimestamp().UTC().Format(time.RFC3339)
			item.Status, item.Detail = objectStatus(live)
		}
		items = append(items, item)
	}
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].Kind != items[j].Kind {
			return items[i].Kind < items[j].Kind
		}
		return items[i].Name < items[j].Name
	})
	writeJSON(w, http.StatusOK, map[string]interface{}{"items": items})
}

// objectStatus summarizes the common kinds; others report their Ready condition or just exist.
func objectStatus(obj *unstructured.Unstructured) (string, string) {
	num := func(fields ...string) int64 {
		value, _, _ := unstructured.NestedInt64(obj.Object, fields...)
		return value
	}
	ratio := func(ready, want int64) (string, string) {
		detail := fmt.Sprintf("%d/%d", ready, want)
		if ready >= want {
			return "Ready", detail
		}
		return "Progressing", detail
	}
	switch obj.GetKind() {
	case "Deployment", "StatefulSet", "ReplicaSet":
		want, found, _ := unstructured.NestedInt64(obj.Object, "spec", "replicas")
		if !found {
			want = 1
		}
		return ratio(num("status", "readyReplicas"), want)
	case "DaemonSet":
		return ratio(num("status", "numberReady"), num("status", "desiredNumberScheduled"))
	case "Job":
		if num("status", "succeeded") > 0 {
			return "Complete", ""
		}
		if num("status", "failed") > 0 {
			return "Failed", ""
		}
		return "Running", ""
	}
	if phase, _, _ := unstructured.NestedString(obj.Object, "status", "phase"); phase != "" {
		return phase, ""
	}
	conditions, _, _ := unstructured.NestedSlice(obj.Object, "status", "conditions")
	for _, condition := range conditions {
		c, _ := condition.(map[string]interface{})
		if c["type"] == "Ready" || c["type"] == "Available" {
			if c["status"] == "True" {
				return "Ready", ""
			}
			reason, _ := c["reason"].(string)
			return "NotReady", reason
		}
	}
	return "Exists", ""
}

// chartSource names a chart in an HTTP repository (repo + chart) or an OCI registry
// (repo "oci://registry/path" + chart).
type chartSource struct {
	Repo    string `json:"repo"`
	Chart   string `json:"chart"`
	Version string `json:"version"`
}

func (s chartSource) isOCI() bool { return registry.IsOCI(s.Repo) }

func (s chartSource) ref() string {
	if s.isOCI() {
		return strings.TrimSuffix(s.Repo, "/") + "/" + s.Chart
	}
	return s.Chart
}

// loadChart downloads (or reuses from the cache) and loads a chart.
func (h *handler) loadChart(cfg *action.Configuration, source chartSource) (*chart.Chart, error) {
	if source.Chart == "" {
		return nil, errors.New("chart is required")
	}
	options := action.ChartPathOptions{Version: source.Version}
	if !source.isOCI() {
		options.RepoURL = source.Repo
	}
	install := action.NewInstall(cfg)
	install.ChartPathOptions = options
	install.SetRegistryClient(cfg.RegistryClient)
	path, err := install.LocateChart(source.ref(), h.settings)
	if err != nil {
		return nil, err
	}
	return loader.Load(path)
}

type installRequest struct {
	chartSource
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	Values    string `json:"values"`
}

func (h *handler) install(w http.ResponseWriter, r *http.Request) {
	var req installRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if req.Namespace == "" || req.Name == "" {
		writeError(w, http.StatusBadRequest, errors.New("namespace and name are required"))
		return
	}
	values, err := parseValues(req.Values)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	cfg, err := h.configuration(r, req.Namespace)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	chrt, err := h.loadChart(cfg, req.chartSource)
	if err != nil {
		writeError(w, http.StatusBadGateway, fmt.Errorf("load chart: %w", err))
		return
	}
	install := action.NewInstall(cfg)
	install.ReleaseName = req.Name
	install.Namespace = req.Namespace
	install.CreateNamespace = true
	install.Timeout = 5 * time.Minute
	rel, err := install.RunWithContext(context.WithoutCancel(r.Context()), chrt, values)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err)
		return
	}
	if err := h.writeSource(r, req.Namespace, req.Name, &req.chartSource); err != nil {
		log.Printf("remember chart source of %s/%s: %v", req.Namespace, req.Name, err)
	}
	writeJSON(w, http.StatusCreated, summarize(rel))
}

type upgradeRequest struct {
	// Optional: a new chart or version. Empty keeps the release's current chart, so editing values
	// works without reaching the chart repository.
	chartSource
	Values string `json:"values"`
}

func (h *handler) upgrade(w http.ResponseWriter, r *http.Request) {
	namespace, name := r.PathValue("namespace"), r.PathValue("name")
	var req upgradeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	values, err := parseValues(req.Values)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	cfg, err := h.configuration(r, namespace)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	current, err := action.NewGet(cfg).Run(name)
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	// The chart comes from the request, then from the remembered source; the copy in the release
	// only works for charts without subcharts.
	chrt := current.Chart
	source := &req.chartSource
	if source.Chart == "" {
		source = h.readSource(r, namespace, name)
	}
	if source != nil {
		if source.Version == "" && req.Chart == "" && chrt.Metadata != nil {
			source.Version = chrt.Metadata.Version
		}
		if chrt, err = h.loadChart(cfg, *source); err != nil {
			writeError(w, http.StatusBadGateway, fmt.Errorf("load chart: %w", err))
			return
		}
	} else if chrt.Metadata != nil && len(chrt.Metadata.Dependencies) > 0 {
		writeError(w, http.StatusConflict, errSourceRequired)
		return
	}
	upgrade := action.NewUpgrade(cfg)
	upgrade.Namespace = namespace
	// The submitted values replace the user-supplied ones, like editing them with helm upgrade -f.
	upgrade.ResetValues = true
	upgrade.Timeout = 5 * time.Minute
	rel, err := upgrade.RunWithContext(context.WithoutCancel(r.Context()), name, chrt, values)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err)
		return
	}
	if req.Chart != "" {
		if err := h.writeSource(r, namespace, name, &req.chartSource); err != nil {
			log.Printf("remember chart source of %s/%s: %v", namespace, name, err)
		}
	}
	writeJSON(w, http.StatusOK, summarize(rel))
}

func (h *handler) rollback(w http.ResponseWriter, r *http.Request) {
	namespace, name := r.PathValue("namespace"), r.PathValue("name")
	var req struct {
		Revision int `json:"revision"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Revision < 1 {
		writeError(w, http.StatusBadRequest, errors.New("revision is required"))
		return
	}
	cfg, err := h.configuration(r, namespace)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	rollback := action.NewRollback(cfg)
	rollback.Version = req.Revision
	rollback.Timeout = 5 * time.Minute
	if err := rollback.Run(name); err != nil {
		writeError(w, http.StatusUnprocessableEntity, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "rolled back to revision " + strconv.Itoa(req.Revision)})
}

func (h *handler) uninstall(w http.ResponseWriter, r *http.Request) {
	namespace, name := r.PathValue("namespace"), r.PathValue("name")
	cfg, err := h.configuration(r, namespace)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	uninstall := action.NewUninstall(cfg)
	uninstall.Timeout = 5 * time.Minute
	if _, err := uninstall.Run(name); err != nil {
		writeError(w, http.StatusUnprocessableEntity, err)
		return
	}
	if err := h.writeSource(r, namespace, name, nil); err != nil {
		log.Printf("forget chart source of %s/%s: %v", namespace, name, err)
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "uninstalled"})
}

type chartInfoResponse struct {
	Name        string   `json:"name"`
	Version     string   `json:"version"`
	AppVersion  string   `json:"appVersion"`
	Description string   `json:"description"`
	Values      string   `json:"values"`
	Versions    []string `json:"versions"`
}

// chartInfo returns a chart's default values and, for HTTP repositories, the versions on offer.
func (h *handler) chartInfo(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	source := chartSource{Repo: query.Get("repo"), Chart: query.Get("chart"), Version: query.Get("version")}
	cfg, err := h.configuration(r, "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	var versions []string
	if !source.isOCI() && source.Repo != "" {
		versions, err = h.repoVersions(source.Repo, source.Chart)
		if err != nil {
			writeError(w, http.StatusBadGateway, fmt.Errorf("read repository index: %w", err))
			return
		}
	}
	chrt, err := h.loadChart(cfg, source)
	if err != nil {
		writeError(w, http.StatusBadGateway, fmt.Errorf("load chart: %w", err))
		return
	}
	writeJSON(w, http.StatusOK, chartInfoResponse{
		Name:        chrt.Metadata.Name,
		Version:     chrt.Metadata.Version,
		AppVersion:  chrt.Metadata.AppVersion,
		Description: chrt.Metadata.Description,
		Values:      chartValuesYAML(chrt),
		Versions:    versions,
	})
}

// repoVersions lists the versions of a chart in an HTTP repository, newest first.
func (h *handler) repoVersions(repoURL, chartName string) ([]string, error) {
	chartRepo, err := repo.NewChartRepository(&repo.Entry{Name: "dashboard", URL: repoURL}, getter.All(h.settings))
	if err != nil {
		return nil, err
	}
	chartRepo.CachePath = h.settings.RepositoryCache
	indexPath, err := chartRepo.DownloadIndexFile()
	if err != nil {
		return nil, err
	}
	index, err := repo.LoadIndexFile(indexPath)
	if err != nil {
		return nil, err
	}
	index.SortEntries()
	versions := []string{}
	for _, version := range index.Entries[chartName] {
		versions = append(versions, version.Version)
	}
	return versions, nil
}
