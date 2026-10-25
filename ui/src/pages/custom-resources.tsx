import { useMemo, useState } from "react"
import { Link, Navigate, useNavigate, useParams } from "react-router-dom"
import { ErrorNote, FilterInput, LoadingState, NativeSelect, PageHeader, Pager } from "@/components/console"
import { Button } from "@/components/ui/button"
import { RefreshCw } from "lucide-react"
import { ResourceDetail, ResourceEvents, ResourceList, ResourceManifest, type ResourceConfig } from "@/components/resource-management"
import { requestJson, useAsync } from "@/lib/kube"
import type { CrdDefinition } from "@/lib/crd-discovery"
import { resourceKindLabel, t } from "@/lib/i18n"
import { useFilteredRows, usePaged, type FilterField } from "@/lib/filter"

type DiscoveredResource = { name: string; apiVersion: string; kind: string; namespaced: boolean; verbs: string[] }
type CatalogResource = DiscoveredResource & { versions: string[] }
const catalogFields: FilterField<CatalogResource>[] = [
  { key: "kind", label: "Kind", value: (item) => item.kind },
  { key: "name", label: "Name", value: (item) => item.name },
  { key: "apiVersion", label: "API version", value: (item) => item.versions.map((version) => `${item.apiVersion.split("/")[0]}/${version}`) },
]
const definitionsUrl = "/apis/apiextensions.k8s.io/v1/customresourcedefinitions"

export function CustomResourceCatalog({ envoy = false }: { envoy?: boolean }) {
  const [search, setSearch] = useState("")
  const { data, loading, error, reload } = useAsync(async () => {
    const [definitions, discovery] = await Promise.all([
      requestJson(definitionsUrl, { headers: { Accept: "application/json;as=PartialObjectMetadataList;g=meta.k8s.io;v=v1" } }) as Promise<{ items: Array<{ metadata: { name: string } }> }>,
      requestJson("/api/v1/discovery", {}) as Promise<{ apiResources: DiscoveredResource[] }>,
    ])
    const names = new Set(definitions.items.map((item) => item.metadata.name))
    const resources = new Map<string, DiscoveredResource & { versions: string[] }>()
    for (const resource of discovery.apiResources) {
      const [group, version] = resource.apiVersion.split("/")
      const key = `${resource.name}.${group}`
      if (!names.has(key) || (envoy && group !== "gateway.envoyproxy.io")) continue
      const existing = resources.get(key)
      if (existing) existing.versions.push(version)
      else resources.set(key, { ...resource, versions: [version] })
    }
    return [...resources.values()].sort((a, b) => a.apiVersion.localeCompare(b.apiVersion) || a.kind.localeCompare(b.kind))
  }, [], [envoy])
  const rows = useFilteredRows(data, catalogFields, search)
  const { rows: pageRows, ...paging } = usePaged(rows)
  return <div className="space-y-5">
    <PageHeader title={envoy ? t("Envoy Gateway") : t("Custom resources")} subtitle={envoy ? "gateway.envoyproxy.io" : t("CustomResourceDefinition · served APIs")} actions={<Button size="sm" variant="outline" disabled={loading} onClick={reload}><RefreshCw className="size-3.5" />{t("Refresh")}</Button>} />
    <FilterInput value={search} onChange={setSearch} fields={catalogFields} rows={data} placeholder={t("Search resources...")} />
    {loading ? <LoadingState /> : error ? <ErrorNote>{error}</ErrorNote> : <div className="divide-y rounded-lg border bg-card">
      {pageRows.map((item) => <Link className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-muted/40" key={`${item.apiVersion}/${item.name}`} to={`/catalog/crds/${item.apiVersion.split("/")[0]}/${item.name}`}>
        <div><div className="text-sm font-medium">{resourceKindLabel(item.kind)}</div><div className="break-all font-mono text-xs text-muted-foreground">{item.apiVersion.split("/")[0]} · {item.name}</div></div><span className="font-mono text-xs text-muted-foreground">{item.versions.join(" · ")}</span>
      </Link>)}
      {!rows.length && <p className="p-6 text-sm text-muted-foreground">{t("No resources found")}</p>}
      <Pager {...paging} />
    </div>}
  </div>
}

export function CustomResourcePage({ view = "list" }: { view?: "list" | "detail" | "events" | "manifest" }) {
  const { group = "", plural = "", version, namespace, name } = useParams()
  const navigate = useNavigate()
  const { data, loading, error } = useAsync(async () => {
    const [definition, apiGroup, discovery] = await Promise.all([
      requestJson(`${definitionsUrl}/${plural}.${group}`, {}) as Promise<CrdDefinition>,
      requestJson(`/apis/${group}`, {}) as Promise<{ preferredVersion: { version: string } }>,
      requestJson("/api/v1/discovery", {}) as Promise<{ apiResources: DiscoveredResource[] }>,
    ])
    return { definition, preferred: apiGroup.preferredVersion.version, discovery: discovery.apiResources }
  }, null, [group, plural])
  const config = useMemo<ResourceConfig | null>(() => {
    if (!data || !version) return null
    const definition = data.definition
    const schema = definition.spec.versions.find((item) => item.name === version && item.served)?.schema?.openAPIV3Schema
    if (!schema) return null
    const resource = data.discovery.find((item) => item.apiVersion === `${group}/${version}` && item.name === plural)
    return { id: plural, path: `/catalog/crds/${group}/${plural}/${version}`, title: definition.spec.names.kind, subtitle: `${group}/${version}`, listPath: `/apis/${group}/${version}/${plural}`, resourcePath: `/apis/${group}/${version}`, namespaced: definition.spec.scope === "Namespaced", kind: definition.spec.names.kind, createTemplate: "", schema, allowCreate: resource?.verbs.includes("create") ?? false, allowUpdate: resource?.verbs.includes("update") ?? false, allowDelete: resource?.verbs.includes("delete") ?? false }
  }, [data, version, group, plural])
  if (loading) return <LoadingState />
  if (error || !data) return <ErrorNote>{error || t("Resource not found")}</ErrorNote>
  const versions = data.definition.spec.versions.filter((item) => item.served)
  if (!version) return <Navigate replace to={`/catalog/crds/${group}/${plural}/${versions.some((item) => item.name === data.preferred) ? data.preferred : versions[0]?.name}`} />
  if (!config) return <ErrorNote>{t("No schema is available for this served version.")}</ErrorNote>
  const suffix = name ? `/${encodeURIComponent(namespace || "_cluster")}/${encodeURIComponent(name)}${view === "events" || view === "manifest" ? `/${view}` : ""}` : ""
  return <div className="space-y-4">
    <div className="flex items-center gap-3"><Link className="text-sm text-muted-foreground hover:text-primary" to="/catalog/crds">{t("Custom resources")}</Link><NativeSelect className="w-auto" aria-label={t("API version")} value={version} onChange={(event) => navigate(`/catalog/crds/${group}/${plural}/${event.target.value}${suffix}`)}>{versions.map((item) => <option key={item.name}>{item.name}</option>)}</NativeSelect></div>
    {view === "list" ? <ResourceList config={config} /> : view === "detail" ? <ResourceDetail config={config} /> : view === "events" ? <ResourceEvents config={config} /> : <ResourceManifest config={config} />}
  </div>
}
