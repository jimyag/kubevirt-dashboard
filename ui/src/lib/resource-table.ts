import { asRecord, asRecordList, compactValue, humanizeKey, isoTimestamp } from "./detail-values"
import { relativeTime } from "./kube"
import type { KubeResource, ResourceConfig } from "../components/resource-management"

export type ResourceListData = {
  items: KubeResource[]
  columns?: ResourceConfig["extraColumns"]
  status?: (resource: KubeResource) => string
}

/** The API server evaluates CRD printer JSONPaths; resource objects stay untouched. */
export function resourceTable(payload: unknown, fallbackStatus: (resource: KubeResource) => string): ResourceListData {
  const table = asRecord(payload)
  if (table.kind !== "Table") return { items: asRecordList(table.items) as KubeResource[] }
  const definitions = asRecordList(table.columnDefinitions)
  const rows = asRecordList(table.rows)
  const items = rows.map((row) => {
    const object = asRecord(row.object)
    if (typeof asRecord(object.metadata).name !== "string" || object.kind === "PartialObjectMetadata") throw new Error("Kubernetes table did not include resource objects.")
    return object as KubeResource
  })
  const cells = new Map(items.map((item, index) => [item, Array.isArray(rows[index].cells) ? rows[index].cells as unknown[] : []]))
  const statusNames = ["status", "ready", "phase", "state", "accepted"]
  const statusIndex = definitions.findIndex((column) => statusNames.includes(String(column.name).toLowerCase()))
  const columns = definitions.flatMap((column, index) => {
    const name = String(column.name)
    if (Number(column.priority || 0) > 0 || ["name", "namespace", "age", ...statusNames].includes(name.toLowerCase())) return []
    return [{ label: humanizeKey(name), value: (resource: KubeResource) => {
      const value = cells.get(resource)?.[index]
      if (value === null || value === undefined) return "N/A"
      if (value === "") return '""'
      if (column.type === "date" && typeof value === "string" && isoTimestamp.test(value)) return relativeTime(value)
      return compactValue(value)
    } }]
  })
  return {
    items,
    columns: columns.length ? columns : undefined,
    status: (resource) => {
      const fallback = fallbackStatus(resource)
      if (!["Active", "Unknown"].includes(fallback) || statusIndex < 0) return fallback
      const value = cells.get(resource)?.[statusIndex]
      if (value === null || value === undefined || value === "") return fallback
      if (String(value).toLowerCase() === "true") return "Ready"
      if (String(value).toLowerCase() === "false") return "NotReady"
      return String(value)
    },
  }
}
