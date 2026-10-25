// Package helm serves Helm release management for the dashboard: list, inspect, install, upgrade
// (edit values), roll back and uninstall releases in the cluster of the request's kube context.
// Release state lives in the cluster as Helm's own release Secrets, so the dashboard and the helm
// CLI see the same releases.
package helm

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/chart"
	"helm.sh/helm/v3/pkg/chart/loader"
	"helm.sh/helm/v3/pkg/cli"
	"helm.sh/helm/v3/pkg/getter"
	"helm.sh/helm/v3/pkg/helmpath"
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
	reposMu    sync.Mutex
}

// Register adds the /api/v1/helm endpoints to mux.
func Register(mux *http.ServeMux, restConfig RESTConfigFunc) {
	h := &handler{restConfig: restConfig}
	mux.HandleFunc("GET /api/v1/helm/releases", h.list)
	mux.HandleFunc("POST /api/v1/helm/releases", h.install)
	mux.HandleFunc("GET /api/v1/helm/releases/{namespace}/{name}", h.get)
	mux.HandleFunc("PUT /api/v1/helm/releases/{namespace}/{name}", h.upgrade)
	mux.HandleFunc("DELETE /api/v1/helm/releases/{namespace}/{name}", h.uninstall)
	mux.HandleFunc("GET /api/v1/helm/releases/{namespace}/{name}/history", h.history)
	mux.HandleFunc("GET /api/v1/helm/releases/{namespace}/{name}/resources", h.resources)
	mux.HandleFunc("POST /api/v1/helm/releases/{namespace}/{name}/rollback", h.rollback)
	mux.HandleFunc("GET /api/v1/helm/chart", h.chartInfo)
	mux.HandleFunc("GET /api/v1/helm/repositories", h.listRepositories)
	mux.HandleFunc("POST /api/v1/helm/repositories", h.saveRepository)
	mux.HandleFunc("DELETE /api/v1/helm/repositories/{name}", h.removeRepository)
	mux.HandleFunc("POST /api/v1/helm/repositories/{name}/refresh", h.refreshRepository)
	mux.HandleFunc("GET /api/v1/helm/repositories/{name}/charts", h.listRepositoryCharts)
}

// newSettings keeps Helm's repository cache and registry config in a private directory per
// cluster, so repositories and registry credentials do not leak between kube contexts.
func newSettings(cluster string) (*cli.EnvSettings, error) {
	root, err := os.UserConfigDir()
	if err != nil {
		return nil, err
	}
	return newSettingsForRoot(filepath.Join(root, "kubevirt-dashboard", "helm"), cluster)
}

func newSettingsForRoot(root, cluster string) (*cli.EnvSettings, error) {
	sum := sha256.Sum256([]byte(cluster))
	base := filepath.Join(root, fmt.Sprintf("%x", sum[:8]))
	cache := filepath.Join(base, "cache")
	for _, dir := range []string{base, cache} {
		if err := os.MkdirAll(dir, 0700); err != nil {
			return nil, err
		}
		if err := os.Chmod(dir, 0700); err != nil {
			return nil, err
		}
	}
	settings := cli.New()
	settings.RepositoryCache = cache
	settings.RepositoryConfig = filepath.Join(base, "repositories.yaml")
	settings.RegistryConfig = filepath.Join(base, "registry.json")
	return settings, nil
}

func isDNSLabel(value string) bool {
	if len(value) == 0 || len(value) > 63 || value[0] == '-' || value[len(value)-1] == '-' {
		return false
	}
	for _, char := range value {
		if (char < 'a' || char > 'z') && (char < '0' || char > '9') && char != '-' {
			return false
		}
	}
	return true
}

func loginRegistry(settings *cli.EnvSettings, entry *repo.Entry) error {
	parsed, err := url.Parse(entry.URL)
	if err != nil {
		return err
	}
	if parsed.Host == "" {
		return errors.New("OCI repository has no registry host")
	}
	client, err := registry.NewClient(registry.ClientOptCredentialsFile(settings.RegistryConfig))
	if err != nil {
		return err
	}
	if err := client.Login(parsed.Host, registry.LoginOptBasicAuth(entry.Username, entry.Password)); err != nil {
		return err
	}
	if err := os.Chmod(settings.RegistryConfig, 0600); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func (h *handler) settingsFor(r *http.Request) (*cli.EnvSettings, error) {
	config, err := h.restConfig(r)
	if err != nil {
		return nil, err
	}
	return newSettings(config.Host)
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
	settings, err := newSettings(restConfig.Host)
	if err != nil {
		return nil, err
	}
	registryClient, err := registry.NewClient(registry.ClientOptCredentialsFile(settings.RegistryConfig))
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

type repositoryInfo struct {
	Name       string `json:"name"`
	URL        string `json:"url"`
	Type       string `json:"type"`
	Username   string `json:"username,omitempty"`
	UpdatedAt  string `json:"updatedAt,omitempty"`
	ChartCount int    `json:"chartCount"`
	Error      string `json:"error,omitempty"`
}

type repositoryRequest struct {
	Name     string `json:"name"`
	URL      string `json:"url"`
	Username string `json:"username"`
	Password string `json:"password"`
}

type repositoryChart struct {
	Repository    string   `json:"repository"`
	RepositoryURL string   `json:"repositoryURL"`
	Name          string   `json:"name"`
	Version       string   `json:"version"`
	AppVersion    string   `json:"appVersion"`
	Description   string   `json:"description"`
	Versions      []string `json:"versions"`
}

func readRepositories(settings *cli.EnvSettings) (*repo.File, error) {
	file, err := repo.LoadFile(settings.RepositoryConfig)
	if os.IsNotExist(err) || (err != nil && errors.Is(err, fs.ErrNotExist)) {
		return repo.NewFile(), nil
	}
	if err != nil {
		return nil, err
	}
	if file.Repositories == nil {
		file.Repositories = []*repo.Entry{}
	}
	return file, nil
}

func readRepository(settings *cli.EnvSettings, name string) *repo.Entry {
	file, err := readRepositories(settings)
	if err != nil {
		return nil
	}
	return file.Get(name)
}

func repositoryType(url string) string {
	if registry.IsOCI(url) {
		return "OCI"
	}
	return "HTTP"
}

func refreshHTTPRepository(settings *cli.EnvSettings, entry *repo.Entry) (*repo.IndexFile, error) {
	chartRepo, err := repo.NewChartRepository(entry, getter.All(settings))
	if err != nil {
		return nil, err
	}
	chartRepo.CachePath = settings.RepositoryCache
	path, err := chartRepo.DownloadIndexFile()
	if err != nil {
		return nil, err
	}
	return repo.LoadIndexFile(path)
}

func cachedHTTPRepository(settings *cli.EnvSettings, entry *repo.Entry) (*repo.IndexFile, error) {
	indexPath := filepath.Join(settings.RepositoryCache, helmpath.CacheIndexFile(entry.Name))
	index, err := repo.LoadIndexFile(indexPath)
	if os.IsNotExist(err) {
		return refreshHTTPRepository(settings, entry)
	}
	return index, err
}

func (h *handler) listRepositories(w http.ResponseWriter, r *http.Request) {
	settings, err := h.settingsFor(r)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	h.reposMu.Lock()
	defer h.reposMu.Unlock()
	file, err := readRepositories(settings)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	items := make([]repositoryInfo, 0, len(file.Repositories))
	for _, entry := range file.Repositories {
		if entry == nil {
			continue
		}
		item := repositoryInfo{Name: entry.Name, URL: entry.URL, Type: repositoryType(entry.URL), Username: entry.Username}
		if registry.IsOCI(entry.URL) {
			items = append(items, item)
			continue
		}
		index, err := cachedHTTPRepository(settings, entry)
		if err != nil {
			item.Error = err.Error()
		} else {
			item.ChartCount = len(index.Entries)
			item.UpdatedAt = index.Generated.UTC().Format(time.RFC3339)
		}
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Name < items[j].Name })
	writeJSON(w, http.StatusOK, map[string]interface{}{"items": items})
}

func (h *handler) saveRepository(w http.ResponseWriter, r *http.Request) {
	var req repositoryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	req.URL = strings.TrimSpace(req.URL)
	if req.Name == "" || req.URL == "" {
		writeError(w, http.StatusBadRequest, errors.New("repository name and URL are required"))
		return
	}
	if !strings.HasPrefix(req.URL, "https://") && !strings.HasPrefix(req.URL, "http://") && !registry.IsOCI(req.URL) {
		writeError(w, http.StatusBadRequest, errors.New("repository URL must use http://, https://, or oci://"))
		return
	}
	if !isDNSLabel(req.Name) {
		writeError(w, http.StatusBadRequest, errors.New("repository name must be a lowercase DNS label"))
		return
	}
	settings, err := h.settingsFor(r)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	h.reposMu.Lock()
	defer h.reposMu.Unlock()
	existing := readRepository(settings, req.Name)
	entry := &repo.Entry{Name: req.Name, URL: req.URL, Username: req.Username, Password: req.Password}
	if existing != nil {
		if req.Username == "" {
			entry.Username = existing.Username
		}
		if req.Password == "" {
			entry.Password = existing.Password
		}
	}
	if !registry.IsOCI(req.URL) {
		if _, err := refreshHTTPRepository(settings, entry); err != nil {
			writeError(w, http.StatusBadGateway, fmt.Errorf("check repository: %w", err))
			return
		}
	} else if entry.Username != "" && entry.Password != "" {
		if err := loginRegistry(settings, entry); err != nil {
			writeError(w, http.StatusBadGateway, fmt.Errorf("authenticate repository: %w", err))
			return
		}
	}
	file, err := readRepositories(settings)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	file.Update(entry)
	if err := file.WriteFile(settings.RepositoryConfig, 0600); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, repositoryInfo{Name: entry.Name, URL: entry.URL, Type: repositoryType(entry.URL), Username: entry.Username})
}

func (h *handler) removeRepository(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	settings, err := h.settingsFor(r)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	h.reposMu.Lock()
	defer h.reposMu.Unlock()
	file, err := readRepositories(settings)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if !file.Remove(name) {
		writeError(w, http.StatusNotFound, errors.New("repository not found"))
		return
	}
	if err := file.WriteFile(settings.RepositoryConfig, 0600); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "removed"})
}

func (h *handler) refreshRepository(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	settings, err := h.settingsFor(r)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	h.reposMu.Lock()
	defer h.reposMu.Unlock()
	file, err := readRepositories(settings)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	entry := file.Get(name)
	if entry == nil {
		writeError(w, http.StatusNotFound, errors.New("repository not found"))
		return
	}
	if registry.IsOCI(entry.URL) {
		writeJSON(w, http.StatusOK, repositoryInfo{Name: entry.Name, URL: entry.URL, Type: "OCI", Username: entry.Username})
		return
	}
	index, err := refreshHTTPRepository(settings, entry)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, repositoryInfo{Name: entry.Name, URL: entry.URL, Type: repositoryType(entry.URL), Username: entry.Username, UpdatedAt: index.Generated.UTC().Format(time.RFC3339), ChartCount: len(index.Entries)})
}

func (h *handler) listRepositoryCharts(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	settings, err := h.settingsFor(r)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	h.reposMu.Lock()
	defer h.reposMu.Unlock()
	file, err := readRepositories(settings)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	entry := file.Get(name)
	if entry == nil {
		writeError(w, http.StatusNotFound, errors.New("repository not found"))
		return
	}
	if registry.IsOCI(entry.URL) {
		writeError(w, http.StatusUnprocessableEntity, errors.New("this OCI source does not provide a chart catalog; install it by chart reference"))
		return
	}
	index, err := refreshHTTPRepository(settings, entry)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	index.SortEntries()
	items := make([]repositoryChart, 0, len(index.Entries))
	for name, versions := range index.Entries {
		if len(versions) == 0 || versions[0] == nil || versions[0].Metadata == nil {
			continue
		}
		item := repositoryChart{Repository: entry.Name, RepositoryURL: entry.URL, Name: name, Description: versions[0].Description, AppVersion: versions[0].AppVersion}
		for _, version := range versions {
			if version != nil {
				item.Versions = append(item.Versions, version.Version)
			}
		}
		if len(item.Versions) > 0 {
			item.Version = item.Versions[0]
		}
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Name < items[j].Name })
	writeJSON(w, http.StatusOK, map[string]interface{}{"items": items})
}

func (s chartSource) ref() string {
	if s.isOCI() {
		return strings.TrimSuffix(s.Repo, "/") + "/" + s.Chart
	}
	return s.Chart
}

// loadChart downloads (or reuses from the cache) and loads a chart.
func (h *handler) loadChart(cfg *action.Configuration, settings *cli.EnvSettings, source chartSource) (*chart.Chart, error) {
	if source.Chart == "" {
		return nil, errors.New("chart is required")
	}
	options := action.ChartPathOptions{Version: source.Version}
	if !source.isOCI() {
		options.RepoURL = source.Repo
		if source.Repo != "" {
			repos, err := readRepositories(settings)
			if err != nil {
				return nil, err
			}
			for _, entry := range repos.Repositories {
				if entry == nil || strings.TrimSuffix(entry.URL, "/") != strings.TrimSuffix(source.Repo, "/") {
					continue
				}
				options.Username = entry.Username
				options.Password = entry.Password
				break
			}
		}
	}
	install := action.NewInstall(cfg)
	install.ChartPathOptions = options
	install.SetRegistryClient(cfg.RegistryClient)
	path, err := install.LocateChart(source.ref(), settings)
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
	settings, err := h.settingsFor(r)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	chrt, err := h.loadChart(cfg, settings, req.chartSource)
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
		settings, settingsErr := h.settingsFor(r)
		if settingsErr != nil {
			writeError(w, http.StatusInternalServerError, settingsErr)
			return
		}
		if chrt, err = h.loadChart(cfg, settings, *source); err != nil {
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
	settings, err := h.settingsFor(r)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	var versions []string
	if !source.isOCI() && source.Repo != "" {
		versions, err = h.repoVersions(settings, source.Repo, source.Chart)
		if err != nil {
			writeError(w, http.StatusBadGateway, fmt.Errorf("read repository index: %w", err))
			return
		}
	}
	chrt, err := h.loadChart(cfg, settings, source)
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
func (h *handler) repoVersions(settings *cli.EnvSettings, repoURL, chartName string) ([]string, error) {
	entry := &repo.Entry{Name: "dashboard", URL: repoURL}
	repos, err := readRepositories(settings)
	if err != nil {
		return nil, err
	}
	for _, saved := range repos.Repositories {
		if saved != nil && strings.TrimSuffix(saved.URL, "/") == strings.TrimSuffix(repoURL, "/") {
			entry.Username = saved.Username
			entry.Password = saved.Password
			break
		}
	}
	chartRepo, err := repo.NewChartRepository(entry, getter.All(settings))
	if err != nil {
		return nil, err
	}
	chartRepo.CachePath = settings.RepositoryCache
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
