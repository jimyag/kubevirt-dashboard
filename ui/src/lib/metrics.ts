import { useCallback, useEffect, useRef, useState } from "react"

import { apiFetch, asRecord, getContext, listItems, str, type KubeObject } from "./kube"
import { t } from "./i18n"
import { usePolling } from "./polling"

// --- Quantities ---

/** Kubernetes CPU quantity ("250m", "1500000n", "2") in cores. */
export const parseCpuCores = (value: unknown) => {
  const text = str(value)
  if (!text) return 0
  const num = parseFloat(text)
  if (Number.isNaN(num)) return 0
  if (text.endsWith("n")) return num / 1e9
  if (text.endsWith("u")) return num / 1e6
  if (text.endsWith("m")) return num / 1e3
  return num
}

/** Kubernetes memory quantity in bytes. */
export const parseBytes = (value: unknown) => {
  const text = str(value)
  if (!text) return 0
  const num = parseFloat(text)
  if (Number.isNaN(num)) return 0
  const units: Record<string, number> = { Ki: 2 ** 10, Mi: 2 ** 20, Gi: 2 ** 30, Ti: 2 ** 40, k: 1e3, K: 1e3, M: 1e6, G: 1e9, T: 1e12 }
  const suffix = text.replace(/^[\d.]+/, "")
  return num * (units[suffix] ?? 1)
}

export const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  const units = ["B", "KiB", "MiB", "GiB", "TiB"]
  const index = Math.max(0, Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024))))
  const value = bytes / 1024 ** index
  return `${value >= 100 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`
}

export const formatRate = (bytesPerSecond: number) => `${formatBytes(bytesPerSecond)}/s`

/** Kubernetes storage quantities such as plain byte counts for display only. */
export const formatStorageSize = (value: unknown) => {
  const text = str(value).trim()
  if (!text) return "N/A"
  return /^\d+(?:\.\d+)?$/.test(text) ? formatBytes(parseBytes(text)) : text
}

// --- metrics-server ---

export type Usage = { cpuCores: number; memoryBytes: number }

const METRICS = "/apis/metrics.k8s.io/v1beta1"

/** Node usage from metrics-server, or null when metrics-server is not installed. */
export const fetchNodeUsage = async (): Promise<Record<string, Usage> | null> => {
  const res = await apiFetch(`${METRICS}/nodes`).catch(() => null)
  if (!res || !res.ok) return null
  const data = await res.json()
  return Object.fromEntries((data.items || []).map((item: KubeObject & { usage?: Record<string, string> }) => [
    item.metadata.name,
    { cpuCores: parseCpuCores(item.usage?.cpu), memoryBytes: parseBytes(item.usage?.memory) },
  ]))
}

/**
 * virt-launcher pod usage keyed by "namespace/vmi". metrics-server copies pod labels onto
 * PodMetrics, so the kubevirt.io/domain label identifies the VMI.
 */
export const fetchInstanceUsage = async (namespace?: string): Promise<Record<string, Usage> | null> => {
  const scope = namespace && namespace !== "all" ? `/namespaces/${namespace}` : ""
  const res = await apiFetch(`${METRICS}${scope}/pods?labelSelector=${encodeURIComponent("kubevirt.io=virt-launcher")}`).catch(() => null)
  if (!res || !res.ok) return null
  const data = await res.json()
  const result: Record<string, Usage> = {}
  for (const item of (data.items || []) as Array<KubeObject & { containers?: Array<{ usage?: Record<string, string> }> }>) {
    const vmi = item.metadata.labels?.["kubevirt.io/domain"] || item.metadata.labels?.["vm.kubevirt.io/name"]
    if (!vmi) continue
    const usage = (item.containers || []).reduce((sum, container) => ({
      cpuCores: sum.cpuCores + parseCpuCores(container.usage?.cpu),
      memoryBytes: sum.memoryBytes + parseBytes(container.usage?.memory),
    }), { cpuCores: 0, memoryBytes: 0 })
    result[`${item.metadata.namespace}/${vmi}`] = usage
  }
  return result
}

/** Polls a metrics-server fetcher; returns null while unavailable. */
export function useMetricsPoll<T>(fetcher: () => Promise<T | null>, deps: unknown[], intervalMs = 30000) {
  const [data, setData] = useState<T | null>(null)
  // Each deps change starts a new generation; late responses from older ones are dropped.
  const generation = useRef(0)
  const latest = useRef(fetcher)
  useEffect(() => {
    latest.current = fetcher
  })
  const tick = useCallback(() => {
    const current = generation.current
    latest.current().then((next) => {
      if (generation.current === current) setData(next)
    })
  }, [])
  useEffect(() => {
    generation.current += 1
    tick()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  usePolling(tick, intervalMs)
  return data
}

// --- Prometheus-compatible query API ---

/**
 * Any backend serving the Prometheus HTTP query API: Prometheus, VictoriaMetrics (single or the
 * vmselect of a cluster), Thanos Query. `path` is the API prefix, e.g. /select/0/prometheus for a
 * VictoriaMetrics cluster; empty for the others.
 */
export type PrometheusConfig = { namespace: string; service: string; port: string; scheme: "http" | "https"; path: string }

const storageKey = () => `prometheus:${getContext()}`
const listeners = new Set<() => void>()

const normalizePath = (path: unknown) => {
  const text = str(path).trim().replace(/\/+$/, "")
  return text && !text.startsWith("/") ? `/${text}` : text
}

export const readPrometheusConfig = (): PrometheusConfig | null => {
  try {
    const raw = localStorage.getItem(storageKey())
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PrometheusConfig>
    if (!parsed.namespace || !parsed.service || !parsed.port) return null
    return { namespace: parsed.namespace, service: parsed.service, port: parsed.port, scheme: parsed.scheme === "https" ? "https" : "http", path: normalizePath(parsed.path) }
  } catch {
    return null
  }
}

export const writePrometheusConfig = (config: PrometheusConfig | null) => {
  try {
    if (config) localStorage.setItem(storageKey(), JSON.stringify({ ...config, path: normalizePath(config.path) }))
    else localStorage.removeItem(storageKey())
  } catch {
    // Without browser storage the setting only lasts for this page view.
  }
  listeners.forEach((listener) => listener())
}

export function usePrometheusConfig() {
  const [config, setConfig] = useState(readPrometheusConfig)
  useEffect(() => {
    const listener = () => setConfig(readPrometheusConfig())
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])
  return config
}

/** The backend reached through the Kubernetes API service proxy, so it needs no external exposure. */
export const prometheusBase = (config: PrometheusConfig) =>
  `/api/v1/namespaces/${config.namespace}/services/${config.scheme}:${config.service}:${config.port}/proxy${normalizePath(config.path)}`

const promRequest = async (config: PrometheusConfig, path: string) => {
  const res = await apiFetch(`${prometheusBase(config)}${path}`)
  const text = await res.text()
  let body: { status?: string; data?: unknown; error?: string; message?: string } = {}
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error(res.ok ? t("The service did not answer with the Prometheus API. Check the port and path.") : `${res.status} ${text.slice(0, 200)}`)
  }
  if (!res.ok || body.status !== "success") throw new Error(body.error || body.message || `${res.status} ${res.statusText}`)
  return body.data
}

export type Series = { labels: Record<string, string>; points: Array<{ t: number; v: number }> }

export const promQueryRange = async (config: PrometheusConfig, query: string, rangeSeconds: number, steps = 120): Promise<Series[]> => {
  const end = Math.floor(Date.now() / 1000)
  const start = end - rangeSeconds
  const step = Math.max(15, Math.floor(rangeSeconds / steps))
  const params = new URLSearchParams({ query, start: String(start), end: String(end), step: String(step) })
  const data = asRecord(await promRequest(config, `/api/v1/query_range?${params}`))
  return ((data.result as Array<{ metric: Record<string, string>; values: Array<[number, string]> }>) || []).map((series) => ({
    labels: series.metric,
    points: series.values.map(([t, v]) => ({ t: t * 1000, v: Number(v) })),
  }))
}

/**
 * Checks the config with an instant query, then names the backend. Prometheus reports its own
 * version with a revision in build info; VictoriaMetrics only reports the Prometheus API version it
 * emulates, but serves /api/v1/status/active_queries, which Prometheus does not.
 */
export const testPrometheus = async (config: PrometheusConfig) => {
  await promRequest(config, `/api/v1/query?query=${encodeURIComponent("vector(1)")}`)
  const info = asRecord(await promRequest(config, "/api/v1/status/buildinfo").catch(() => ({})))
  const version = str(info.version)
  if (info.revision) return { backend: "Prometheus", version }
  const res = await apiFetch(`${prometheusBase(config)}/api/v1/status/active_queries`).catch(() => null)
  if (res?.ok) return { backend: "VictoriaMetrics", version: "" }
  return { backend: "", version }
}

export type BackendCandidate = { kind: string; config: PrometheusConfig }

type ServiceLike = KubeObject & { spec?: { ports?: Array<{ name?: string; port: number }> } }

const portOf = (service: ServiceLike, names: string[], numbers: number[]) => {
  const ports = service.spec?.ports || []
  const match = ports.find((port) => port.name && names.includes(port.name)) || ports.find((port) => numbers.includes(port.port))
  return match ? String(match.port) : ""
}

/** Recognizes the services the common charts and operators create for a query endpoint. */
const candidateFor = (service: ServiceLike): BackendCandidate | null => {
  const name = service.metadata.name
  const labels = service.metadata.labels || {}
  const app = labels["app.kubernetes.io/name"] || labels.app || ""
  const base = { namespace: service.metadata.namespace || "default", service: name, scheme: "http" as const, path: "" }
  if (/^vmselect-|vmselect$/.test(name) || app === "vmselect") {
    const port = portOf(service, ["http"], [8481])
    return port ? { kind: "VictoriaMetrics cluster", config: { ...base, port, path: "/select/0/prometheus" } } : null
  }
  if (/^vmsingle-|victoria-metrics-single-server$/.test(name) || app === "vmsingle" || app === "victoria-metrics-single") {
    const port = portOf(service, ["http"], [8428, 8429])
    return port ? { kind: "VictoriaMetrics", config: { ...base, port } } : null
  }
  if (/thanos-query(-frontend)?$/.test(name) || app === "thanos-query") {
    const port = portOf(service, ["http"], [9090, 10902])
    return port ? { kind: "Thanos", config: { ...base, port } } : null
  }
  // The operator's headless service, chart services such as prometheus-server, kube-prometheus's prometheus-k8s.
  if (name === "prometheus-operated" || (/prometheus/.test(name) && !/operator|exporter|alertmanager|adapter|pushgateway|node|state|blackbox|config-reloader/.test(name))) {
    const port = portOf(service, ["web", "http"], [9090, 80])
    return port ? { kind: "Prometheus", config: { ...base, port } } : null
  }
  return null
}

/** Services in the cluster that look like a Prometheus-compatible query API, checked one by one. */
export const detectBackends = async (): Promise<Array<BackendCandidate & { version: string }>> => {
  const services = await listItems<ServiceLike>("/api/v1/services")
  const candidates = services.map(candidateFor).filter((item): item is BackendCandidate => item !== null)
  const checked = await Promise.all(candidates.map(async (candidate) => {
    try {
      const result = await testPrometheus(candidate.config)
      return { ...candidate, version: result.version }
    } catch {
      return null
    }
  }))
  return checked.filter((item): item is BackendCandidate & { version: string } => item !== null)
}

/**
 * Rate or value of one kubevirt_vmi_* metric for a VMI. KubeVirt labels series with the VMI's
 * namespace; scrape configs that do not honor target labels (annotation-based discovery in the
 * prometheus and victoria-metrics-single charts) rename it to exported_namespace, so both match.
 */
const vmiMetric = (metric: string, namespace: string, name: string, rate: boolean) => {
  const series = (label: string) => {
    const selector = `${metric}{${label}="${namespace}",name="${name}"}`
    return rate ? `rate(${selector}[5m])` : selector
  }
  return `sum(${series("namespace")} or ${series("exported_namespace")})`
}

export const vmQueries = (namespace: string, name: string) => ({
  cpu: vmiMetric("kubevirt_vmi_cpu_usage_seconds_total", namespace, name, true),
  memory: vmiMetric("kubevirt_vmi_memory_used_bytes", namespace, name, false),
  networkRx: vmiMetric("kubevirt_vmi_network_receive_bytes_total", namespace, name, true),
  networkTx: vmiMetric("kubevirt_vmi_network_transmit_bytes_total", namespace, name, true),
  diskRead: vmiMetric("kubevirt_vmi_storage_read_traffic_bytes_total", namespace, name, true),
  diskWrite: vmiMetric("kubevirt_vmi_storage_write_traffic_bytes_total", namespace, name, true),
})

/** Whether metrics-server is reachable, for settings and hints. */
export const metricsServerAvailable = async () => (await listItems(`${METRICS}/nodes`)).length > 0
