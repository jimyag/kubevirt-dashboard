/** Client-side checks for create forms, so obvious mistakes fail before the API call. */

/** RFC 1123 label: what Kubernetes requires for VM, subnet, VPC and policy names. */
export const isDnsLabel = (value: string) => value.length <= 63 && /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(value)

/** Kubernetes resource quantity with a binary or decimal suffix, e.g. 4Gi, 512Mi, 20G. */
export const isQuantity = (value: string) => /^\d+(\.\d+)?(Ki|Mi|Gi|Ti|Pi|Ei|k|M|G|T|P|E)?$/.test(value.trim())

export const ipv4ToNumber = (ip: string): number | null => {
  const parts = ip.trim().split(".")
  if (parts.length !== 4) return null
  let result = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const octet = Number(part)
    if (octet > 255) return null
    result = result * 256 + octet
  }
  return result
}

export const parseIPv4Cidr = (cidr: string): { start: number; end: number; prefix: number } | null => {
  const [ip, prefixText] = cidr.trim().split("/")
  const base = ipv4ToNumber(ip || "")
  const prefix = Number(prefixText)
  if (base === null || !/^\d{1,2}$/.test(prefixText || "") || prefix > 32) return null
  const size = 2 ** (32 - prefix)
  const start = Math.floor(base / size) * size
  return { start, end: start + size - 1, prefix }
}

export const cidrContains = (cidr: string, ip: string) => {
  const range = parseIPv4Cidr(cidr)
  const value = ipv4ToNumber(ip)
  return range !== null && value !== null && value >= range.start && value <= range.end
}

export const cidrsOverlap = (a: string, b: string) => {
  const left = parseIPv4Cidr(a)
  const right = parseIPv4Cidr(b)
  return left !== null && right !== null && left.start <= right.end && right.start <= left.end
}

/** IPv4 part of a Kube-OVN cidrBlock, which may be "v4", "v6" or "v4,v6". */
export const ipv4Cidr = (cidrBlock: string) => cidrBlock.split(",").map((item) => item.trim()).find((item) => item.includes(".")) || ""
