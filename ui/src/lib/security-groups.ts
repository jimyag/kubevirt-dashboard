import {
  apiFetch,
  asList,
  asRecord,
  ciliumSecurityGroupLabel,
  kubeOvnAnnotations,
  listItems,
  managedSecurityGroupLabel,
  requestJson,
  str,
  useNetworkProfile,
  type KubeObject,
  type UnknownRecord,
} from "./kube"

/**
 * A provider-neutral security group, modeled after cloud security groups:
 * stateful allow/deny rules per direction, attached to instances.
 *
 * - kube-ovn: kubeovn.io/v1 SecurityGroup (cluster scoped). Instances attach through the
 *   ovn.kubernetes.io/security_groups annotation on the VM template.
 * - cilium: cilium.io/v2 CiliumNetworkPolicy (namespaced). The policy selects endpoints carrying
 *   the sg.kubevirt-dashboard.io/<name> label, which is set on the VM template.
 */
export type SgProvider = "kube-ovn" | "cilium"
export type SgDirection = "ingress" | "egress"
export type SgProtocol = "all" | "tcp" | "udp" | "icmp"
export type SgRemoteType = "any" | "cidr" | "group"

export type SgRule = {
  direction: SgDirection
  action: "allow" | "deny"
  protocol: SgProtocol
  /** "22", "8000-8100", or "" for all ports. */
  ports: string
  remoteType: SgRemoteType
  remote: string
  /** Kube-OVN only: 1-200, lower value is evaluated first. */
  priority: number
}

export type SecurityGroup = {
  provider: SgProvider
  name: string
  namespace?: string
  description: string
  managed: boolean
  allowSameGroup: boolean
  rules: SgRule[]
  /** Rules this editor cannot represent (L7, FQDN, ...). When non-zero, rules are read-only. */
  unsupported: number
  selector: string
  raw: KubeObject
}

export const descriptionAnnotation = "kubevirt-dashboard.io/description"
const OVN = "/apis/kubeovn.io/v1"
const CILIUM = "/apis/cilium.io/v2"
const VM_API = "/apis/kubevirt.io/v1"

export const emptyRule = (direction: SgDirection): SgRule => ({
  direction,
  action: "allow",
  protocol: "tcp",
  ports: "22",
  remoteType: "any",
  remote: "",
  priority: 100,
})

export const ruleTemplates: Array<{ id: string; label: string; description: string; rules: SgRule[] }> = [
  { id: "empty", label: "Empty", description: "No rules. Add your own after creation.", rules: [] },
  {
    id: "ssh",
    label: "SSH only",
    description: "Allow inbound SSH (22) and ICMP from anywhere.",
    rules: [
      { ...emptyRule("ingress"), ports: "22" },
      { ...emptyRule("ingress"), protocol: "icmp", ports: "" },
    ],
  },
  {
    id: "web",
    label: "Web server",
    description: "Allow inbound HTTP, HTTPS, SSH and ICMP from anywhere.",
    rules: [
      { ...emptyRule("ingress"), ports: "80" },
      { ...emptyRule("ingress"), ports: "443" },
      { ...emptyRule("ingress"), ports: "22" },
      { ...emptyRule("ingress"), protocol: "icmp", ports: "" },
    ],
  },
  {
    id: "private",
    label: "Private network",
    description: "Allow all inbound traffic from RFC 1918 private ranges only.",
    rules: ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"].map((cidr) => ({ ...emptyRule("ingress"), protocol: "all" as const, ports: "", remoteType: "cidr" as const, remote: cidr })),
  },
]

export const portRange = (ports: string) => {
  const [min, max] = ports.split("-").map((part) => Number(part.trim()))
  if (!Number.isFinite(min) || min <= 0) return null
  return { min, max: Number.isFinite(max) && max >= min ? max : min }
}

export const ruleSummary = (rule: SgRule) => {
  const proto = rule.protocol === "all" ? "All traffic" : rule.protocol.toUpperCase()
  const ports = rule.protocol === "all" || rule.protocol === "icmp" ? "" : rule.ports ? ` ${rule.ports}` : " all ports"
  return `${proto}${ports}`
}

export const remoteSummary = (rule: SgRule) =>
  rule.remoteType === "any" ? "Anywhere" : rule.remoteType === "group" ? `Security group ${rule.remote}` : rule.remote

// --- Kube-OVN mapping ---

const fromKubeOvnRule = (rule: UnknownRecord, direction: SgDirection): SgRule => {
  const remoteType = str(rule.remoteType, "address") === "securityGroup" ? "group" : "cidr"
  const remote = remoteType === "group" ? str(rule.remoteSecurityGroup) : str(rule.remoteAddress)
  const min = Number(rule.portRangeMin || 0)
  const max = Number(rule.portRangeMax || 0)
  const protocol = (["tcp", "udp", "icmp"].includes(str(rule.protocol)) ? str(rule.protocol) : "all") as SgProtocol
  return {
    direction,
    action: str(rule.policy, "allow") === "allow" ? "allow" : "deny",
    protocol,
    ports: min > 0 && !(min === 1 && max === 65535) ? (max > min ? `${min}-${max}` : `${min}`) : "",
    remoteType: remoteType === "cidr" && (remote === "0.0.0.0/0" || remote === "") ? "any" : remoteType,
    remote: remote === "0.0.0.0/0" ? "" : remote,
    priority: Number(rule.priority || 100),
  }
}

const toKubeOvnRule = (rule: SgRule): UnknownRecord => {
  const out: UnknownRecord = {
    ipVersion: rule.remote.includes(":") ? "ipv6" : "ipv4",
    protocol: rule.protocol,
    priority: Math.min(200, Math.max(1, rule.priority || 100)),
    policy: rule.action === "allow" ? "allow" : "drop",
  }
  if (rule.remoteType === "group") {
    out.remoteType = "securityGroup"
    out.remoteSecurityGroup = rule.remote
  } else {
    out.remoteType = "address"
    out.remoteAddress = rule.remoteType === "any" ? "0.0.0.0/0" : rule.remote
  }
  if (rule.protocol === "tcp" || rule.protocol === "udp") {
    const range = portRange(rule.ports) || { min: 1, max: 65535 }
    out.portRangeMin = range.min
    out.portRangeMax = range.max
  }
  return out
}

export const fromKubeOvn = (obj: KubeObject): SecurityGroup => {
  const spec = asRecord(obj.spec)
  return {
    provider: "kube-ovn",
    name: obj.metadata.name,
    description: obj.metadata.annotations?.[descriptionAnnotation] || "",
    managed: true,
    allowSameGroup: spec.allowSameGroupTraffic === true,
    rules: [
      ...asList(spec.ingressRules).map((rule) => fromKubeOvnRule(rule, "ingress")),
      ...asList(spec.egressRules).map((rule) => fromKubeOvnRule(rule, "egress")),
    ],
    unsupported: 0,
    selector: `${kubeOvnAnnotations.securityGroups} contains ${obj.metadata.name}`,
    raw: obj,
  }
}

const kubeOvnSpec = (sg: Pick<SecurityGroup, "rules" | "allowSameGroup">) => ({
  allowSameGroupTraffic: sg.allowSameGroup,
  ingressRules: sg.rules.filter((rule) => rule.direction === "ingress").map(toKubeOvnRule),
  egressRules: sg.rules.filter((rule) => rule.direction === "egress").map(toKubeOvnRule),
})

// --- Cilium mapping ---

const ciliumPeerKeys = {
  ingress: { cidr: "fromCIDR", endpoints: "fromEndpoints", entities: "fromEntities" },
  egress: { cidr: "toCIDR", endpoints: "toEndpoints", entities: "toEntities" },
} as const

const supportedCiliumRuleKeys = new Set(["fromCIDR", "fromEndpoints", "fromEntities", "toCIDR", "toEndpoints", "toEntities", "toPorts", "icmps"])

const groupFromSelector = (selector: UnknownRecord) => {
  const labels = asRecord(selector.matchLabels)
  const keys = Object.keys(labels)
  const prefix = ciliumSecurityGroupLabel("")
  if (keys.length === 1 && keys[0].startsWith(prefix)) return keys[0].slice(prefix.length)
  return null
}

const fromCiliumRule = (rule: UnknownRecord, direction: SgDirection, action: SgRule["action"], self: string): { rules: SgRule[]; unsupported: number; sameGroup: boolean } => {
  // `{}` is the default-deny placeholder written by ciliumSpec; it allows nothing.
  if (Object.keys(rule).length === 0) return { rules: [], unsupported: 0, sameGroup: false }
  if (Object.keys(rule).some((key) => !supportedCiliumRuleKeys.has(key))) return { rules: [], unsupported: 1, sameGroup: false }
  const keys = ciliumPeerKeys[direction]
  const peers: Array<Pick<SgRule, "remoteType" | "remote">> = []
  let unsupported = 0
  let sameGroup = false
  for (const cidr of (rule[keys.cidr] as string[] | undefined) || []) peers.push({ remoteType: cidr === "0.0.0.0/0" ? "any" : "cidr", remote: cidr === "0.0.0.0/0" ? "" : cidr })
  for (const selector of asList(rule[keys.endpoints])) {
    const group = groupFromSelector(selector)
    if (group === null) unsupported++
    else peers.push({ remoteType: "group", remote: group })
  }
  for (const entity of (rule[keys.entities] as string[] | undefined) || []) {
    if (entity === "all" || entity === "world") peers.push({ remoteType: "any", remote: "" })
    else unsupported++
  }
  if (peers.length === 0 && unsupported === 0) peers.push({ remoteType: "any", remote: "" })

  const protocols: Array<Pick<SgRule, "protocol" | "ports">> = []
  for (const toPort of asList(rule.toPorts)) {
    if (Object.keys(toPort).some((key) => key !== "ports")) {
      unsupported++
      continue
    }
    for (const port of asList(toPort.ports)) {
      const proto = str(port.protocol, "ANY").toLowerCase()
      const start = str(port.port)
      const end = str(port.endPort)
      protocols.push({ protocol: proto === "tcp" || proto === "udp" ? proto : "all", ports: start && start !== "0" ? (end ? `${start}-${end}` : start) : "" })
    }
  }
  if (asList(rule.icmps).length > 0) protocols.push({ protocol: "icmp", ports: "" })
  if (protocols.length === 0) protocols.push({ protocol: "all", ports: "" })

  const rules: SgRule[] = []
  for (const peer of peers) {
    for (const proto of protocols) {
      if (direction === "ingress" && action === "allow" && peer.remoteType === "group" && peer.remote === self && proto.protocol === "all") {
        sameGroup = true
        continue
      }
      rules.push({ direction, action, priority: 100, ...peer, ...proto })
    }
  }
  return { rules, unsupported, sameGroup }
}

const toCiliumRule = (rule: SgRule): UnknownRecord => {
  const keys = ciliumPeerKeys[rule.direction]
  const out: UnknownRecord = {}
  if (rule.remoteType === "any") out[keys.entities] = ["all"]
  else if (rule.remoteType === "cidr") out[keys.cidr] = [rule.remote]
  else out[keys.endpoints] = [{ matchLabels: { [ciliumSecurityGroupLabel(rule.remote)]: "true" } }]
  if (rule.protocol === "icmp") {
    out.icmps = [{ fields: [{ type: 8, family: "IPv4" }] }]
  } else if (rule.protocol === "tcp" || rule.protocol === "udp") {
    const range = portRange(rule.ports)
    const port: UnknownRecord = { port: range ? String(range.min) : "0", protocol: rule.protocol.toUpperCase() }
    if (range && range.max > range.min) port.endPort = range.max
    out.toPorts = [{ ports: [port] }]
  }
  return out
}

export const fromCilium = (obj: KubeObject): SecurityGroup => {
  const spec = asRecord(obj.spec)
  const managed = obj.metadata.labels?.[managedSecurityGroupLabel] === "true"
  const name = obj.metadata.name
  let unsupported = 0
  let allowSameGroup = false
  const rules: SgRule[] = []
  const sections: Array<[string, SgDirection, SgRule["action"]]> = [["ingress", "ingress", "allow"], ["ingressDeny", "ingress", "deny"], ["egress", "egress", "allow"], ["egressDeny", "egress", "deny"]]
  for (const [key, direction, action] of sections) {
    for (const rule of asList(spec[key])) {
      const parsed = fromCiliumRule(rule, direction, action, name)
      rules.push(...parsed.rules)
      unsupported += parsed.unsupported
      allowSameGroup ||= parsed.sameGroup
    }
  }
  if (Array.isArray(spec.specs)) unsupported += spec.specs.length
  const selectorLabels = asRecord(asRecord(spec.endpointSelector).matchLabels)
  return {
    provider: "cilium",
    name,
    namespace: obj.metadata.namespace,
    description: obj.metadata.annotations?.[descriptionAnnotation] || str(spec.description),
    managed,
    allowSameGroup,
    rules,
    unsupported,
    selector: Object.entries(selectorLabels).map(([key, value]) => `${key}=${value}`).join(", ") || "all endpoints in namespace",
    raw: obj,
  }
}

const ciliumSpec = (name: string, sg: Pick<SecurityGroup, "rules" | "allowSameGroup">) => {
  const spec: UnknownRecord = { endpointSelector: { matchLabels: { [ciliumSecurityGroupLabel(name)]: "true" } } }
  const sections: Record<string, UnknownRecord[]> = { ingress: [], ingressDeny: [], egress: [], egressDeny: [] }
  if (sg.allowSameGroup) sections.ingress.push({ fromEndpoints: [{ matchLabels: { [ciliumSecurityGroupLabel(name)]: "true" } }] })
  for (const rule of sg.rules) {
    const key = `${rule.direction}${rule.action === "deny" ? "Deny" : ""}`
    sections[key].push(toCiliumRule(rule))
  }
  for (const [key, value] of Object.entries(sections)) {
    if (value.length) spec[key] = value
  }
  // An empty ingress list still puts endpoints into default-deny, matching cloud security group semantics.
  if (!spec.ingress && !spec.ingressDeny) spec.ingress = [{}]
  return spec
}

// --- CRUD ---

export const listSecurityGroups = async (provider: SgProvider, namespace?: string): Promise<SecurityGroup[]> => {
  if (provider === "kube-ovn") return (await listItems(`${OVN}/security-groups`)).map(fromKubeOvn)
  const path = namespace && namespace !== "all" ? `${CILIUM}/namespaces/${namespace}/ciliumnetworkpolicies` : `${CILIUM}/ciliumnetworkpolicies`
  return (await listItems(path)).map(fromCilium)
}

export const sgUrl = (provider: SgProvider, name: string, namespace?: string) =>
  provider === "kube-ovn" ? `${OVN}/security-groups/${name}` : `${CILIUM}/namespaces/${namespace}/ciliumnetworkpolicies/${name}`

export const getSecurityGroup = async (provider: SgProvider, name: string, namespace?: string) => {
  const res = await apiFetch(sgUrl(provider, name, namespace))
  if (!res.ok) return null
  const obj = await res.json() as KubeObject
  return provider === "kube-ovn" ? fromKubeOvn(obj) : fromCilium(obj)
}

export const createSecurityGroup = async (provider: SgProvider, input: { name: string; namespace?: string; description: string; rules: SgRule[]; allowSameGroup: boolean }) => {
  const annotations = input.description ? { [descriptionAnnotation]: input.description } : undefined
  if (provider === "kube-ovn") {
    return requestJson(`${OVN}/security-groups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiVersion: "kubeovn.io/v1", kind: "SecurityGroup", metadata: { name: input.name, annotations }, spec: kubeOvnSpec(input) }),
    })
  }
  return requestJson(`${CILIUM}/namespaces/${input.namespace}/ciliumnetworkpolicies`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apiVersion: "cilium.io/v2",
      kind: "CiliumNetworkPolicy",
      metadata: { name: input.name, namespace: input.namespace, labels: { [managedSecurityGroupLabel]: "true" }, annotations },
      spec: ciliumSpec(input.name, input),
    }),
  })
}

export const saveSecurityGroupRules = async (sg: SecurityGroup, rules: SgRule[], allowSameGroup: boolean) => {
  const url = sgUrl(sg.provider, sg.name, sg.namespace)
  if (sg.provider === "kube-ovn") {
    return requestJson(url, { method: "PATCH", headers: { "Content-Type": "application/merge-patch+json" }, body: JSON.stringify({ spec: kubeOvnSpec({ rules, allowSameGroup }) }) })
  }
  // Replace the rule sections while keeping the policy's own selector when it is not dashboard managed.
  const next = ciliumSpec(sg.name, { rules, allowSameGroup })
  if (!sg.managed) next.endpointSelector = asRecord(sg.raw.spec).endpointSelector || {}
  const body = { ...sg.raw, spec: next }
  return requestJson(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
}

export const deleteSecurityGroup = (sg: SecurityGroup) => requestJson(sgUrl(sg.provider, sg.name, sg.namespace), { method: "DELETE" })

// --- Instance binding ---

type VmLike = KubeObject

const templateMeta = (vm: VmLike) => asRecord(asRecord(asRecord(vm.spec).template).metadata)

export const vmSecurityGroups = (vm: VmLike, provider: SgProvider): string[] => {
  const meta = templateMeta(vm)
  if (provider === "kube-ovn") {
    return str(asRecord(meta.annotations)[kubeOvnAnnotations.securityGroups]).split(",").map((item) => item.trim()).filter(Boolean)
  }
  const prefix = ciliumSecurityGroupLabel("")
  return Object.entries(asRecord(meta.labels)).filter(([key, value]) => key.startsWith(prefix) && value === "true").map(([key]) => key.slice(prefix.length))
}

export const vmMatchesGroup = (vm: VmLike, sg: SecurityGroup) => {
  if (sg.provider === "cilium" && vm.metadata.namespace !== sg.namespace) return false
  if (sg.provider === "cilium" && !sg.managed) {
    const selector = asRecord(asRecord(sg.raw.spec).endpointSelector).matchLabels
    const labels = asRecord(templateMeta(vm).labels)
    const entries = Object.entries(asRecord(selector))
    return entries.length > 0 && entries.every(([key, value]) => labels[key] === value)
  }
  return vmSecurityGroups(vm, sg.provider).includes(sg.name)
}

const mergePatch = (url: string, body: unknown) =>
  requestJson(url, { method: "PATCH", headers: { "Content-Type": "application/merge-patch+json" }, body: JSON.stringify(body) })

/**
 * Sets the security groups of a VM. Writes the VM template (persistent) and the running
 * virt-launcher pod (so the change applies without restarting where the CNI supports it).
 */
export const setVmSecurityGroups = async (vm: VmLike, provider: SgProvider, groups: string[]) => {
  const namespace = vm.metadata.namespace
  const name = vm.metadata.name
  let metaPatch: UnknownRecord
  if (provider === "kube-ovn") {
    metaPatch = {
      annotations: groups.length
        ? { [kubeOvnAnnotations.securityGroups]: groups.join(","), [kubeOvnAnnotations.portSecurity]: "true" }
        : { [kubeOvnAnnotations.securityGroups]: null },
    }
  } else {
    const current = vmSecurityGroups(vm, provider)
    const labels: Record<string, string | null> = {}
    for (const group of current) labels[ciliumSecurityGroupLabel(group)] = null
    for (const group of groups) labels[ciliumSecurityGroupLabel(group)] = "true"
    metaPatch = { labels }
  }
  await mergePatch(`${VM_API}/namespaces/${namespace}/virtualmachines/${name}`, { spec: { template: { metadata: metaPatch } } })
  const pods = await listItems(`/api/v1/namespaces/${namespace}/pods?labelSelector=${encodeURIComponent(`vm.kubevirt.io/name=${name}`)}`)
  await Promise.all(pods.map((pod) => mergePatch(`/api/v1/namespaces/${namespace}/pods/${pod.metadata.name}`, { metadata: metaPatch }).catch(() => null)))
}

// --- Routing and provider selection ---

export const sgDetailPath = (sg: Pick<SecurityGroup, "provider" | "name" | "namespace">) =>
  sg.provider === "kube-ovn" ? `/vpc/security-groups/kube-ovn/${sg.name}` : `/vpc/security-groups/cilium/${sg.namespace}/${sg.name}`

export const engineLabel: Record<SgProvider, string> = {
  "kube-ovn": "Kube-OVN",
  cilium: "Cilium",
}

export const engineResource: Record<SgProvider, string> = {
  "kube-ovn": "Kube-OVN SecurityGroup",
  cilium: "CiliumNetworkPolicy",
}

/**
 * Security group engines of the current network stack. `provider` is the default engine (null when
 * ACLs use NetworkPolicy); `providers` lists every engine the user may pick, e.g. Cilium and Kube-OVN
 * on the Kube-OVN + Cilium stack.
 */
export function useSgProvider(): { provider: SgProvider | null; providers: SgProvider[]; loaded: boolean } {
  const profile = useNetworkProfile()
  return { provider: profile.aclEngines[0] ?? null, providers: profile.aclEngines, loaded: profile.loaded }
}

export type SgRef = { provider: SgProvider; name: string }

export const sgRefKey = (ref: SgRef) => `${ref.provider}:${ref.name}`

export const vmSecurityGroupRefs = (vm: VmLike, providers: SgProvider[]): SgRef[] =>
  providers.flatMap((provider) => vmSecurityGroups(vm, provider).map((name) => ({ provider, name })))

export const listAllSecurityGroups = async (providers: SgProvider[], namespace?: string) =>
  (await Promise.all(providers.map((provider) => listSecurityGroups(provider, namespace)))).flat()

/** Applies the full set of security groups across engines, leaving engines without changes untouched. */
export const setVmSecurityGroupRefs = async (vm: VmLike, providers: SgProvider[], refs: SgRef[]) => {
  for (const provider of providers) {
    const next = refs.filter((ref) => ref.provider === provider).map((ref) => ref.name)
    const current = vmSecurityGroups(vm, provider)
    if (next.length === current.length && next.every((name) => current.includes(name))) continue
    await setVmSecurityGroups(vm, provider, next)
  }
}
