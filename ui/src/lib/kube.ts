import { useCallback, useEffect, useState } from "react"

export type UnknownRecord = Record<string, unknown>

export type KubeObject = {
  apiVersion?: string
  kind?: string
  metadata: {
    name: string
    namespace?: string
    uid?: string
    creationTimestamp?: string
    labels?: Record<string, string>
    annotations?: Record<string, string>
  }
  spec?: UnknownRecord
  status?: UnknownRecord
}

export const getContext = () => localStorage.getItem("kube-context") || ""
export const setContext = (ctx: string) => localStorage.setItem("kube-context", ctx)

export const apiFetch = (url: string, options: RequestInit = {}) => {
  const ctx = getContext()
  const headers = new Headers(options.headers || {})
  if (!headers.has("Accept")) headers.set("Accept", "application/json")
  if (ctx) headers.set("X-Kube-Context", ctx)
  return fetch(url, { ...options, headers })
}

export const listItems = async <T = KubeObject>(url: string): Promise<T[]> => {
  try {
    const res = await apiFetch(url)
    if (!res.ok) return []
    const data = await res.json()
    return (data.items || []) as T[]
  } catch {
    return []
  }
}

export const requestJson = async (url: string, options: RequestInit) => {
  const res = await apiFetch(url, options)
  if (!res.ok) {
    const text = await res.text()
    try {
      throw new Error((JSON.parse(text) as { message?: string }).message || text)
    } catch (err) {
      if (err instanceof SyntaxError) throw new Error(text || res.statusText)
      throw err
    }
  }
  return res.status === 204 ? null : res.json().catch(() => null)
}

export const asRecord = (value: unknown): UnknownRecord =>
  value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {}
export const asList = (value: unknown): UnknownRecord[] =>
  Array.isArray(value) ? value.filter((item) => item && typeof item === "object") as UnknownRecord[] : []
export const str = (value: unknown, fallback = "") =>
  value === undefined || value === null || value === "" ? fallback : String(value)

export const namespacedPath = (base: string, resource: string, namespace?: string) =>
  namespace && namespace !== "all" ? `${base}/namespaces/${namespace}/${resource}` : `${base}/${resource}`

export const relativeTime = (timestamp?: string) => {
  if (!timestamp) return "N/A"
  const diff = Date.now() - new Date(timestamp).getTime()
  if (Number.isNaN(diff)) return timestamp
  const seconds = Math.max(0, Math.floor(diff / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export const parseQuantityGi = (value?: unknown): number => {
  const s = str(value)
  if (!s) return 0
  const num = parseFloat(s)
  if (Number.isNaN(num)) return 0
  if (s.endsWith("Ti")) return num * 1024
  if (s.endsWith("Gi")) return num
  if (s.endsWith("Mi")) return num / 1024
  if (s.endsWith("Ki")) return num / (1024 * 1024)
  if (s.endsWith("T")) return (num * 1e12) / 2 ** 30
  if (s.endsWith("G")) return (num * 1e9) / 2 ** 30
  if (s.endsWith("M")) return (num * 1e6) / 2 ** 30
  return num / 2 ** 30
}

export const formatGi = (gi: number) => gi >= 1024 ? `${(gi / 1024).toFixed(1)} TiB` : `${Number.isInteger(gi) ? gi : gi.toFixed(1)} GiB`

// --- Discovery ---

type DiscoveryData = {
  apiVersions: string[]
  apiResources: Array<{ name: string; apiVersion: string }>
}

export type Discovery = {
  loaded: boolean
  hasGroupVersion: (groupVersion: string) => boolean
  hasResource: (groupVersion: string, resource: string) => boolean
}

const discoveryRequests = new Map<string, Promise<DiscoveryData>>()

const loadDiscovery = () => {
  const key = getContext()
  const cached = discoveryRequests.get(key)
  if (cached) return cached
  const request = apiFetch("/api/v1/discovery")
    .then(async (res) => {
      if (!res.ok) throw new Error(await res.text())
      return await res.json() as DiscoveryData
    })
    .catch(() => {
      discoveryRequests.delete(key)
      return { apiVersions: [], apiResources: [] } as DiscoveryData
    })
  discoveryRequests.set(key, request)
  return request
}

export function useDiscovery(): Discovery {
  const [data, setData] = useState<DiscoveryData | null>(null)
  useEffect(() => {
    let cancelled = false
    loadDiscovery().then((next) => {
      if (!cancelled) setData(next)
    })
    return () => {
      cancelled = true
    }
  }, [])
  const versions = new Set(data?.apiVersions || [])
  const resources = new Set((data?.apiResources || []).map((item) => `${item.apiVersion}/${item.name}`))
  return {
    loaded: data !== null,
    hasGroupVersion: (groupVersion) => versions.has(groupVersion),
    hasResource: (groupVersion, resource) => resources.has(`${groupVersion}/${resource}`),
  }
}

// --- Network profile ---

/**
 * How VM networking and ACLs are managed on this cluster:
 * - pod: KubeVirt on the default pod network, ACLs via Kubernetes NetworkPolicy
 * - kube-ovn: Kube-OVN VPCs/subnets, ACLs via Kube-OVN SecurityGroups
 * - kube-ovn-cilium: Kube-OVN VPCs/subnets; ACLs via CiliumNetworkPolicy by default, with Kube-OVN
 *   SecurityGroups available as an alternative engine chosen per security group
 * - cilium: Cilium networking, ACLs via CiliumNetworkPolicy
 */
export type NetworkProfileId = "pod" | "kube-ovn" | "kube-ovn-cilium" | "cilium"
export type AclProvider = "networkpolicy" | "kube-ovn" | "cilium"
export type AclEngine = Exclude<AclProvider, "networkpolicy">

export type NetworkProfile = {
  id: NetworkProfileId
  label: string
  description: string
  vpc: boolean
  acl: AclProvider
  /** Security group engines usable on this stack, default first. */
  aclEngines: AclEngine[]
  detected: NetworkProfileId
  override: NetworkProfileId | "auto"
  kubeOvnInstalled: boolean
  ciliumInstalled: boolean
  loaded: boolean
}

export const networkProfiles: Record<NetworkProfileId, { label: string; description: string; vpc: boolean; acl: AclProvider; engines: AclEngine[]; recommended?: boolean }> = {
  pod: {
    label: "KubeVirt",
    description: "VMs use the default pod network. Access control uses Kubernetes NetworkPolicy.",
    vpc: false,
    acl: "networkpolicy",
    engines: [],
  },
  "kube-ovn": {
    label: "KubeVirt + Kube-OVN",
    description: "VMs are placed in Kube-OVN VPCs and subnets. Access control uses Kube-OVN security groups.",
    vpc: true,
    acl: "kube-ovn",
    engines: ["kube-ovn"],
  },
  "kube-ovn-cilium": {
    label: "KubeVirt + Kube-OVN + Cilium",
    description: "Kube-OVN provides VPCs, subnets and IPAM. Security groups default to Cilium policies; Kube-OVN security groups can be chosen per group.",
    vpc: true,
    acl: "cilium",
    engines: ["cilium", "kube-ovn"],
    recommended: true,
  },
  cilium: {
    label: "KubeVirt + Cilium",
    description: "VMs use the Cilium pod network. Security groups are enforced as CiliumNetworkPolicy.",
    vpc: false,
    acl: "cilium",
    engines: ["cilium"],
  },
}

const profileStorageKey = () => `network-profile:${getContext()}`

export const readProfileOverride = (): NetworkProfileId | "auto" => {
  try {
    const value = localStorage.getItem(profileStorageKey())
    return value && value in networkProfiles ? value as NetworkProfileId : "auto"
  } catch {
    return "auto"
  }
}

const profileListeners = new Set<() => void>()

export const writeProfileOverride = (value: NetworkProfileId | "auto") => {
  try {
    if (value === "auto") localStorage.removeItem(profileStorageKey())
    else localStorage.setItem(profileStorageKey(), value)
  } catch {
    // Browser storage can be unavailable; the detected profile is still used.
  }
  profileListeners.forEach((listener) => listener())
}

export function useNetworkProfile(): NetworkProfile {
  const discovery = useDiscovery()
  const [override, setOverride] = useState(readProfileOverride)
  useEffect(() => {
    const listener = () => setOverride(readProfileOverride())
    profileListeners.add(listener)
    return () => {
      profileListeners.delete(listener)
    }
  }, [])
  const kubeOvnInstalled = discovery.hasResource("kubeovn.io/v1", "subnets")
  const ciliumInstalled = discovery.hasResource("cilium.io/v2", "ciliumnetworkpolicies")
  const detected: NetworkProfileId = kubeOvnInstalled && ciliumInstalled
    ? "kube-ovn-cilium"
    : kubeOvnInstalled ? "kube-ovn" : ciliumInstalled ? "cilium" : "pod"
  const id = override === "auto" ? detected : override
  const { engines, ...profile } = networkProfiles[id]
  // Only offer engines whose CRDs are served; fall back to the profile's list before discovery loads.
  const installed = engines.filter((engine) => !discovery.loaded || (engine === "cilium" ? ciliumInstalled : kubeOvnInstalled))
  const aclEngines = installed.length ? installed : engines
  return { id, ...profile, acl: aclEngines[0] ?? "networkpolicy", aclEngines, detected, override, kubeOvnInstalled, ciliumInstalled, loaded: discovery.loaded }
}

// --- Data hooks ---

export function useAsync<T>(loader: () => Promise<T>, initial: T, deps: unknown[]) {
  const [data, setData] = useState<T>(initial)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(loader, deps)
  const reload = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      setData(await run())
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed")
    } finally {
      setLoading(false)
    }
  }, [run])
  useEffect(() => {
    reload()
  }, [reload])
  return { data, loading, error, reload }
}

export function useNamespaces() {
  const [namespaces, setNamespaces] = useState<string[]>([])
  useEffect(() => {
    apiFetch("/api/v1/namespaces-list")
      .then((res) => res.ok ? res.json() : [])
      .then((data: string[]) => setNamespaces((data || []).filter(Boolean)))
      .catch(() => setNamespaces(["default"]))
  }, [])
  return namespaces
}

// --- Labels and annotations used to bind VMs to network objects ---

export const kubeOvnAnnotations = {
  logicalSwitch: "ovn.kubernetes.io/logical_switch",
  ipAddress: "ovn.kubernetes.io/ip_address",
  securityGroups: "ovn.kubernetes.io/security_groups",
  portSecurity: "ovn.kubernetes.io/port_security",
}

/** Label put on VM templates (and thus virt-launcher pods) to attach a Cilium-backed security group. */
export const ciliumSecurityGroupLabel = (name: string) => `sg.kubevirt-dashboard.io/${name}`
export const managedSecurityGroupLabel = "kubevirt-dashboard.io/security-group"

export const subnetUsage = (subnet: KubeObject) => {
  const status = asRecord(subnet.status)
  const used = Number(status.v4usingIPs ?? status.v4UsingIPs ?? 0) + Number(status.v6usingIPs ?? 0)
  const available = Number(status.v4availableIPs ?? status.v4AvailableIPs ?? 0) + Number(status.v6availableIPs ?? 0)
  return { used, total: used + available }
}

/**
 * JSON merge patch only deletes map keys that are explicitly null. Use this when a form edits a
 * whole map (labels, annotations, selectors) so removed entries are actually removed.
 */
export const replaceMap = (current: unknown, next: Record<string, unknown>) => ({
  ...Object.fromEntries(Object.keys(asRecord(current)).map((key) => [key, null])),
  ...next,
})
