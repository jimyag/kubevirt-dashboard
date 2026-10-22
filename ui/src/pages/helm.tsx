import { useMemo, useState } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom"
import * as YAML from "js-yaml"
import { toast } from "sonner"
import { Package, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Combobox,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorNote,
  FieldRow,
  FilterInput,
  KeyValueGrid,
  LoadingState,
  PageHeader,
  Panel,
  StatusDot,
  TabBar,
  Toolbar,
} from "@/components/console"
import { YamlCode, YamlDiff } from "@/components/yaml-editor"
import { useFilteredRows, type FilterField } from "@/lib/filter"
import { relativeTime, useAsync, useNamespaces } from "@/lib/kube"
import {
  chartInfo,
  getRelease,
  guessRepository,
  helmReleasePath,
  installRelease,
  knownRepositories,
  listReleases,
  needsSource,
  releaseHistory,
  rollbackRelease,
  uninstallRelease,
  upgradeRelease,
  type ChartSource,
  type HelmRelease,
  type HelmReleaseDetail,
} from "@/lib/helm"
import { lineDiff } from "@/lib/yaml-view"
import { isDnsLabel } from "@/lib/validate"
import { t } from "@/lib/i18n"

const yamlProblem = (text: string) => {
  try {
    const parsed = YAML.load(text)
    if (parsed !== undefined && parsed !== null && (typeof parsed !== "object" || Array.isArray(parsed))) return t("Values must be a YAML mapping.")
    return ""
  } catch (err) {
    return err instanceof Error ? err.message : t("Invalid YAML")
  }
}

// --- Chart source fields ---

/** Repository, chart and version inputs; versions load from the repository on demand. */
export function ChartSourceFields({ source, onChange, lockChart, onDefaults }: { source: ChartSource; onChange: (source: ChartSource) => void; lockChart?: boolean; onDefaults?: (values: string) => void }) {
  const [versions, setVersions] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const load = async () => {
    setLoading(true)
    setError("")
    try {
      const info = await chartInfo({ repo: source.repo, chart: source.chart, version: source.version })
      setVersions(info.versions || [])
      if (!source.version && info.version) onChange({ ...source, version: info.version })
      onDefaults?.(info.values)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }
  return (
    <div className="space-y-3">
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr]">
        <FieldRow label={t("Repository")} hint={t("HTTP repository or oci:// registry path.")}>
          <Combobox value={source.repo} onChange={(repo) => { onChange({ ...source, repo }); setVersions(null) }} options={knownRepositories} placeholder="https://..." aria-label={t("Repository")} className="w-full font-mono" />
        </FieldRow>
        <FieldRow label={t("Chart")}>
          <Input value={source.chart} disabled={lockChart} onChange={(e) => { onChange({ ...source, chart: e.target.value.trim() }); setVersions(null) }} className="font-mono" />
        </FieldRow>
        <FieldRow label={t("Version")}>
          <Combobox value={source.version || ""} onChange={(version) => onChange({ ...source, version })} options={versions || []} placeholder={t("Latest")} aria-label={t("Version")} className="w-full font-mono" />
        </FieldRow>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={load} disabled={loading || !source.repo || !source.chart}>{loading ? t("Loading...") : onDefaults ? t("Load versions and default values") : t("Load versions")}</Button>
        {versions && <span className="text-xs text-muted-foreground">{t("{count} versions", { count: versions.length })}</span>}
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  )
}

// --- Install ---

export function InstallChartDialog({ open, onOpenChange, onInstalled, initial }: { open: boolean; onOpenChange: (open: boolean) => void; onInstalled: (release: HelmRelease) => void; initial?: Partial<ChartSource & { namespace: string; name: string; values: string }> }) {
  const namespaces = useNamespaces()
  const blank = { repo: knownRepositories[0].value, chart: "", version: "", namespace: "default", name: "", values: "", ...initial }
  const [form, setForm] = useState(blank)
  const [defaults, setDefaults] = useState("")
  const set = (patch: Partial<typeof form>) => setForm((current) => ({ ...current, ...patch }))
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) {
          setForm(blank)
          setDefaults("")
        }
      }}
      title={t("Install chart")}
      confirmLabel={t("Install")}
      className="sm:max-w-4xl"
      onConfirm={async () => {
        if (!form.chart) throw new Error(t("Enter a chart."))
        if (!isDnsLabel(form.name)) throw new Error(t("Release name must be at most 63 lowercase letters, digits and dashes."))
        if (!isDnsLabel(form.namespace)) throw new Error(t("Choose a namespace."))
        const problem = yamlProblem(form.values)
        if (problem) throw new Error(problem)
        const release = await installRelease({ repo: form.repo, chart: form.chart, version: form.version, namespace: form.namespace, name: form.name, values: form.values })
        toast.success(t("Installed {name}", { name: release.name }))
        onInstalled(release)
      }}
    >
      <div className="space-y-4">
        <ChartSourceFields source={form} onChange={(source) => set({ ...source, name: form.name || source.chart })} onDefaults={setDefaults} />
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldRow label={t("Namespace")} hint={t("Created when missing.")}>
            <Combobox value={form.namespace} onChange={(namespace) => set({ namespace })} options={namespaces} aria-label={t("Namespace")} className="w-full" />
          </FieldRow>
          <FieldRow label={t("Release name")}><Input value={form.name} onChange={(e) => set({ name: e.target.value.trim() })} className="font-mono" /></FieldRow>
        </div>
        <ValuesEditor values={form.values} onChange={(values) => set({ values })} defaults={defaults} />
      </div>
    </ConfirmDialog>
  )
}

/** Values to set, with the chart's defaults one tab away for reference. */
export function ValuesEditor({ values, onChange, defaults, className }: { values: string; onChange: (values: string) => void; defaults?: string; className?: string }) {
  const [view, setView] = useState<"values" | "defaults">("values")
  return (
    <div className="space-y-2">
      <TabBar<"values" | "defaults">
        tabs={[{ id: "values", label: t("Values") }, ...(defaults ? [{ id: "defaults" as const, label: t("Chart defaults") }] : [])]}
        value={defaults ? view : "values"}
        onChange={setView}
      />
      {view === "defaults" && defaults ? (
        <YamlCode value={defaults} className={cn("h-80", className)} />
      ) : (
        <YamlCode value={values} onChange={onChange} className={cn("h-80", className)} />
      )}
    </div>
  )
}

// --- List ---

const fields: FilterField<HelmRelease>[] = [
  { key: "name", label: "Name", value: (release) => release.name },
  { key: "namespace", label: "Namespace", aliases: ["ns"], value: (release) => release.namespace },
  { key: "chart", label: "Chart", value: (release) => release.chart },
  { key: "version", label: "Chart version", value: (release) => release.chartVersion },
  { key: "status", label: "Status", value: (release) => release.status },
]

export function HelmReleaseListPage() {
  const navigate = useNavigate()
  const namespaces = useNamespaces()
  const [namespace, setNamespace] = useState("")
  const [search, setSearch] = useState("")
  const [installing, setInstalling] = useState(false)
  const [removing, setRemoving] = useState<HelmRelease | null>(null)
  const exactNamespace = namespaces.includes(namespace.trim()) && namespace.trim() !== "all" ? namespace.trim() : ""
  const { data, loading, error, reload } = useAsync(() => listReleases(exactNamespace || undefined), [] as HelmRelease[], [exactNamespace])
  const inNamespace = useMemo(() => (namespace.trim() && !exactNamespace ? data.filter((release) => release.namespace.includes(namespace.trim())) : data), [data, namespace, exactNamespace])
  const rows = useFilteredRows(inNamespace, fields, search)

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumbs={[{ label: t("Resource Catalog"), to: "/catalog" }, { label: t("Helm Releases") }]}
        title={t("Helm Releases")}
        subtitle={t("Releases stored by Helm in the cluster")}
        actions={<Button onClick={() => setInstalling(true)} className="gap-1.5"><Plus className="size-4" />{t("Install chart")}</Button>}
      />
      <Toolbar right={<FilterInput value={search} onChange={setSearch} fields={fields} rows={inNamespace} placeholder={t("Filter, e.g. chart:victoria")} />}>
        <Button size="sm" variant="outline" onClick={reload} className="gap-2"><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />{t("Refresh")}</Button>
        <Combobox value={namespace} onChange={setNamespace} options={namespaces.filter((ns) => ns !== "all")} placeholder={t("All namespaces")} aria-label={t("Namespace")} />
      </Toolbar>
      {error && <ErrorNote>{error}</ErrorNote>}
      <DataTable
        loading={loading && data.length === 0}
        rows={rows}
        rowKey={(release) => `${release.namespace}/${release.name}`}
        empty={<EmptyState icon={Package} title={data.length ? t("No matching releases") : t("No Helm releases")} action={<Button size="sm" onClick={() => setInstalling(true)}>{t("Install chart")}</Button>} />}
        columns={[
          {
            header: t("Name"),
            cell: (release) => (
              <div className="flex flex-col">
                <Link to={helmReleasePath(release)} className="font-medium hover:text-primary transition-colors">{release.name}</Link>
                <span className="text-xs text-muted-foreground">{release.namespace}</span>
              </div>
            ),
          },
          { header: t("Chart"), cell: (release) => <span className="font-mono text-xs">{release.chart}-{release.chartVersion}</span> },
          { header: t("App version"), cell: (release) => <span className="font-mono text-xs text-muted-foreground">{release.appVersion || "-"}</span> },
          { header: t("Revision"), cell: (release) => <span className="text-sm tabular-nums">{release.revision}</span> },
          { header: t("Status"), cell: (release) => <StatusDot status={release.status} /> },
          { header: t("Updated"), className: "text-right", cell: (release) => <span className="text-sm text-muted-foreground tabular-nums" title={release.updated}>{relativeTime(release.updated)}</span> },
          {
            header: "",
            className: "w-24 text-right",
            cell: (release) => (
              <div className="flex justify-end">
                <Button asChild size="icon" variant="ghost" aria-label={t("Edit values of {name}", { name: release.name })}><Link to={helmReleasePath(release, "values")}><Pencil className="size-4 text-muted-foreground" /></Link></Button>
                <Button size="icon" variant="ghost" aria-label={t("Uninstall {name}", { name: release.name })} onClick={() => setRemoving(release)}><Trash2 className="size-4 text-muted-foreground" /></Button>
              </div>
            ),
          },
        ]}
      />
      <InstallChartDialog open={installing} onOpenChange={setInstalling} onInstalled={(release) => navigate(helmReleasePath(release))} />
      <UninstallDialog release={removing} onOpenChange={(open) => !open && setRemoving(null)} onDone={reload} />
    </div>
  )
}

export function UninstallDialog({ release, onOpenChange, onDone }: { release: HelmRelease | null; onOpenChange: (open: boolean) => void; onDone: () => void }) {
  return (
    <ConfirmDialog
      open={release !== null}
      onOpenChange={onOpenChange}
      title={t("Uninstall {name}?", { name: release?.name })}
      description={t("Deletes every resource of release {name} in namespace {namespace}. Persistent volumes may remain.", { name: release?.name, namespace: release?.namespace })}
      destructive
      confirmLabel={t("Uninstall")}
      onConfirm={async () => {
        if (!release) return
        await uninstallRelease(release.namespace, release.name)
        toast.success(t("Uninstalled {name}", { name: release.name }))
        onDone()
      }}
    />
  )
}

// --- Detail ---

type DetailTab = "values" | "defaults" | "manifest" | "history" | "notes"

const detailTabs: Array<{ id: DetailTab; label: string }> = [
  { id: "values", label: "Values" },
  { id: "defaults", label: "Chart defaults" },
  { id: "manifest", label: "Manifest" },
  { id: "history", label: "History" },
  { id: "notes", label: "Notes" },
]

export function HelmReleaseDetailPage() {
  const { namespace = "", name = "" } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [removing, setRemoving] = useState(false)
  const [changingVersion, setChangingVersion] = useState(false)
  const { data: release, loading, error, reload } = useAsync<HelmReleaseDetail | null>(() => getRelease(namespace, name).catch((err) => {
    if (/not found/i.test(String(err))) return null
    throw err
  }), null, [namespace, name])
  const requested = params.get("tab") as DetailTab | null
  const tab = requested && detailTabs.some((item) => item.id === requested) ? requested : "values"

  if (loading && !release) return <LoadingState />
  if (!release) return error ? <ErrorNote>{error}</ErrorNote> : <EmptyState icon={Package} title={t("Release not found")} action={<Button asChild variant="outline" size="sm"><Link to="/catalog/helm">{t("Back")}</Link></Button>} />

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: t("Helm Releases"), to: "/catalog/helm" }, { label: namespace }, { label: name }]}
        title={name}
        badge={<StatusDot status={release.status} />}
        subtitle={<span className="font-mono text-xs">{release.chart}-{release.chartVersion}</span>}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={reload} className="gap-2"><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />{t("Refresh")}</Button>
            <Button variant="outline" size="sm" onClick={() => setChangingVersion(true)}>{t("Change version")}</Button>
            <Button variant="destructive" size="sm" onClick={() => setRemoving(true)}>{t("Uninstall")}</Button>
          </>
        }
      />
      <Panel title={t("Basic information")}>
        <KeyValueGrid items={[
          { label: t("Namespace"), value: namespace },
          { label: t("Chart"), value: <span className="font-mono">{release.chart}</span> },
          { label: t("Chart version"), value: <span className="font-mono">{release.chartVersion}</span> },
          { label: t("App version"), value: <span className="font-mono">{release.appVersion || "-"}</span> },
          { label: t("Revision"), value: release.revision },
          { label: t("Updated"), value: <span title={release.updated}>{relativeTime(release.updated)}</span> },
          { label: t("Repository"), value: <span className="font-mono break-all">{release.source?.repo || t("Unknown")}</span> },
          { label: t("Description"), value: release.chartInfo?.description || release.description || "-" },
        ]} />
      </Panel>
      <TabBar<DetailTab> tabs={detailTabs.map((item) => ({ id: item.id, label: t(item.label) }))} value={tab} onChange={(next) => setParams(next === "values" ? {} : { tab: next }, { replace: true })} />
      {tab === "values" && <ReleaseValues release={release} onSaved={reload} />}
      {tab === "defaults" && <YamlCode value={release.chartValues} className="h-[calc(100dvh-320px)] min-h-[360px]" />}
      {tab === "manifest" && <YamlCode value={release.manifest} className="h-[calc(100dvh-320px)] min-h-[360px]" />}
      {tab === "history" && <ReleaseHistory release={release} onChanged={reload} />}
      {tab === "notes" && (release.notes ? <pre className="overflow-x-auto rounded-lg border bg-card p-4 font-mono text-xs whitespace-pre-wrap">{release.notes}</pre> : <EmptyState title={t("No notes")} />)}
      <UninstallDialog release={removing ? release : null} onOpenChange={setRemoving} onDone={() => navigate("/catalog/helm")} />
      <ChangeVersionDialog open={changingVersion} onOpenChange={setChangingVersion} release={release} onDone={reload} />
    </div>
  )
}

/** Shown when the chart's source is unknown and Helm needs the chart again. */
function SourcePrompt({ source, onChange }: { source: ChartSource; onChange: (source: ChartSource) => void }) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <p className="text-sm">{t("Where does this chart come from? It has subcharts, which Helm does not keep in the release.")}</p>
      <ChartSourceFields source={source} onChange={onChange} lockChart />
    </div>
  )
}

function ReleaseValues({ release, onSaved }: { release: HelmReleaseDetail; onSaved: () => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const [askSource, setAskSource] = useState(false)
  const [source, setSource] = useState<ChartSource>({ repo: release.source?.repo || guessRepository(release.chart), chart: release.chart, version: release.chartVersion })
  const diff = useMemo(() => (draft === null ? [] : lineDiff(release.values, draft)), [draft, release.values])
  const added = diff.filter((line) => line.type === "add").length
  const removed = diff.filter((line) => line.type === "del").length

  const review = () => {
    const problem = yamlProblem(draft ?? "")
    if (problem) return setError(problem)
    if (!diff.some((line) => line.type !== "same")) return setError(t("No changes to save."))
    setError("")
    setPending(true)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{draft === null ? t("Values set for this release, on top of the chart defaults.") : t("Editing. Applying runs helm upgrade with these values; values left out return to the chart default.")}</p>
        <div className="flex gap-2">
          {draft === null ? (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setDraft(release.values)}><Pencil className="size-3.5" />{t("Edit values")}</Button>
          ) : (
            <>
              <Button size="sm" variant="outline" onClick={() => { setDraft(null); setError("") }}>{t("Cancel")}</Button>
              <Button size="sm" onClick={review}>{t("Review and apply")}</Button>
            </>
          )}
        </div>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      {draft === null ? (
        release.values ? <YamlCode value={release.values} className="h-[calc(100dvh-360px)] min-h-[320px]" /> : <EmptyState title={t("No values set; the chart defaults apply.")} action={<Button size="sm" variant="outline" onClick={() => setDraft("")}>{t("Edit values")}</Button>} />
      ) : (
        <ValuesEditor values={draft} onChange={setDraft} defaults={release.chartValues} className="h-[calc(100dvh-400px)] min-h-[320px]" />
      )}
      <ConfirmDialog
        open={pending}
        onOpenChange={setPending}
        title={t("Upgrade {name} with the new values?", { name: release.name })}
        description={t("{added} lines added, {removed} removed. Helm creates revision {revision}.", { added, removed, revision: release.revision + 1 })}
        confirmLabel={t("Apply")}
        className="sm:max-w-3xl"
        onConfirm={async () => {
          try {
            await upgradeRelease(release.namespace, release.name, draft ?? "", askSource ? source : undefined)
          } catch (err) {
            if (needsSource(err) && !askSource) {
              setAskSource(true)
              throw new Error(t("Enter the chart repository, then apply again."))
            }
            throw err
          }
          toast.success(t("Upgraded {name}", { name: release.name }))
          setDraft(null)
          setAskSource(false)
          onSaved()
        }}
      >
        <div className="space-y-3">
          {askSource && <SourcePrompt source={source} onChange={setSource} />}
          <YamlDiff lines={diff} className="max-h-[50dvh]" />
        </div>
      </ConfirmDialog>
    </div>
  )
}

function ChangeVersionDialog({ open, onOpenChange, release, onDone }: { open: boolean; onOpenChange: (open: boolean) => void; release: HelmReleaseDetail; onDone: () => void }) {
  const initial = { repo: release.source?.repo || guessRepository(release.chart), chart: release.chart, version: release.chartVersion }
  const [source, setSource] = useState<ChartSource>(initial)
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) setSource(initial)
      }}
      title={t("Change chart version of {name}", { name: release.name })}
      description={t("Runs helm upgrade with the current values and the chosen chart version.")}
      confirmLabel={t("Upgrade")}
      className="sm:max-w-2xl"
      onConfirm={async () => {
        if (!source.repo) throw new Error(t("Enter the chart repository."))
        await upgradeRelease(release.namespace, release.name, release.values, source)
        toast.success(t("Upgraded {name}", { name: release.name }))
        onDone()
      }}
    >
      <ChartSourceFields source={source} onChange={setSource} lockChart />
    </ConfirmDialog>
  )
}

function ReleaseHistory({ release, onChanged }: { release: HelmReleaseDetail; onChanged: () => void }) {
  const { data, loading, reload } = useAsync(() => releaseHistory(release.namespace, release.name), [] as HelmRelease[], [release.namespace, release.name, release.revision])
  const [target, setTarget] = useState<HelmRelease | null>(null)
  return (
    <>
      <DataTable
        loading={loading && data.length === 0}
        rows={data}
        rowKey={(item) => String(item.revision)}
        columns={[
          { header: t("Revision"), cell: (item) => <span className="text-sm font-medium tabular-nums">{item.revision}</span> },
          { header: t("Status"), cell: (item) => <StatusDot status={item.status} /> },
          { header: t("Chart"), cell: (item) => <span className="font-mono text-xs">{item.chart}-{item.chartVersion}</span> },
          { header: t("Description"), cell: (item) => <span className="text-sm text-muted-foreground">{item.description}</span> },
          { header: t("Updated"), cell: (item) => <span className="text-sm text-muted-foreground tabular-nums" title={item.updated}>{relativeTime(item.updated)}</span> },
          { header: "", className: "w-28 text-right", cell: (item) => item.revision === release.revision ? null : <Button size="sm" variant="ghost" onClick={() => setTarget(item)}>{t("Roll back")}</Button> },
        ]}
      />
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => !open && setTarget(null)}
        title={t("Roll back {name} to revision {revision}?", { name: release.name, revision: target?.revision })}
        description={t("Helm reapplies the manifests and values of that revision as a new revision.")}
        confirmLabel={t("Roll back")}
        onConfirm={async () => {
          if (!target) return
          await rollbackRelease(release.namespace, release.name, target.revision)
          toast.success(t("Rolled back to revision {revision}", { revision: target.revision }))
          reload()
          onChanged()
        }}
      />
    </>
  )
}
