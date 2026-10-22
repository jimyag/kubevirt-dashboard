import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Activity, RefreshCw } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { EmptyState, ErrorNote, Panel } from "@/components/console"
import {
  fetchInstanceUsage,
  formatBytes,
  formatRate,
  promQueryRange,
  usePrometheusConfig,
  vmQueries,
  type PrometheusConfig,
  type Series,
} from "@/lib/metrics"
import { t } from "@/lib/i18n"

type ChartSeries = { key: string; label: string; color: string }

const timeLabel = (t: number, rangeSeconds: number) =>
  new Date(t).toLocaleString(undefined, rangeSeconds > 86400 ? { month: "numeric", day: "numeric", hour: "2-digit" } : { hour: "2-digit", minute: "2-digit" })

/** Small area chart; `data` rows carry `t` (ms) plus one numeric field per series key. */
export function MetricChart({
  title,
  data,
  series,
  format,
  rangeSeconds,
  latest,
}: {
  title: string
  data: Array<Record<string, number>>
  series: ChartSeries[]
  format: (value: number) => string
  rangeSeconds: number
  latest?: string
}) {
  return (
    <Panel title={title} actions={latest && <span className="text-sm font-medium tabular-nums">{latest}</span>} bodyClassName="px-2 pt-3 pb-1">
      {data.length === 0 ? (
        <p className="px-2 py-10 text-center text-sm text-muted-foreground">{t("No data")}</p>
      ) : (
        <div className="h-44 w-full">
          <ResponsiveContainer>
            <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
              <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={(t) => timeLabel(t, rangeSeconds)} fontSize={11} tickLine={false} axisLine={false} stroke="var(--muted-foreground)" minTickGap={40} />
              <YAxis tickFormatter={format} fontSize={11} tickLine={false} axisLine={false} stroke="var(--muted-foreground)" width={72} />
              <Tooltip
                labelFormatter={(t) => new Date(Number(t)).toLocaleString()}
                formatter={(value, name) => [format(Number(value)), series.find((item) => item.key === name)?.label || String(name)]}
                contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12, color: "var(--popover-foreground)" }}
              />
              {series.map((item) => (
                <Area key={item.key} type="monotone" dataKey={item.key} stroke={item.color} fill={item.color} fillOpacity={0.12} strokeWidth={1.5} isAnimationActive={false} />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  )
}

/** Merges Prometheus series into chart rows keyed by timestamp. */
const mergeSeries = (inputs: Record<string, Series[]>) => {
  const rows = new Map<number, Record<string, number>>()
  for (const [key, list] of Object.entries(inputs)) {
    for (const point of list[0]?.points || []) {
      const row = rows.get(point.t) || { t: point.t }
      row[key] = point.v
      rows.set(point.t, row)
    }
  }
  return Array.from(rows.values()).sort((a, b) => a.t - b.t)
}

const ranges = [
  { label: "1h", seconds: 3600 },
  { label: "6h", seconds: 6 * 3600 },
  { label: "24h", seconds: 86400 },
  { label: "7d", seconds: 7 * 86400 },
]

const cores = (value: number) => (value >= 10 ? value.toFixed(0) : value >= 1 ? value.toFixed(2) : `${Math.round(value * 1000)}m`)

function PrometheusCharts({ config, namespace, name }: { config: PrometheusConfig; namespace: string; name: string }) {
  const [range, setRange] = useState(ranges[0])
  const [data, setData] = useState<Record<string, Series[]>>({})
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const queries = useMemo(() => vmQueries(namespace, name), [namespace, name])

  useEffect(() => {
    let cancelled = false
    Promise.all(Object.entries(queries).map(async ([key, query]) => [key, await promQueryRange(config, query, range.seconds)] as const))
      .then((entries) => {
        if (cancelled) return
        setData(Object.fromEntries(entries))
        setError("")
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Prometheus query failed")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [config, queries, range, tick])

  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) setTick((current) => current + 1)
    }, 60000)
    return () => clearInterval(timer)
  }, [])

  const last = (key: string) => {
    const points = data[key]?.[0]?.points || []
    return points.length ? points[points.length - 1].v : undefined
  }
  const cpu = mergeSeries({ cpu: data.cpu || [] })
  const memory = mergeSeries({ memory: data.memory || [] })
  const network = mergeSeries({ rx: data.networkRx || [], tx: data.networkTx || [] })
  const disk = mergeSeries({ read: data.diskRead || [], write: data.diskWrite || [] })

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex rounded-md border bg-card p-0.5">
          {ranges.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => setRange(item)}
              className={cn("rounded px-3 py-1 text-sm transition-colors", range.label === item.label ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">{config.namespace}/{config.service}:{config.port}</span>
          <Button size="sm" variant="outline" className="gap-2" onClick={() => setTick((current) => current + 1)}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />{t("Refresh")}
          </Button>
        </div>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="grid gap-4 lg:grid-cols-2">
        <MetricChart title={t("CPU usage (cores)")} data={cpu} series={[{ key: "cpu", label: t("CPU"), color: "var(--chart-1)" }]} format={cores} rangeSeconds={range.seconds} latest={last("cpu") !== undefined ? cores(last("cpu")!) : undefined} />
        <MetricChart title={t("Memory used")} data={memory} series={[{ key: "memory", label: t("Memory"), color: "var(--chart-4)" }]} format={formatBytes} rangeSeconds={range.seconds} latest={last("memory") !== undefined ? formatBytes(last("memory")!) : undefined} />
        <MetricChart title={t("Network")} data={network} series={[{ key: "rx", label: t("Receive"), color: "var(--chart-2)" }, { key: "tx", label: t("Transmit"), color: "var(--chart-1)" }]} format={formatRate} rangeSeconds={range.seconds} />
        <MetricChart title={t("Disk")} data={disk} series={[{ key: "read", label: t("Read"), color: "var(--chart-2)" }, { key: "write", label: t("Write"), color: "var(--chart-3)" }]} format={formatRate} rangeSeconds={range.seconds} />
      </div>
    </div>
  )
}

/** Live usage sampled from metrics-server while the page is open; used when Prometheus is not configured. */
function LiveCharts({ namespace, name }: { namespace: string; name: string }) {
  const [samples, setSamples] = useState<Array<Record<string, number>>>([])
  const [available, setAvailable] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    const sample = () => {
      if (document.hidden) return
      fetchInstanceUsage(namespace).then((usage) => {
        if (cancelled) return
        setAvailable(usage !== null)
        const current = usage?.[`${namespace}/${name}`]
        if (current) setSamples((previous) => [...previous.slice(-59), { t: Date.now(), cpu: current.cpuCores, memory: current.memoryBytes }])
      })
    }
    sample()
    const timer = setInterval(sample, 10000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [namespace, name])

  if (available === false) {
    return <EmptyState icon={Activity} title={t("No metrics source")} description={t("Install metrics-server for live usage, or configure Prometheus in Settings for history.")} />
  }
  const latest = samples.length ? samples[samples.length - 1] : undefined
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <MetricChart title={t("CPU usage (cores, live)")} data={samples} series={[{ key: "cpu", label: t("CPU"), color: "var(--chart-1)" }]} format={cores} rangeSeconds={600} latest={latest ? cores(latest.cpu) : undefined} />
      <MetricChart title={t("Memory (virt-launcher pod, live)")} data={samples} series={[{ key: "memory", label: t("Memory"), color: "var(--chart-4)" }]} format={formatBytes} rangeSeconds={600} latest={latest ? formatBytes(latest.memory) : undefined} />
    </div>
  )
}

export function VmMonitoring({ namespace, name, running }: { namespace: string; name: string; running: boolean }) {
  const config = usePrometheusConfig()
  if (config) return <PrometheusCharts config={config} namespace={namespace} name={name} />
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t("Live samples from metrics-server, kept while this page is open.")} <Link to="/settings" className="text-primary hover:underline">{t("Configure Prometheus")}</Link> {t("for history, network and disk charts.")}
      </p>
      {running ? <LiveCharts namespace={namespace} name={name} /> : <EmptyState icon={Activity} title={t("Instance is not running")} />}
    </div>
  )
}
