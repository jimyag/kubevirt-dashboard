import { useState, type ReactNode } from "react"
import * as YAML from "js-yaml"

import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { StatusDot } from "@/components/console"
import { relativeTime } from "@/lib/kube"
import { t } from "@/lib/i18n"
import {
  asRecord,
  asRecordList,
  compactValue,
  detailObjectTitle,
  hasRenderableValue,
  humanizeKey,
  isPrimitiveDetailValue,
  isRecordValue,
  isoTimestamp,
  joinList,
  objectLabels,
  resourceKeys,
} from "@/lib/detail-values"
import type { KubeResource } from "@/components/resource-management"

/** Building blocks shared by resource detail pages. */

/**
 * Tone for a condition: for "bad" condition types (MemoryPressure, NetworkUnavailable, ...) False
 * is the healthy state, so the color is inverted while the label still shows True / False.
 */
const conditionTone = (condition: Record<string, unknown>) => {
  const status = compactValue(condition.status)
  if (!/Pressure$|Unavailable$|Failed$|Failure$|Degraded$/.test(String(condition.type))) return status
  return status === "False" ? "Ready" : status === "True" ? "Error" : status
}

export function CompactKvTable({ rows }: { rows: Array<{ label: string; value: unknown }> }) {
  const visible = rows.filter((row) => hasRenderableValue(row.value))
  if (visible.length === 0) return <span className="text-sm text-muted-foreground">{t("None")}</span>
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableBody>
          {visible.map((row) => (
            <TableRow key={row.label} className="hover:bg-muted/50">
              <TableCell className="w-40 py-2 align-top text-xs text-muted-foreground">{/^[a-z][a-z0-9]*[A-Z]/.test(row.label) ? humanizeKey(row.label) : row.label}</TableCell>
              <TableCell className="min-w-0 py-2 text-sm whitespace-normal text-foreground">
                <DetailValue value={row.value} depth={2} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export function ChipList({ values }: { values: unknown[] }) {
  if (values.length === 0) return <span className="text-sm text-muted-foreground">-</span>
  return (
    <div className="flex min-w-0 flex-wrap gap-1.5">
      {values.slice(0, 20).map((item, index) => (
        <span key={`${compactValue(item)}-${index}`} className="min-w-0 max-w-full break-all rounded-md border bg-muted/60 px-1.5 py-0.5 font-mono text-xs text-foreground">
          {compactValue(item)}
        </span>
      ))}
      {values.length > 20 && <span className="text-xs text-muted-foreground">+{values.length - 20} more</span>}
    </div>
  )
}

export function DetailContainerTable({ containers, statuses }: { containers: Record<string, unknown>[]; statuses?: Record<string, unknown>[] }) {
  if (containers.length === 0) return <span className="text-sm text-muted-foreground">{t("No containers")}</span>
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table className="min-w-[880px]">
        <TableHeader className="bg-muted/60">
          <TableRow>
            <TableHead className="h-9 text-xs font-medium text-muted-foreground">{t("Name")}</TableHead>
            <TableHead className="h-9 text-xs font-medium text-muted-foreground">{t("Image")}</TableHead>
            <TableHead className="h-9 text-xs font-medium text-muted-foreground">{t("Ready")}</TableHead>
            <TableHead className="h-9 text-xs font-medium text-muted-foreground">{t("Restarts")}</TableHead>
            <TableHead className="h-9 text-xs font-medium text-muted-foreground">{t("Ports")}</TableHead>
            <TableHead className="h-9 text-xs font-medium text-muted-foreground">{t("Resources")}</TableHead>
            <TableHead className="h-9 text-xs font-medium text-muted-foreground">{t("Args")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {containers.map((container) => {
            const status = statuses?.find((item) => item.name === container.name) || {}
            const resources = asRecord(container.resources)
            const requests = asRecord(resources.requests)
            const limits = asRecord(resources.limits)
            const ports = asRecordList(container.ports)
            return (
              <TableRow key={String(container.name)} className="hover:bg-muted/50">
                <TableCell className="font-semibold">{compactValue(container.name)}</TableCell>
                <TableCell className="max-w-[260px] break-all text-xs text-muted-foreground">{compactValue(container.image)}</TableCell>
                <TableCell><Badge variant={status.ready ? "success" : "outline"}>{compactValue(status.ready)}</Badge></TableCell>
                <TableCell className="tabular-nums">{compactValue(status.restartCount ?? 0)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {ports.length ? ports.map((port) => `${compactValue(port.containerPort || port.port)}/${compactValue(port.protocol || "TCP")}`).join(", ") : t("None")}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {[Object.keys(requests).length ? `req ${objectLabels(requests).join(", ")}` : "", Object.keys(limits).length ? `lim ${objectLabels(limits).join(", ")}` : ""].filter(Boolean).join(" / ") || t("None")}
                </TableCell>
                <TableCell className="max-w-[280px] text-xs text-muted-foreground">
                  <div className="line-clamp-3 break-words">{joinList(container.args) || joinList(container.command) || t("None")}</div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

export function DetailVolumeTable({ volumes }: { volumes: Record<string, unknown>[] }) {
  if (volumes.length === 0) return <span className="text-sm text-muted-foreground">{t("No volumes")}</span>
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table className="min-w-[720px]">
        <TableHeader className="bg-muted/60">
          <TableRow>
            <TableHead className="h-9 text-xs font-medium text-muted-foreground">{t("Name")}</TableHead>
            <TableHead className="h-9 text-xs font-medium text-muted-foreground">{t("Type")}</TableHead>
            <TableHead className="h-9 text-xs font-medium text-muted-foreground">{t("Source")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {volumes.map((volume) => {
            const type = resourceKeys(volume)[0] || "volume"
            const source = asRecord(volume[type])
            return (
              <TableRow key={String(volume.name)} className="hover:bg-muted/50">
                <TableCell className="font-semibold">{compactValue(volume.name)}</TableCell>
                <TableCell>{type}</TableCell>
                <TableCell className="break-words text-xs text-muted-foreground">
                  {Object.keys(source).length ? objectLabels(source).join(", ") : compactValue(volume[type])}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

export function DetailSimpleObjectTable({ rows }: { rows: Record<string, unknown>[] }) {
  const keys = Array.from(new Set(rows.flatMap((row) => Object.keys(row).filter((key) => isPrimitiveDetailValue(row[key]))))).slice(0, 6)
  if (keys.length === 0) return <ChipList values={rows.map((row, index) => detailObjectTitle(row, `Item ${index + 1}`))} />
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader className="bg-muted/50">
          <TableRow>{keys.map((key) => <TableHead key={key} className="h-8 text-xs font-medium text-muted-foreground">{humanizeKey(key)}</TableHead>)}</TableRow>
        </TableHeader>
        <TableBody>
          {rows.slice(0, 12).map((row, index) => (
            <TableRow key={index} className="hover:bg-muted/40">
              {keys.map((key) => <TableCell key={key} className="max-w-[260px] py-1.5 text-xs whitespace-normal break-words">{hasRenderableValue(row[key]) ? compactValue(row[key]) : <span className="text-muted-foreground">-</span>}</TableCell>)}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length > 12 && <div className="border-t px-3 py-2 text-xs text-muted-foreground">+{rows.length - 12} more</div>}
    </div>
  )
}

export function DetailValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (!hasRenderableValue(value)) return <span className="text-muted-foreground">-</span>
  if (isPrimitiveDetailValue(value)) {
    if (typeof value === "string" && isoTimestamp.test(value)) return <span title={value}>{relativeTime(value)}</span>
    return <span className="break-words">{compactValue(value)}</span>
  }

  if (depth > 4) {
    return (
      <pre className="max-h-56 max-w-full overflow-auto rounded-lg border bg-muted/30 p-3 text-xs text-foreground whitespace-pre-wrap break-words">
        {YAML.dump(value, { noRefs: true, lineWidth: 120 })}
      </pre>
    )
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <span>{t("None")}</span>

    const conditionLike = value.every((item) => isRecordValue(item) && "type" in item)
    if (conditionLike) {
      return (
        <div className="divide-y rounded-md border">
          {value.map((item, index) => {
            const condition = item as Record<string, unknown>
            return (
              <div key={`${String(condition.type || "condition")}-${index}`} className="px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-foreground">{compactValue(condition.type)}</span>
                  <StatusDot status={conditionTone(condition)} label={compactValue(condition.status)} />
                </div>
                {Boolean(condition.reason || condition.message) && (
                  <p className="mt-1 break-words text-xs text-muted-foreground">
                    {[condition.reason, condition.message].filter(Boolean).map(compactValue).join(" - ")}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )
    }

    const objectLike = value.every((item) => isRecordValue(item))
    if (objectLike) {
      const records = value as Record<string, unknown>[]
      if (records.every((item) => "image" in item && "name" in item)) {
        return <DetailContainerTable containers={records} />
      }
      if (records.every((item) => "name" in item && resourceKeys(item).length > 0) && records.some((item) => ["hostPath", "persistentVolumeClaim", "configMap", "secret", "emptyDir", "projected", "downwardAPI", "csi"].some((key) => key in item))) {
        return <DetailVolumeTable volumes={records} />
      }
      if (records.every((item) => "key" in item || "effect" in item || "operator" in item)) {
        return <DetailSimpleObjectTable rows={records} />
      }
      if (records.every((item) => Object.values(item).every((next) => isPrimitiveDetailValue(next)))) {
        return <DetailSimpleObjectTable rows={records} />
      }
      return (
        <div className="grid gap-2">
          {value.slice(0, 12).map((item, index) => {
            const record = item as Record<string, unknown>
            const entries = Object.entries(record)
            return (
              <div key={index} className="min-w-0 max-w-full rounded-md border px-3 py-2">
                <div className="mb-1.5 min-w-0 break-words text-sm font-medium text-foreground">
                  {detailObjectTitle(record, `Item ${index + 1}`)}
                </div>
                <DetailValue value={Object.fromEntries(entries.filter(([key]) => key !== "name"))} depth={depth + 1} />
              </div>
            )
          })}
          {value.length > 12 && <span className="text-xs text-muted-foreground">+{value.length - 12} more</span>}
        </div>
      )
    }

    return (
      <div className="flex min-w-0 max-w-full flex-wrap gap-1.5">
        {value.slice(0, 12).map((item, index) => (
          <span key={index} className="min-w-0 max-w-full break-words rounded-md border bg-muted px-2 py-1 text-xs text-foreground">
            {compactValue(item)}
          </span>
        ))}
        {value.length > 12 && <span className="text-xs text-muted-foreground">+{value.length - 12} more</span>}
      </div>
    )
  }

  const entries = Object.entries(value as Record<string, unknown>).filter(([, nextValue]) => hasRenderableValue(nextValue))
  // Flat objects read best as key=value chips (selectors, labels, resource lists).
  if (entries.every(([, nextValue]) => isPrimitiveDetailValue(nextValue))) {
    return <ChipList values={entries.map(([key, nextValue]) => `${key}=${compactValue(nextValue)}`)} />
  }

  return (
    <dl className="grid min-w-0 max-w-full gap-x-4 gap-y-1.5 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
      {entries.map(([key, nextValue]) => (
        <div key={key} className="contents">
          <dt className="min-w-0 break-words text-xs text-muted-foreground">{humanizeKey(key)}</dt>
          <dd className="min-w-0 break-words text-xs text-foreground">
            <DetailValue value={nextValue} depth={depth + 1} />
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function SummaryCard({ label, value, variant }: { label: string; value: unknown; variant?: string }) {
  if (!variant && (!hasRenderableValue(value) || compactValue(value) === "N/A")) return null
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 min-w-0 break-words text-sm font-medium">
        {variant ? <StatusDot status={variant} label={compactValue(value)} /> : <DetailValue value={value} />}
      </dd>
    </div>
  )
}

/** Key facts of a resource in one card, instead of a row of small cards. */
export function SummaryRow({ children }: { children: ReactNode }) {
  return (
    <dl className="grid gap-x-8 gap-y-4 rounded-lg border bg-card px-4 py-3.5 sm:grid-cols-2 xl:grid-cols-4">
      {children}
    </dl>
  )
}

export function SectionCard({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    // In a two-column grid, a section left alone on its row takes the full width.
    <section className="min-w-0 rounded-lg border bg-card xl:last:odd:col-span-2">
      <header className="border-b px-4 py-2.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </header>
      <div className="p-4">{children}</div>
    </section>
  )
}

/** Section with key/value rows; hidden when every row is empty. */
export function KvSection({ title, description, rows }: { title: string; description?: string; rows: Array<{ label: string; value: unknown }> }) {
  if (!rows.some((row) => hasRenderableValue(row.value))) return null
  return <SectionCard title={title} description={description}><CompactKvTable rows={rows} /></SectionCard>
}

/** Section showing one structured value; hidden when the value is empty. */
export function ValueSection({ title, description, value }: { title: string; description?: string; value: unknown }) {
  if (!hasRenderableValue(value)) return null
  return <SectionCard title={title} description={description}><DetailValue value={value} /></SectionCard>
}

export function AnnotationValue({ value }: { value: string }) {
  const [open, setOpen] = useState(false)
  const long = value.length > 160 || value.includes("\n")
  if (!long) return <span className="break-all font-mono text-xs">{value}</span>
  let pretty = value
  try {
    pretty = JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    // Not JSON; show as is.
  }
  return (
    <div className="min-w-0">
      {open
        ? <pre className="max-h-80 overflow-auto rounded-md bg-muted/40 p-2 font-mono text-xs whitespace-pre-wrap break-all">{pretty}</pre>
        : <span className="line-clamp-2 break-all font-mono text-xs">{value}</span>}
      <button type="button" onClick={() => setOpen(!open)} className="mt-1 text-xs text-primary hover:underline">{open ? t("Show less") : t("Show more")}</button>
    </div>
  )
}

export function MetadataSection({ resource, labels, annotations }: { resource: KubeResource; labels: Array<[string, string]>; annotations: Array<[string, string]> }) {
  const owners = resource.metadata.ownerReferences || []
  return (
    <SectionCard title={t("Metadata")}>
      <dl className="grid gap-x-4 gap-y-3 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
        <dt className="text-xs text-muted-foreground">{t("UID")}</dt>
        <dd className="min-w-0 break-all font-mono text-xs">{resource.metadata.uid || "-"}</dd>
        <dt className="text-xs text-muted-foreground">{t("Created")}</dt>
        <dd className="text-sm" title={resource.metadata.creationTimestamp}>{relativeTime(resource.metadata.creationTimestamp)}</dd>
        {owners.length > 0 && (
          <>
            <dt className="text-xs text-muted-foreground">{t("Owner")}</dt>
            <dd className="min-w-0 font-mono text-xs">{owners.map((owner) => `${owner.kind}/${owner.name}`).join(", ")}</dd>
          </>
        )}
        <dt className="text-xs text-muted-foreground">{t("Labels")}</dt>
        <dd className="min-w-0"><ChipList values={labels.map(([key, value]) => `${key}=${value}`)} /></dd>
        <dt className="text-xs text-muted-foreground">{t("Annotations")}</dt>
        <dd className="min-w-0">
          {annotations.length === 0 ? <span className="text-muted-foreground">-</span> : (
            <div className="divide-y rounded-md border">
              {annotations.map(([key, value]) => (
                <div key={key} className="grid gap-1 px-3 py-2 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] md:gap-4">
                  <span className="break-all font-mono text-xs text-muted-foreground">{key}</span>
                  <AnnotationValue value={value} />
                </div>
              ))}
            </div>
          )}
        </dd>
      </dl>
    </SectionCard>
  )
}


export function PortsTable({ ports }: { ports: Record<string, unknown>[] }) {
  const showNodePort = ports.some((port) => port.nodePort)
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader className="bg-muted/50">
          <TableRow>
            <TableHead className="h-8 text-xs font-medium text-muted-foreground">{t("Name")}</TableHead>
            <TableHead className="h-8 text-xs font-medium text-muted-foreground">{t("Protocol")}</TableHead>
            <TableHead className="h-8 text-xs font-medium text-muted-foreground">{t("Port")}</TableHead>
            <TableHead className="h-8 text-xs font-medium text-muted-foreground">{t("Target port")}</TableHead>
            {showNodePort && <TableHead className="h-8 text-xs font-medium text-muted-foreground">{t("Node port")}</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {ports.map((port, index) => (
            <TableRow key={`${compactValue(port.name)}-${index}`} className="hover:bg-muted/40">
              <TableCell className="py-1.5 text-sm">{hasRenderableValue(port.name) ? compactValue(port.name) : <span className="text-muted-foreground">-</span>}</TableCell>
              <TableCell className="py-1.5 text-sm">{compactValue(port.protocol || "TCP")}</TableCell>
              <TableCell className="py-1.5 font-mono text-xs">{compactValue(port.port)}</TableCell>
              <TableCell className="py-1.5 font-mono text-xs">{compactValue(port.targetPort ?? port.port)}</TableCell>
              {showNodePort && <TableCell className="py-1.5 font-mono text-xs">{hasRenderableValue(port.nodePort) ? compactValue(port.nodePort) : "-"}</TableCell>}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
