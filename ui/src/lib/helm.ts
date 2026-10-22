import { requestJson } from "./kube"

/** Helm releases through the dashboard's /api/v1/helm endpoints (Helm SDK on the server). */

const HELM = "/api/v1/helm"

export type HelmRelease = {
  name: string
  namespace: string
  revision: number
  status: string
  chart: string
  chartVersion: string
  appVersion: string
  updated: string
  description: string
}

/** Repository URL ("https://..." or "oci://...") plus chart name. */
export type ChartSource = { repo: string; chart: string; version?: string }

export type HelmReleaseDetail = HelmRelease & {
  source?: ChartSource
  values: string
  chartValues: string
  manifest: string
  notes: string
  chartInfo: { description?: string; home?: string; sources?: string[]; icon?: string }
}

export type ChartInfo = { name: string; version: string; appVersion: string; description: string; values: string; versions: string[] | null }

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
const releasePath = (namespace: string, name: string) => `${HELM}/releases/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`

export const helmReleasePath = (release: Pick<HelmRelease, "namespace" | "name">, tab?: string) =>
  `/catalog/helm/${release.namespace}/${release.name}${tab ? `?tab=${tab}` : ""}`

export const listReleases = async (namespace?: string): Promise<HelmRelease[]> => {
  const data = await requestJson(`${HELM}/releases${namespace ? `?namespace=${encodeURIComponent(namespace)}` : ""}`, { method: "GET" }) as { items?: HelmRelease[] }
  return data.items || []
}

export const getRelease = async (namespace: string, name: string) => await requestJson(releasePath(namespace, name), { method: "GET" }) as HelmReleaseDetail

export const releaseHistory = async (namespace: string, name: string): Promise<HelmRelease[]> => {
  const data = await requestJson(`${releasePath(namespace, name)}/history`, { method: "GET" }) as { items?: HelmRelease[] }
  return data.items || []
}

export const installRelease = (input: ChartSource & { namespace: string; name: string; values: string }) =>
  requestJson(`${HELM}/releases`, json("POST", input)) as Promise<HelmRelease>

/** Replaces the release's values. A source switches chart or version, or tells the server where the chart comes from. */
export const upgradeRelease = (namespace: string, name: string, values: string, source?: ChartSource) =>
  requestJson(releasePath(namespace, name), json("PUT", { values, ...source })) as Promise<HelmRelease>

export const rollbackRelease = (namespace: string, name: string, revision: number) => requestJson(`${releasePath(namespace, name)}/rollback`, json("POST", { revision }))

export const uninstallRelease = (namespace: string, name: string) => requestJson(releasePath(namespace, name), { method: "DELETE" })

export const chartInfo = async (source: ChartSource) => {
  const params = new URLSearchParams({ repo: source.repo, chart: source.chart, ...(source.version ? { version: source.version } : {}) })
  return await requestJson(`${HELM}/chart?${params}`, { method: "GET" }) as ChartInfo
}

/** The server answers 409 when a chart with subcharts is edited without knowing where it comes from. */
export const needsSource = (err: unknown) => err instanceof Error && /subcharts/.test(err.message)

/** Well-known repositories, offered as suggestions; any HTTP or OCI repository works. */
export const knownRepositories = [
  { value: "https://prometheus-community.github.io/helm-charts", hint: "prometheus-community" },
  { value: "oci://ghcr.io/prometheus-community/charts", hint: "prometheus-community (OCI)" },
  { value: "https://victoriametrics.github.io/helm-charts/", hint: "victoriametrics" },
  { value: "oci://ghcr.io/victoriametrics/helm-charts", hint: "victoriametrics (OCI)" },
]

/** Repository a chart usually comes from, to prefill the source of releases installed elsewhere. */
export const guessRepository = (chart: string) => {
  if (/^(kube-prometheus-stack|prometheus|prometheus-.*|kube-state-metrics|alertmanager)$/.test(chart)) return knownRepositories[0].value
  if (chart.startsWith("victoria-")) return knownRepositories[2].value
  return ""
}
