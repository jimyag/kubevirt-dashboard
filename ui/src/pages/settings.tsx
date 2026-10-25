import { useState } from "react"
import { Link } from "react-router-dom"
import { CheckCircle2, ChevronRight, Languages, Network, Sparkles, XCircle } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ChoiceCard, ErrorNote, FieldRow, NativeSelect, PageHeader, Panel } from "@/components/console"
import { detectBackends, prometheusBase, testPrometheus, usePrometheusConfig, writePrometheusConfig, type PrometheusConfig } from "@/lib/metrics"
import {
  networkProfiles,
  useDiscovery,
  useNetworkProfile,
  writeProfileOverride,
  type NetworkProfileId,
} from "@/lib/kube"
import { engineResource } from "@/lib/security-groups"
import { locales, setLocale, t, useLocale } from "@/lib/i18n"
import { ResourceCatalogSearch } from "@/resources/group-pages"

const components: Array<{ name: string; description: string; check: [string, string] }> = [
  { name: "KubeVirt", description: "Virtual machine runtime", check: ["kubevirt.io/v1", "virtualmachines"] },
  { name: "CDI", description: "Disk import, upload and clone", check: ["cdi.kubevirt.io/v1beta1", "datavolumes"] },
  { name: "Instance types", description: "Reusable compute shapes", check: ["instancetype.kubevirt.io/v1beta1", "virtualmachineclusterinstancetypes"] },
  { name: "Kube-OVN", description: "VPCs, subnets, EIPs, NAT, security groups", check: ["kubeovn.io/v1", "subnets"] },
  { name: "Cilium", description: "eBPF networking and network policy", check: ["cilium.io/v2", "ciliumnetworkpolicies"] },
  { name: "Multus", description: "Secondary networks for instances", check: ["k8s.cni.cncf.io/v1", "network-attachment-definitions"] },
  { name: "Volume snapshots", description: "CSI snapshot support", check: ["snapshot.storage.k8s.io/v1", "volumesnapshots"] },
  { name: "metrics-server", description: "Live host and instance CPU / memory", check: ["metrics.k8s.io/v1beta1", "nodes"] },
]

const stackOrder: NetworkProfileId[] = ["kube-ovn-cilium", "kube-ovn", "cilium", "pod"]

/**
 * Networking capabilities detected on the cluster. The component stack behind them only shows up
 * under "Advanced", where detection can be overridden.
 */
function NetworkingSettings() {
  const profile = useNetworkProfile()
  const [advanced, setAdvanced] = useState(profile.override !== "auto")
  const engines = profile.aclEngines
  return (
    <Panel
      title={t("Networking")}
      bodyClassName="space-y-4"
      actions={<Button size="sm" variant="ghost" onClick={() => setAdvanced((current) => !current)}>{advanced ? t("Hide advanced") : t("Advanced")}</Button>}
    >
      <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 text-sm sm:grid-cols-3">
        <div>
          <div className="text-xs text-muted-foreground">{t("Instance networking")}</div>
          <div className="font-semibold">{profile.vpc ? t("VPCs and subnets") : t("Pod network")}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">{t("Access control")}</div>
          <div className="font-semibold">{engines.length ? t("Security groups") : t("Network policies")}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">{t("Elastic IPs and NAT")}</div>
          <div className="font-semibold">{profile.vpc ? t("Available") : t("Not available")}</div>
        </div>
      </div>
      {advanced && (
        <div className="space-y-3">
          <ChoiceCard
            selected={profile.override === "auto"}
            onClick={() => writeProfileOverride("auto")}
            icon={Sparkles}
            title={<span className="flex items-center gap-2">{t("Auto detect")} <Badge variant="outline">{t(networkProfiles[profile.detected].label)}</Badge></span>}
            description={t("Use Kube-OVN for VPCs when installed, and Cilium for security groups when both are installed.")}
          />
          <div className="grid gap-3 md:grid-cols-2">
            {stackOrder.map((id) => {
              const item = networkProfiles[id]
              const missing = (item.vpc && !profile.kubeOvnInstalled) || (item.acl === "cilium" && !profile.ciliumInstalled) || (item.acl === "kube-ovn" && !profile.kubeOvnInstalled)
              return (
                <ChoiceCard
                  key={id}
                  selected={profile.override === id}
                  onClick={() => writeProfileOverride(id)}
                  icon={Network}
                  title={<span className="flex flex-wrap items-center gap-2">{t(item.label)}{missing && profile.loaded && <Badge variant="warning">{t("Not installed")}</Badge>}</span>}
                  description={t(item.description)}
                />
              )
            })}
          </div>
          {engines.length > 1 && (
            <p className="text-xs text-muted-foreground">
              {t("Security groups use {engine} by default; {other} can be chosen per group and per instance.", { engine: engineResource[engines[0]], other: engines.slice(1).map((engine) => engineResource[engine]).join(", ") })}
            </p>
          )}
        </div>
      )}
    </Panel>
  )
}

export function SettingsPage() {
  const discovery = useDiscovery()
  const locale = useLocale()

  return (
    <div className="space-y-6">
      <PageHeader title={t("Settings")} />

      <Panel title={t("Language")}>
        <div className="grid gap-3 sm:grid-cols-2 md:max-w-xl">
          {locales.map((item) => (
            <ChoiceCard key={item.id} selected={locale === item.id} onClick={() => setLocale(item.id)} icon={Languages} title={item.label} />
          ))}
        </div>
      </Panel>

      <NetworkingSettings />


      <Panel title={t("Installed components")}>
          <div className="grid gap-2 md:grid-cols-2">
            {components.map((component) => {
              const [groupVersion, resource] = component.check
              const installed = discovery.hasResource(groupVersion, resource)
              return (
                <div key={component.name} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                  <div>
                    <div className="text-sm font-medium">{component.name}</div>
                    <div className="text-xs text-muted-foreground">{t(component.description)}</div>
                  </div>
                  {!discovery.loaded ? (
                    <span className="text-xs text-muted-foreground">{t("Checking...")}</span>
                  ) : installed ? (
                    <span className="flex items-center gap-1 text-sm text-green-600 dark:text-green-400"><CheckCircle2 className="size-4" />{t("Installed")}</span>
                  ) : (
                    <span className="flex items-center gap-1 text-sm text-muted-foreground"><XCircle className="size-4" />{t("Not found")}</span>
                  )}
                </div>
              )
            })}
          </div>
        </Panel>
    </div>
  )
}

const catalog = [
  { to: "/catalog/crds", title: "Custom resources", description: "CustomResourceDefinition · served APIs" },
  { to: "/networks/envoy-gateway", title: "Envoy Gateway", description: "gateway.envoyproxy.io" },
  { to: "/applications/installed", title: "Helm releases", description: "Charts installed with Helm: values, manifests, history" },
  { to: "/kubevirt", title: "KubeVirt", description: "VMs, VMIs, pools, CDI, instance types, snapshots, migrations" },
  { to: "/storage", title: "Storage", description: "StorageClasses, PV/PVC, CSI, volume snapshots" },
  { to: "/networks", title: "Networks", description: "Services, Gateway API, Multus, Calico, Cilium, Kube-OVN" },
  { to: "/kubernetes", title: "Kubernetes", description: "Workloads, config, RBAC, policy, admission, cluster" },
]

/** Where the dashboard queries metrics from; shown on Settings, Monitoring. */
export function MonitoringSettings() {
  const saved = usePrometheusConfig()
  const [form, setForm] = useState<PrometheusConfig>(() => saved || { namespace: "monitoring", service: "prometheus-operated", port: "9090", scheme: "http", path: "" })
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [previousSaved, setPreviousSaved] = useState(saved)
  if (saved !== previousSaved) {
    setPreviousSaved(saved)
    if (saved) setForm(saved)
    setStatus(null)
  }
  const [testing, setTesting] = useState(false)
  const [found, setFound] = useState<Awaited<ReturnType<typeof detectBackends>> | null>(null)
  const [detecting, setDetecting] = useState(false)
  const set = (patch: Partial<PrometheusConfig>) => {
    setForm((current) => ({ ...current, ...patch }))
    setStatus(null)
  }
  const test = async () => {
    setTesting(true)
    try {
      const result = await testPrometheus(form)
      setStatus({ ok: true, text: result.backend ? t("Connected to {backend} {version}", { backend: result.backend, version: result.version }).trim() : t("Connected. Prometheus API {version}", { version: result.version || "?" }) })
    } catch (err) {
      setStatus({ ok: false, text: err instanceof Error ? err.message : t("Connection failed") })
    } finally {
      setTesting(false)
    }
  }
  const detect = async () => {
    setDetecting(true)
    try {
      setFound(await detectBackends())
    } catch {
      setFound([])
    } finally {
      setDetecting(false)
    }
  }
  const valid = Boolean(form.namespace && form.service && form.port)
  const dirty = !saved || (["namespace", "service", "port", "scheme", "path"] as const).some((key) => saved[key] !== form[key])

  return (
    <Panel
      title={t("Metrics source")}
      description={t("Any Prometheus-compatible query API: Prometheus, VictoriaMetrics or Thanos. Reached through the Kubernetes API service proxy and stored per cluster in this browser.")}
      bodyClassName="space-y-4"
    >
      <div className="space-y-2">
        <Button size="sm" variant="outline" onClick={detect} disabled={detecting}>{detecting ? t("Detecting...") : t("Detect in cluster")}</Button>
        {found && found.length === 0 && <p className="text-sm text-muted-foreground">{t("No Prometheus-compatible service found. Enter it below.")}</p>}
        {found && found.length > 0 && (
          <div className="divide-y rounded-lg border">
            {found.map((item) => (
              <div key={`${item.config.namespace}/${item.config.service}:${item.config.port}`} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="font-medium">{item.kind}</div>
                  <div className="font-mono text-xs text-muted-foreground break-all">{item.config.namespace}/{item.config.service}:{item.config.port}{item.config.path}</div>
                </div>
                <Button size="sm" variant="outline" onClick={() => set(item.config)}>{t("Use")}</Button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-5">
        <FieldRow label={t("Namespace")}><Input value={form.namespace} onChange={(e) => set({ namespace: e.target.value.trim() })} /></FieldRow>
        <FieldRow label={t("Service")}><Input value={form.service} onChange={(e) => set({ service: e.target.value.trim() })} /></FieldRow>
        <FieldRow label={t("Port")}><Input value={form.port} onChange={(e) => set({ port: e.target.value.trim() })} placeholder={t("9090 or web")} /></FieldRow>
        <FieldRow label={t("Scheme")}>
          <NativeSelect value={form.scheme} onChange={(e) => set({ scheme: e.target.value === "https" ? "https" : "http" })}>
            <option value="http">http</option>
            <option value="https">https</option>
          </NativeSelect>
        </FieldRow>
        <FieldRow label={t("Path prefix")}><Input value={form.path} onChange={(e) => set({ path: e.target.value.trim() })} placeholder={t("None")} /></FieldRow>
      </div>
      <p className="font-mono text-xs text-muted-foreground break-all">{prometheusBase(form)}/api/v1/query_range</p>
      {status && (
        <div className={status.ok ? "flex items-center gap-2 text-sm" : ""}>
          {status.ok ? <><CheckCircle2 className="size-4 text-green-600 dark:text-green-400" />{status.text}</> : <ErrorNote>{status.text}</ErrorNote>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={test} disabled={testing || !valid}>{testing ? t("Testing...") : t("Test connection")}</Button>
        <Button size="sm" onClick={() => writePrometheusConfig(form)} disabled={!dirty || !valid}>{saved ? t("Save") : t("Enable")}</Button>
        {saved && <Button size="sm" variant="ghost" onClick={() => writePrometheusConfig(null)}>{t("Disable")}</Button>}
        <span className="text-xs text-muted-foreground">{saved ? t("In use: {target}", { target: `${saved.namespace}/${saved.service}:${saved.port}${saved.path}` }) : t("Not configured: instance pages show live metrics-server samples only.")}</span>
      </div>
    </Panel>
  )
}

export function CatalogPage() {
  return (
    <div className="space-y-5">
      <PageHeader title={t("Resource Catalog")} subtitle={t("Raw API resources, grouped by provider.")} />
      <ResourceCatalogSearch>
        <div className="divide-y rounded-lg border bg-card">
          {catalog.map((item) => (
            <Link key={item.to} to={item.to} className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-muted/50">
              <div className="min-w-0">
                <div className="text-sm font-medium">{t(item.title)}</div>
                <div className="text-xs text-muted-foreground">{t(item.description)}</div>
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          ))}
        </div>
      </ResourceCatalogSearch>
    </div>
  )
}
