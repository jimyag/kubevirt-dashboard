import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { Bell, RefreshCw } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Combobox, DataTable, EmptyState, FilterInput, StatusDot, Toolbar } from "@/components/console"
import { relativeTime } from "@/lib/kube"
import { useFilteredRows, type FilterField } from "@/lib/filter"
import { eventCount, eventTime, fetchEvents, involvedObjectPath, type KubeEvent } from "@/lib/events"
import { t } from "@/lib/i18n"
import { usePolling } from "@/lib/polling"

const eventFields: FilterField<KubeEvent>[] = [
  { key: "type", label: "Type", value: (event) => event.type || "Normal" },
  { key: "reason", label: "Reason", value: (event) => event.reason },
  { key: "kind", label: "Object kind", value: (event) => event.involvedObject?.kind },
  { key: "object", label: "Object name", aliases: ["name"], value: (event) => event.involvedObject?.name },
  { key: "namespace", label: "Namespace", aliases: ["ns"], value: (event) => event.involvedObject?.namespace },
  { key: "message", label: "Message", aliases: ["msg"], value: (event) => event.message },
]

/**
 * Event table with type filter, field search and auto refresh. Shows the object column only when
 * not scoped to one object. `prefilter` narrows events locally, e.g. by a partially typed namespace.
 */
export function EventList({
  url,
  showObject = true,
  refreshMs = 15000,
  toolbarExtra,
  prefilter,
  onEvents,
}: {
  url: string
  showObject?: boolean
  refreshMs?: number
  toolbarExtra?: ReactNode
  prefilter?: (event: KubeEvent) => boolean
  /** Called with each loaded batch, e.g. to suggest the object kinds present. */
  onEvents?: (events: KubeEvent[]) => void
}) {
  const [events, setEvents] = useState<KubeEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [type, setType] = useState("")
  const [search, setSearch] = useState("")
  const [tick, setTick] = useState(0)
  const onEventsRef = useRef(onEvents)
  useEffect(() => {
    onEventsRef.current = onEvents
  })

  useEffect(() => {
    let cancelled = false
    fetchEvents(url)
      .then((items) => {
        if (cancelled) return
        setEvents(items)
        onEventsRef.current?.(items)
        setError("")
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : t("Failed to load events"))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [url, tick])

  usePolling(() => setTick((current) => current + 1), refreshMs)

  const scoped = useMemo(() => {
    const typeNeedle = type.trim().toLowerCase()
    return events.filter((event) => (!prefilter || prefilter(event)) && (!typeNeedle || (event.type || "Normal").toLowerCase().includes(typeNeedle)))
  }, [events, prefilter, type])
  const rows = useFilteredRows(scoped, eventFields, search)

  const warnings = events.filter((event) => event.type === "Warning").length

  return (
    <div className="space-y-3">
      <Toolbar
        right={<FilterInput value={search} onChange={setSearch} fields={showObject ? eventFields : eventFields.filter((field) => !["kind", "object", "namespace"].includes(field.key))} rows={scoped} placeholder={t("Filter, e.g. reason:failed kind:pod")} />}
      >
        <Button size="sm" variant="outline" onClick={() => setTick((current) => current + 1)} className="gap-2">
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />{t("Refresh")}
        </Button>
        <Combobox
          value={type}
          onChange={setType}
          options={[{ value: "Warning", hint: String(warnings) }, { value: "Normal", hint: String(events.length - warnings) }]}
          placeholder={t("All types ({v0})", { v0: events.length })}
          aria-label={t("Event type")}
          className="w-[160px]"
        />
        {toolbarExtra}
      </Toolbar>
      {error && <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm break-all text-destructive">{error}</div>}
      <DataTable
        loading={loading && events.length === 0}
        rows={rows}
        rowKey={(event) => event.metadata.uid || `${event.metadata.namespace}/${event.metadata.name}`}
        minWidth={showObject ? 900 : 640}
        empty={<EmptyState icon={Bell} title={events.length ? t("No matching events") : t("No events")} />}
        columns={[
          { header: t("Type"), className: "w-28", cell: (event) => <StatusDot status={event.type === "Warning" ? "Error" : "Ready"} label={event.type || t("Normal")} /> },
          { header: t("Reason"), className: "w-44", cell: (event) => <span className="text-sm font-medium">{event.reason}</span> },
          ...(showObject ? [{
            header: t("Object"),
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
          { header: t("Message"), cell: (event) => <span className="text-sm text-muted-foreground break-words">{event.message}</span> },
          { header: t("Count"), className: "w-16 text-right", cell: (event) => <span className="text-sm tabular-nums">{eventCount(event)}</span> },
          { header: t("Last seen"), className: "w-24 text-right", cell: (event) => <span className="text-sm text-muted-foreground tabular-nums" title={eventTime(event)}>{relativeTime(eventTime(event))}</span> },
        ]}
      />
    </div>
  )
}
