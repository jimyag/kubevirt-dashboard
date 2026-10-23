import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import { Pencil, RefreshCw, Rocket, Trash2 } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ChoiceCard, Combobox, ConfirmDialog, DataTable, EmptyState, ErrorNote, FieldRow, PageHeader, Panel, StatusDot } from "@/components/console"
import { ChartSourceFields, UninstallDialog, ValuesEditor } from "@/pages/helm"
import { MonitoringSettings } from "@/pages/settings"
import { relativeTime, useAsync, useNamespaces } from "@/lib/kube"
import { detectBackends, writePrometheusConfig } from "@/lib/metrics"
import { helmReleasePath, installRelease, listReleases, type ChartSource, type HelmRelease } from "@/lib/helm"
import { monitoringCharts, monitoringPresets, type DeployMethod, type MonitoringBackend, type MonitoringPreset } from "@/lib/monitoring-presets"
import { isDnsLabel } from "@/lib/validate"
import * as YAML from "js-yaml"
import { t } from "@/lib/i18n"

const backends: Array<{ id: MonitoringBackend; title: string; description: string }> = [
  { id: "prometheus", title: "Prometheus", description: "The reference implementation of the Prometheus API." },
  { id: "victoriametrics", title: "VictoriaMetrics", description: "Prometheus-compatible, with lower memory and disk use." },
]

const methods: Array<{ id: DeployMethod; title: string }> = [
  { id: "operator", title: "Operator stack" },
  { id: "single", title: "Single server" },
]

/** Points the dashboard at the query service a release created, found by the same detection as Settings. */
const connectReleaseAsBackend = async (release: Pick<HelmRelease, "namespace" | "name">) => {
  const found = (await detectBackends()).filter((item) => item.config.namespace === release.namespace)
  const match = found.find((item) => item.config.service.includes(release.name)) || found[0]
  if (!match) throw new Error(t("No query service of {name} answers yet. Try again when its pods are ready.", { name: release.name }))
  writePrometheusConfig(match.config)
  return match
}

function DeployPanel({ onDeployed }: { onDeployed: () => void }) {
  const namespaces = useNamespaces()
  const [backend, setBackend] = useState<MonitoringBackend>("prometheus")
  const [method, setMethod] = useState<DeployMethod>("operator")
  const preset = monitoringPresets.find((item) => item.backend === backend && item.method === method) as MonitoringPreset
  const fresh = (item: MonitoringPreset) => ({ source: { repo: item.repo, chart: item.chart, version: "" } as ChartSource, namespace: item.namespace, name: item.release, values: item.values })
  const [form, setForm] = useState(() => fresh(preset))
  const [defaults, setDefaults] = useState("")
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState("")

  const choose = (nextBackend: MonitoringBackend, nextMethod: DeployMethod) => {
    const next = monitoringPresets.find((item) => item.backend === nextBackend && item.method === nextMethod) as MonitoringPreset
    setBackend(nextBackend)
    setMethod(nextMethod)
    setForm(fresh(next))
    setDefaults("")
    setError("")
  }

  const review = () => {
    if (!isDnsLabel(form.name)) return setError(t("Release name must be at most 63 lowercase letters, digits and dashes."))
    if (!isDnsLabel(form.namespace)) return setError(t("Choose a namespace."))
    try {
      YAML.load(form.values)
    } catch (err) {
      return setError(err instanceof Error ? err.message : t("Invalid YAML"))
    }
    setError("")
    setConfirming(true)
  }

  return (
    <Panel title={t("Deploy monitoring")} bodyClassName="space-y-5">
      <div className="space-y-2">
        <div className="text-sm font-medium">{t("Backend")}</div>
        <div className="grid gap-2 sm:grid-cols-2">
          {backends.map((item) => <ChoiceCard key={item.id} selected={backend === item.id} onClick={() => choose(item.id, method)} title={item.title} description={t(item.description)} />)}
        </div>
      </div>
      <div className="space-y-2">
        <div className="text-sm font-medium">{t("Deployment")}</div>
        <div className="grid gap-2 sm:grid-cols-2">
          {methods.map((item) => {
            const option = monitoringPresets.find((candidate) => candidate.backend === backend && candidate.method === item.id) as MonitoringPreset
            return <ChoiceCard key={item.id} selected={method === item.id} onClick={() => choose(backend, item.id)} title={<span>{t(item.title)} <span className="font-mono text-xs font-normal text-muted-foreground">{option.chart}</span></span>} description={t(option.description)} />
          })}
        </div>
      </div>
      <ChartSourceFields source={form.source} onChange={(source) => setForm((current) => ({ ...current, source }))} onDefaults={setDefaults} />
      <div className="grid gap-4 sm:grid-cols-2">
        <FieldRow label={t("Namespace")} hint={t("Created when missing.")}>
          <Combobox value={form.namespace} onChange={(namespace) => setForm((current) => ({ ...current, namespace }))} options={namespaces.filter((ns) => ns !== "all")} aria-label={t("Namespace")} className="w-full" />
        </FieldRow>
        <FieldRow label={t("Release name")}><Input value={form.name} onChange={(e) => setForm((current) => ({ ...current, name: e.target.value.trim() }))} className="font-mono" /></FieldRow>
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-medium">{t("Values")}</div>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setForm((current) => ({ ...current, values: preset.values }))}>{t("Reset to recommended")}</Button>
        </div>
        <p className="text-xs text-muted-foreground">{t("Recommended values already scrape KubeVirt's metrics service. Edit anything before deploying.")}</p>
        <ValuesEditor values={form.values} onChange={(values) => setForm((current) => ({ ...current, values }))} defaults={defaults} />
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="flex justify-end">
        <Button onClick={review} className="gap-1.5"><Rocket className="size-4" />{t("Deploy")}</Button>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("Deploy {chart} as {name} in {namespace}?", { chart: form.source.chart, name: form.name, namespace: form.namespace })}
        description={t("Runs helm install from {repo}{version}.", { repo: form.source.repo, version: form.source.version ? ` (${form.source.version})` : "" })}
        confirmLabel={t("Deploy")}
        onConfirm={async () => {
          const release = await installRelease({ ...form.source, namespace: form.namespace, name: form.name, values: form.values })
          toast.success(t("Deployed {name}. Its pods start in the background.", { name: release.name }))
          onDeployed()
        }}
      />
    </Panel>
  )
}

function DeploymentsPanel({ releases, loading, onChanged }: { releases: HelmRelease[]; loading: boolean; onChanged: () => void }) {
  const [removing, setRemoving] = useState<HelmRelease | null>(null)
  const [connecting, setConnecting] = useState("")
  const connect = async (release: HelmRelease) => {
    setConnecting(`${release.namespace}/${release.name}`)
    try {
      const match = await connectReleaseAsBackend(release)
      toast.success(t("Metrics now come from {target}", { target: `${match.config.namespace}/${match.config.service}:${match.config.port}` }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setConnecting("")
    }
  }
  return (
    <Panel title={t("Monitoring deployments")} bodyClassName="p-0">
      <DataTable
        loading={loading && releases.length === 0}
        rows={releases}
        rowKey={(release) => `${release.namespace}/${release.name}`}
        empty={<EmptyState title={t("No monitoring deployed with Helm")} />}
        columns={[
          {
            header: t("Release"),
            cell: (release) => (
              <div className="flex flex-col">
                <Link to={helmReleasePath(release)} className="font-medium hover:text-primary transition-colors">{release.name}</Link>
                <span className="text-xs text-muted-foreground">{release.namespace}</span>
              </div>
            ),
          },
          { header: t("Chart"), cell: (release) => <span className="font-mono text-xs">{release.chart}-{release.chartVersion}</span> },
          { header: t("Status"), cell: (release) => <StatusDot status={release.status} /> },
          { header: t("Updated"), cell: (release) => <span className="text-sm text-muted-foreground tabular-nums" title={release.updated}>{relativeTime(release.updated)}</span> },
          {
            header: "",
            className: "text-right",
            cell: (release) => (
              <div className="flex justify-end gap-1">
                <Button size="sm" variant="ghost" disabled={connecting !== ""} onClick={() => connect(release)}>{connecting === `${release.namespace}/${release.name}` ? t("Detecting...") : t("Use for metrics")}</Button>
                <Button asChild size="icon" variant="ghost" aria-label={t("Edit values of {name}", { name: release.name })}><Link to={helmReleasePath(release, "values")}><Pencil className="size-4 text-muted-foreground" /></Link></Button>
                <Button size="icon" variant="ghost" aria-label={t("Uninstall {name}", { name: release.name })} onClick={() => setRemoving(release)}><Trash2 className="size-4 text-muted-foreground" /></Button>
              </div>
            ),
          },
        ]}
      />
      <UninstallDialog release={removing} onOpenChange={(open) => !open && setRemoving(null)} onDone={onChanged} />
    </Panel>
  )
}

/** Settings, Monitoring: deploy a monitoring stack with Helm, manage it, and choose where metrics come from. */
export function MonitoringSettingsPage() {
  const { data, loading, error, reload } = useAsync(() => listReleases(), [] as HelmRelease[], [])
  const releases = useMemo(() => data.filter((release) => monitoringCharts.has(release.chart)), [data])
  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Monitoring")}
        actions={<Button variant="outline" size="sm" onClick={reload} className="gap-2"><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />{t("Refresh")}</Button>}
      />
      {error && <ErrorNote>{error}</ErrorNote>}
      <DeploymentsPanel releases={releases} loading={loading} onChanged={reload} />
      <MonitoringSettings />
      <DeployPanel onDeployed={reload} />
    </div>
  )
}
