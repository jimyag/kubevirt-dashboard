import { asRecord, asRecordList } from "./detail-values"

type Condition = Record<string, unknown>
const positiveTypes = ["Ready", "Available", "UpToDate", "Programmed", "Accepted", "ResolvedRefs", "Established", "NamesAccepted", "Succeeded", "Complete", "Bound", "Approved"]
const negativeTypes = new Set(["Failed", "Failure", "Error", "Degraded", "MemoryPressure", "DiskPressure", "PIDPressure", "NetworkUnavailable", "Unavailable", "Denied", "Invalid", "Unhealthy", "ReplicaFailure", "Dangling", "Conflicted"])
const isTrue = (condition: Condition) => String(condition.status).toLowerCase() === "true"

/** Gateway parents and policy ancestors expose the same conditions contract as root status. */
export function conditionReadiness(status: unknown, generation?: unknown): string | undefined {
  const readyFlag = ["ready", "readyToUse", "isReady"].map((key) => asRecord(status)[key]).find((value) => typeof value === "boolean")
  const flagStatus = typeof readyFlag === "boolean" ? readyFlag ? "Ready" : "NotReady" : undefined
  const conditions: Condition[] = []
  const pending = [status]
  while (pending.length) {
    const current = pending.pop()
    if (Array.isArray(current)) { for (const value of current) if (value && typeof value === "object") pending.push(value); continue }
    const record = asRecord(current)
    for (const item of asRecordList(record.conditions)) if (typeof item.type === "string" && item.status !== undefined) conditions.push(item)
    for (const [key, value] of Object.entries(record)) if (key !== "conditions" && value && typeof value === "object") pending.push(value)
  }
  if (!conditions.length) return flagStatus
  const current = conditions.filter((item) => !(typeof generation === "number" && typeof item.observedGeneration === "number" && item.observedGeneration < generation))
  if (!current.length) return "Pending"
  if (current.some((item) => negativeTypes.has(String(item.type)) && isTrue(item))) return "NotReady"
  const positive = current.filter((item) => positiveTypes.includes(String(item.type)))
  const selected = positive.find((item) => !isTrue(item)) || positiveTypes.map((type) => positive.find((item) => item.type === type)).find(Boolean)
  if (!selected) {
    return current.some((item) => !negativeTypes.has(String(item.type))) ? flagStatus || "Unknown" : "Ready"
  }
  const type = String(selected.type)
  if (isTrue(selected)) return ["Ready", "Available", "UpToDate"].includes(type) ? type : `${type} (True)`
  if (type === "Ready") return "NotReady"
  if (type === "Available") return "Unavailable"
  if (type === "UpToDate") return String(selected.reason || "Pending")
  return `${type} (${String(selected.status)})`
}
