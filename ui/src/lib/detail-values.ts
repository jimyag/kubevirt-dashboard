/** Value helpers for resource detail pages: emptiness, display text and key names. */

export const getValue = (obj: unknown, path?: string[]) => {
  if (!path) return undefined
  return path.reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") return undefined
    return (current as Record<string, unknown>)[key]
  }, obj)
}

export const compactValue = (value: unknown): string => {
  if (value === undefined || value === null || value === "") return "N/A"
  if (typeof value === "boolean") return value ? "true" : "false"
  if (Array.isArray(value)) return value.length ? value.map(compactValue).join(", ") : "None"
  if (typeof value === "object") return `${Object.keys(value as Record<string, unknown>).length} fields`
  return String(value)
}

export const isPrimitiveDetailValue = (value: unknown) =>
  value === undefined ||
  value === null ||
  ["string", "number", "boolean"].includes(typeof value)


export const isRecordValue = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value)

export const detailObjectTitle = (value: Record<string, unknown>, fallback: string) => {
  const title = value.name || value.type || value.action || value.protocol || value.kind || value.id
  return isPrimitiveDetailValue(title) && title !== undefined && title !== null && title !== "" ? compactValue(title) : fallback
}

export const asRecord = (value: unknown) => isRecordValue(value) ? value : {}
export const asRecordList = (value: unknown) => Array.isArray(value) ? value.filter(isRecordValue) : []
export const joinList = (value: unknown) => Array.isArray(value) ? value.map(compactValue).join(", ") : compactValue(value)
export const objectLabels = (value: unknown) => Object.entries(asRecord(value)).map(([key, next]) => `${key}=${compactValue(next)}`)
export const resourceKeys = (value: Record<string, unknown>) => Object.keys(value).filter((key) => key !== "name" && hasRenderableValue(value[key]))
/** False for empty values, including objects and lists that only hold empty values (e.g. status.loadBalancer: {}). */
export const hasRenderableValue = (value: unknown): boolean => {
  if (value === undefined || value === null || value === "") return false
  if (Array.isArray(value)) return value.some(hasRenderableValue)
  if (isRecordValue(value)) return Object.values(value).some(hasRenderableValue)
  return true
}

export const keyAcronyms: Record<string, string> = Object.fromEntries(
  ["IP", "IPs", "VPC", "CIDR", "NAT", "EIP", "FIP", "QoS", "MAC", "DNS", "ID", "URL", "API", "CPU", "LAN", "TLS", "UID", "VLAN", "BGP", "ASN", "MTU", "OVN", "ACL", "ACLs", "PVC", "VM", "VMI"].map((word) => [word.toLowerCase(), word]),
)

/** "targetPort" -> "Target port", "podIPs" -> "Pod IPs", "lanIp" -> "LAN IP". */
export const humanizeKey = (key: string) => {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
  return words.map((word, index) => {
    const acronym = keyAcronyms[word.toLowerCase()]
    if (acronym) return acronym
    if (/[A-Z].*[A-Z]|^[A-Z]{2,}/.test(word)) return word
    return index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word.toLowerCase()
  }).join(" ")
}

export const isoTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/

/** Annotations that only repeat the manifest; shown in the Manifest tab instead. */
export const hiddenAnnotations = new Set(["kubectl.kubernetes.io/last-applied-configuration"])
