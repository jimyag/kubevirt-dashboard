import { useEffect, useMemo, useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { Bell, RefreshCw, Search } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DataTable, EmptyState, NativeSelect, StatusDot, Toolbar } from "@/components/console"
import { relativeTime } from "@/lib/kube"
import { eventCount, eventTime, fetchEvents, involvedObjectPath, type KubeEvent } from "@/lib/events"

/** Event table with type filter, search and auto refresh. Shows the object column only when not scoped to one object. */
export function EventList({
  url,
  showObject = true,
  refreshMs = 15000,
  toolbarExtra,
}: {
  url: string
  showObject?: boolean
  refreshMs?: number
  toolbarExtra?: ReactNode
}) {
  const [events, setEvents] = useState<KubeEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [type, setType] = useState("all")
  const [search, setSearch] = useState("")
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetchEvents(url)
      .then((items) => {
        if (cancelled) return
        setEvents(items)
        setError("")
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load events")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [url, tick])

  useEffect(() => {
    if (!refreshMs) return
    const timer = setInterval(() => {
      if (!document.hidden) setTick((current) => current + 1)
    }, refreshMs)
    return () => clearInterval(timer)
  }, [refreshMs])

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return events.filter((event) => {
      if (type !== "all" && event.type !== type) return false
      if (!needle) return true
      return [event.reason, event.message, event.involvedObject?.kind, event.involvedObject?.name, event.involvedObject?.namespace]
        .some((value) => (value || "").toLowerCase().includes(needle))
    })
  }, [events, search, type])

  const warnings = events.filter((event) => event.type === "Warning").length

  return (
    <div className="space-y-3">
      <Toolbar
        right={
          <div className="relative w-full md:w-[280px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Filter by reason, object or message" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        }
      >
        <Button size="sm" variant="outline" onClick={() => setTick((current) => current + 1)} className="gap-2">
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          Refresh
        </Button>
        <NativeSelect value={type} onChange={(e) => setType(e.target.value)} aria-label="Event type" className="min-w-[150px]">
          <option value="all">All types ({events.length})</option>
          <option value="Warning">Warning ({warnings})</option>
          <option value="Normal">Normal ({events.length - warnings})</option>
        </NativeSelect>
        {toolbarExtra}
      </Toolbar>
      {error && <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm break-all text-destructive">{error}</div>}
      <DataTable
        loading={loading && events.length === 0}
        rows={rows.slice(0, 500)}
        rowKey={(event) => event.metadata.uid || `${event.metadata.namespace}/${event.metadata.name}`}
        minWidth={showObject ? 900 : 640}
        empty={<EmptyState icon={Bell} title={events.length ? "No matching events" : "No events"} />}
        columns={[
          { header: "Type", className: "w-28", cell: (event) => <StatusDot status={event.type === "Warning" ? "Error" : "Ready"} label={event.type || "Normal"} /> },
          { header: "Reason", className: "w-44", cell: (event) => <span className="text-sm font-medium">{event.reason}</span> },
          ...(showObject ? [{
            header: "Object",
            className: "w-64",
            cell: (event: KubeEvent) => {
              const path = involvedObjectPath(event)
              const label = `${event.involvedObject?.kind}/${event.involvedObject?.name}`
              return (
                <div className="min-w-0">
                  {path ? <Link to={path} className="font-mono text-xs hover:text-primary transition-colors">{label}</Link> : <span className="font-mono text-xs">{label}</span>}
                  {event.involvedObject?.namespace && <div className="text-xs text-muted-foreground">{event.involvedObject.namespace}</div>}
                </div>
              )
            },
          }] : []),
          { header: "Message", cell: (event) => <span className="text-sm text-muted-foreground break-words">{event.message}</span> },
          { header: "Count", className: "w-16 text-right", cell: (event) => <span className="text-sm tabular-nums">{eventCount(event)}</span> },
          { header: "Last seen", className: "w-24 text-right", cell: (event) => <span className="text-sm text-muted-foreground tabular-nums" title={eventTime(event)}>{relativeTime(eventTime(event))}</span> },
        ]}
      />
      {rows.length > 500 && <p className="text-xs text-muted-foreground">Showing the latest 500 of {rows.length} events.</p>}
    </div>
  )
}
