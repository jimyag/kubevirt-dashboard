import { useMemo, useState } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom"
import * as YAML from "js-yaml"
import { toast } from "sonner"
import { GitFork, Package, PackageSearch, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
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
  Pager,
  Panel,
  StatusDot,
  TabBar,
  Toolbar,
} from "@/components/console"
import { YamlCode, YamlDiff } from "@/components/yaml-editor"
import { useFilteredRows, usePaged, type FilterField } from "@/lib/filter"
import { consoleObjectPath } from "@/lib/events"
import { resourceConfigs } from "@/resources/configs"
import { relativeTime, useAsync, useNamespaces } from "@/lib/kube"
import {
  chartInfo,
  getRelease,
  guessRepository,
  helmReleasePath,
  installRelease,
  knownRepositories,
  listRepositories,
  listRepositoryCharts,
  listReleases,
  needsSource,
  refreshRepository,
  releaseHistory,
  releaseResources,
  removeRepository,
  rollbackRelease,
  saveRepository,
  uninstallRelease,
  upgradeRelease,
  type ChartSource,
  type HelmRelease,
  type HelmReleaseDetail,
  type HelmResource,
  type HelmRepository,
  type RepositoryChart,
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
export function ChartSourceFields({ source, onChange, lockChart, onDefaults, repositories = [] }: { source: ChartSource; onChange: (source: ChartSource) => void; lockChart?: boolean; onDefaults?: (values: string) => void; repositories?: HelmRepository[] }) {
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
        <FieldRow label={t("Repository")} hint={t("Select a saved repository or enter an HTTP or OCI source.")}>
          <Combobox value={source.repo} onChange={(repo) => { onChange({ ...source, repo }); setVersions(null) }} options={[...repositories.map((item) => ({ value: item.url, hint: item.name })), ...knownRepositories.filter((item) => !repositories.some((repo) => repo.url === item.value))]} placeholder="https://..." aria-label={t("Repository")} className="w-full font-mono" />
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
  const { data: repositories } = useAsync(listRepositories, [] as HelmRepository[], [])
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
        <ChartSourceFields source={form} onChange={(source) => set({ ...source, name: form.name || source.chart })} onDefaults={(values) => { setDefaults(values); setForm((current) => ({ ...current, values: current.values || values })) }} repositories={repositories} />
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
        breadcrumbs={[{ label: t("Applications") }, { label: t("Installed Applications") }]}
        title={t("Installed Applications")}
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

export function InstalledApplicationsPage() {
  return <HelmReleaseListPage />
}

const catalogFields: FilterField<RepositoryChart>[] = [
  { key: "chart", label: "Chart", value: (chart) => chart.name },
  { key: "repository", label: "Repository", aliases: ["repo"], value: (chart) => chart.repository },
  { key: "version", label: "Version", value: (chart) => chart.versions },
  { key: "app", label: "App version", value: (chart) => chart.appVersion },
  { key: "description", label: "Description", value: (chart) => chart.description },
]

export function ApplicationCatalogPage() {
  const navigate = useNavigate()
  const [search, setSearch] = useState("")
  const [installing, setInstalling] = useState<RepositoryChart | null>(null)
  const { data, loading, error, reload } = useAsync(async () => {
    const repositories = await listRepositories()
    const catalogs = await Promise.all(repositories
      .filter((repository) => repository.type === "HTTP")
      .map(async (repository) => {
        try {
          return { charts: await listRepositoryCharts(repository.name), error: "" }
        } catch (err) {
          return { charts: [] as RepositoryChart[], error: `${repository.name}: ${err instanceof Error ? err.message : String(err)}` }
        }
      }))
    return {
      repositories,
      charts: catalogs.flatMap((catalog) => catalog.charts),
      errors: catalogs.map((catalog) => catalog.error).filter(Boolean),
    }
  }, { repositories: [] as HelmRepository[], charts: [] as RepositoryChart[], errors: [] as string[] }, [])
  const rows = useFilteredRows(data.charts, catalogFields, search)
  const oci = data.repositories.filter((repository) => repository.type === "OCI")

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumbs={[{ label: t("Applications") }, { label: t("Application Catalog") }]}
        title={t("Application Catalog")}
        subtitle={t("Charts available from saved repositories")}
        actions={<Button onClick={() => navigate("/applications/repositories")} variant="outline" className="gap-1.5"><GitFork className="size-4" />{t("Manage repositories")}</Button>}
      />
      <Toolbar right={<FilterInput value={search} onChange={setSearch} fields={catalogFields} rows={data.charts} placeholder={t("Filter, e.g. repository:prometheus")} />}>
        <Button size="sm" variant="outline" onClick={reload} className="gap-2"><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />{t("Refresh")}</Button>
        <span className="text-sm text-muted-foreground">{t("{count} charts", { count: data.charts.length })}</span>
      </Toolbar>
      {error && <ErrorNote>{error}</ErrorNote>}
      {data.errors.map((item) => <ErrorNote key={item}>{item}</ErrorNote>)}
      {data.repositories.length === 0 && !loading && (
        <EmptyState icon={PackageSearch} title={t("No application repositories")} description={t("Add an HTTP repository to browse its charts, or install an OCI chart by reference.")} action={<Button size="sm" onClick={() => navigate("/applications/repositories")}>{t("Manage repositories")}</Button>} />
      )}
      <DataTable
        loading={loading}
        rows={rows}
        rowKey={(chart) => `${chart.repository}/${chart.name}`}
        empty={<EmptyState icon={PackageSearch} title={data.charts.length ? t("No matching charts") : t("No charts")} />}
        columns={[
          {
            header: t("Chart"),
            cell: (chart) => (
              <div className="min-w-0">
                <div className="font-medium">{chart.name}</div>
                <div className="max-w-md break-words text-xs text-muted-foreground">{chart.description || "-"}</div>
              </div>
            ),
          },
          { header: t("Repository"), cell: (chart) => <span className="font-mono text-xs">{chart.repository}</span> },
          { header: t("Latest version"), cell: (chart) => <span className="font-mono text-xs">{chart.version}</span> },
          { header: t("App version"), cell: (chart) => <span className="font-mono text-xs text-muted-foreground">{chart.appVersion || "-"}</span> },
          { header: t("Versions"), cell: (chart) => <span className="text-sm tabular-nums">{chart.versions.length}</span> },
          { header: "", className: "w-24 text-right", cell: (chart) => <Button size="sm" variant="outline" onClick={() => setInstalling(chart)}>{t("Install")}</Button> },
        ]}
      />
      {oci.length > 0 && (
        <Panel title={t("OCI sources")} description={t("OCI registries do not provide a complete chart catalog. Enter the chart reference in the install dialog.")}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap gap-2">
              {oci.map((repository) => <Badge key={repository.name} variant="outline" className="font-mono">{repository.name}</Badge>)}
            </div>
            <Button size="sm" variant="outline" onClick={() => setInstalling({ repository: "", repositoryURL: oci[0].url, name: "", version: "", appVersion: "", description: "", versions: [] })}>{t("Install by reference")}</Button>
          </div>
        </Panel>
      )}
      {installing && (
        <InstallChartDialog
          key={`${installing.repository}/${installing.name}`}
          open
          onOpenChange={(open) => !open && setInstalling(null)}
          onInstalled={(release) => navigate(helmReleasePath(release))}
          initial={installing.repository ? { repo: installing.repositoryURL, chart: installing.name, version: installing.version, name: installing.name } : undefined}
        />
      )}
    </div>
  )
}

type RepositoryForm = { name: string; url: string; username: string; password: string }
const blankRepository: RepositoryForm = { name: "", url: "", username: "", password: "" }

function RepositoryDialog({ open, onOpenChange, repository, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; repository: HelmRepository | null; onSaved: () => void }) {
  const [form, setForm] = useState<RepositoryForm>(() => repository ? { name: repository.name, url: repository.url, username: repository.username || "", password: "" } : blankRepository)
  const editing = repository !== null
  const set = (patch: Partial<RepositoryForm>) => setForm((current) => ({ ...current, ...patch }))
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) setForm(repository ? { name: repository.name, url: repository.url, username: repository.username || "", password: "" } : blankRepository)
      }}
      title={editing ? t("Edit repository {name}", { name: repository.name }) : t("Add repository")}
      description={t("HTTP repositories can be browsed. OCI sources are installed by chart reference.")}
      confirmLabel={editing ? t("Save") : t("Add")}
      className="sm:max-w-2xl"
      onConfirm={async () => {
        if (!form.name) throw new Error(t("Enter a repository name."))
        if (!isDnsLabel(form.name)) throw new Error(t("Repository name must be at most 63 lowercase letters, digits and dashes."))
        if (!form.url) throw new Error(t("Enter a repository URL."))
        await saveRepository(form)
        toast.success(editing ? t("Updated {name}", { name: form.name }) : t("Added {name}", { name: form.name }))
        onSaved()
      }}
    >
      <div className="grid gap-4">
        <FieldRow label={t("Name")}><Input value={form.name} disabled={editing} onChange={(event) => set({ name: event.target.value.trim() })} className="font-mono" /></FieldRow>
        <FieldRow label={t("URL")} hint="https://... or oci://..."><Input value={form.url} onChange={(event) => set({ url: event.target.value.trim() })} className="font-mono" /></FieldRow>
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldRow label={t("Username")}><Input value={form.username} autoComplete="username" onChange={(event) => set({ username: event.target.value })} className="font-mono" /></FieldRow>
          <FieldRow label={t("Password")} hint={editing ? t("Leave empty to keep the saved password.") : undefined}><Input type="password" value={form.password} autoComplete="new-password" onChange={(event) => set({ password: event.target.value })} /></FieldRow>
        </div>
      </div>
    </ConfirmDialog>
  )
}

export function ApplicationRepositoriesPage() {
  const [editing, setEditing] = useState<HelmRepository | null | undefined>(undefined)
  const [removing, setRemoving] = useState<HelmRepository | null>(null)
  const [refreshing, setRefreshing] = useState("")
  const { data, loading, error, reload } = useAsync(listRepositories, [] as HelmRepository[], [])
  const refreshOne = async (repository: HelmRepository) => {
    setRefreshing(repository.name)
    try {
      await refreshRepository(repository.name)
      toast.success(t("Refreshed {name}", { name: repository.name }))
      reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setRefreshing("")
    }
  }
  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumbs={[{ label: t("Applications") }, { label: t("Application Repositories") }]}
        title={t("Application Repositories")}
        subtitle={t("Chart sources available to the application catalog")}
        actions={<Button onClick={() => setEditing(null)} className="gap-1.5"><Plus className="size-4" />{t("Add repository")}</Button>}
      />
      <Toolbar>
        <Button size="sm" variant="outline" onClick={reload} className="gap-2"><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />{t("Refresh")}</Button>
        <span className="text-sm text-muted-foreground">{t("{count} repositories", { count: data.length })}</span>
      </Toolbar>
      {error && <ErrorNote>{error}</ErrorNote>}
      <DataTable
        loading={loading && data.length === 0}
        rows={data}
        rowKey={(repository) => repository.name}
        empty={<EmptyState icon={GitFork} title={t("No application repositories")} action={<Button size="sm" onClick={() => setEditing(null)}>{t("Add repository")}</Button>} />}
        columns={[
          {
            header: t("Name"),
            cell: (repository) => (
              <div className="min-w-0">
                <div className="font-medium">{repository.name}</div>
                {repository.username && <div className="text-xs text-muted-foreground">{repository.username}</div>}
              </div>
            ),
          },
          { header: t("URL"), cell: (repository) => <span className="block max-w-lg break-all font-mono text-xs">{repository.url}</span> },
          { header: t("Type"), cell: (repository) => <Badge variant="outline" className="font-mono">{repository.type}</Badge> },
          { header: t("Charts"), cell: (repository) => repository.type === "OCI" ? <span className="text-sm text-muted-foreground">{t("Not enumerable")}</span> : <span className="text-sm tabular-nums">{repository.chartCount}</span> },
          { header: t("Status"), cell: (repository) => repository.error ? <span title={repository.error}><StatusDot status="Error" /></span> : <StatusDot status={repository.type === "OCI" ? "Configured" : "Ready"} /> },
          { header: t("Updated"), cell: (repository) => repository.updatedAt ? <span className="text-sm text-muted-foreground tabular-nums" title={repository.updatedAt}>{relativeTime(repository.updatedAt)}</span> : <span className="text-sm text-muted-foreground">-</span> },
          {
            header: "",
            className: "w-32 text-right",
            cell: (repository) => (
              <div className="flex justify-end">
                <Button size="icon" variant="ghost" aria-label={t("Refresh {name}", { name: repository.name })} disabled={refreshing === repository.name} onClick={() => void refreshOne(repository)}><RefreshCw className={cn("size-4 text-muted-foreground", refreshing === repository.name && "animate-spin")} /></Button>
                <Button size="icon" variant="ghost" aria-label={t("Edit {name}", { name: repository.name })} onClick={() => setEditing(repository)}><Pencil className="size-4 text-muted-foreground" /></Button>
                <Button size="icon" variant="ghost" aria-label={t("Remove {name}", { name: repository.name })} onClick={() => setRemoving(repository)}><Trash2 className="size-4 text-muted-foreground" /></Button>
              </div>
            ),
          },
        ]}
      />
      {editing !== undefined && <RepositoryDialog key={editing?.name || "new"} open onOpenChange={(open) => !open && setEditing(undefined)} repository={editing} onSaved={reload} />}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t("Remove repository {name}?", { name: removing?.name })}
        description={t("Installed applications remain in the cluster. Charts from this source will no longer appear in the catalog.")}
        confirmLabel={t("Remove")}
        destructive
        onConfirm={async () => {
          if (!removing) return
          await removeRepository(removing.name)
          toast.success(t("Removed {name}", { name: removing.name }))
          reload()
        }}
      />
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

type DetailTab = "resources" | "values" | "defaults" | "manifest" | "history" | "notes"

const detailTabs: Array<{ id: DetailTab; label: string }> = [
  { id: "resources", label: "Resources" },
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
  const tab = requested && detailTabs.some((item) => item.id === requested) ? requested : "resources"

  if (loading && !release) return <LoadingState />
  if (!release) return error ? <ErrorNote>{error}</ErrorNote> : <EmptyState icon={Package} title={t("Release not found")} action={<Button asChild variant="outline" size="sm"><Link to="/applications/installed">{t("Back")}</Link></Button>} />

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: t("Installed Applications"), to: "/applications/installed" }, { label: namespace }, { label: name }]}
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
      <TabBar<DetailTab> tabs={detailTabs.map((item) => ({ id: item.id, label: t(item.label) }))} value={tab} onChange={(next) => setParams(next === "resources" ? {} : { tab: next }, { replace: true })} />
      {tab === "resources" && <ReleaseResources release={release} />}
      {tab === "values" && <ReleaseValues release={release} onSaved={reload} />}
      {tab === "defaults" && <YamlCode value={release.chartValues} className="h-[calc(100dvh-320px)] min-h-[360px]" />}
      {tab === "manifest" && <YamlCode value={release.manifest} className="h-[calc(100dvh-320px)] min-h-[360px]" />}
      {tab === "history" && <ReleaseHistory release={release} onChanged={reload} />}
      {tab === "notes" && (release.notes ? <pre className="overflow-x-auto rounded-lg border bg-card p-4 font-mono text-xs whitespace-pre-wrap">{release.notes}</pre> : <EmptyState title={t("No notes")} />)}
      <UninstallDialog release={removing ? release : null} onOpenChange={setRemoving} onDone={() => navigate("/applications/installed")} />
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

const apiGroup = (path: string) => /^\/apis\/([^/]+)\//.exec(path)?.[1] ?? ""

/** Console page of a release object: a dedicated page, else the Resource Catalog page of its kind. */
const resourcePath = (item: HelmResource) => {
  if (!item.exists) return null
  const dedicated = consoleObjectPath(item)
  if (dedicated) return dedicated
  const group = item.apiVersion.includes("/") ? item.apiVersion.split("/")[0] : ""
  const candidates = Object.values(resourceConfigs).filter((candidate) => candidate.kind === item.kind && apiGroup(candidate.listPath) === group)
  // Pages filtered by label (SSH keys are Secrets) only hold some objects of their kind.
  const config = candidates.find((candidate) => !candidate.listQuery) ?? candidates[0]
  return config ? `${config.path}/${item.namespace || "_cluster"}/${item.name}` : null
}

const resourceFields: FilterField<HelmResource>[] = [
  { key: "name", label: "Name", value: (item) => item.name },
  { key: "kind", label: "Kind", value: (item) => item.kind },
  { key: "namespace", label: "Namespace", aliases: ["ns"], value: (item) => item.namespace || "" },
  { key: "status", label: "Status", value: (item) => item.status },
]

/** Objects the release created, with live status; missing ones were deleted outside Helm. */
function ReleaseResources({ release }: { release: HelmReleaseDetail }) {
  const { data, loading, error, reload } = useAsync(() => releaseResources(release.namespace, release.name), [] as HelmResource[], [release.namespace, release.name, release.revision])
  const [search, setSearch] = useState("")
  const rows = useFilteredRows(data, resourceFields, search)
  const paging = usePaged(rows, 50)
  return (
    <div className="space-y-3">
      <Toolbar right={<FilterInput value={search} onChange={setSearch} fields={resourceFields} rows={data} placeholder={t("Filter, e.g. kind:Deployment")} />}>
        <Button size="sm" variant="outline" onClick={reload} className="gap-2"><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />{t("Refresh")}</Button>
        <span className="text-sm text-muted-foreground">{t("{count} objects", { count: data.length })}</span>
      </Toolbar>
      {error && <ErrorNote>{error}</ErrorNote>}
      <DataTable
        loading={loading && data.length === 0}
        rows={paging.rows}
        rowKey={(item) => `${item.apiVersion}/${item.kind}/${item.namespace}/${item.name}`}
        empty={<EmptyState title={data.length ? t("No matching objects") : t("No objects")} />}
        columns={[
          {
            header: t("Name"),
            cell: (item) => {
              const path = resourcePath(item)
              return (
                <div className="flex flex-col">
                  {path ? <Link to={path} className="font-medium hover:text-primary transition-colors">{item.name}</Link> : <span className="font-medium">{item.name}</span>}
                  {item.namespace && <span className="text-xs text-muted-foreground">{item.namespace}</span>}
                </div>
              )
            },
          },
          { header: t("Kind"), cell: (item) => <span className="font-mono text-xs">{item.kind}</span> },
          { header: t("API version"), cell: (item) => <span className="font-mono text-xs text-muted-foreground">{item.apiVersion}</span> },
          { header: t("Status"), cell: (item) => <span className="inline-flex items-center gap-2" title={item.detail}><StatusDot status={item.status} />{item.detail && /^\d+\/\d+$/.test(item.detail) && <span className="text-xs text-muted-foreground tabular-nums">{item.detail}</span>}</span> },
          { header: t("Created"), className: "text-right", cell: (item) => item.created ? <span className="text-sm text-muted-foreground tabular-nums" title={item.created}>{relativeTime(item.created)}</span> : <span className="text-sm text-muted-foreground">-</span> },
        ]}
      />
      <Pager {...paging} />
    </div>
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
