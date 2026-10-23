import {
  apiFetch,
  asList,
  asRecord,
  ciliumGlobalGroupLabel,
  getContext,
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
import { parseIPv4Cidr } from "./validate"
import { t } from "./i18n"

/**
 * A provider-neutral security group, modeled after cloud security groups:
 * stateful allow/deny rules per direction, attached to instances.
 *
 * - kube-ovn: kubeovn.io/v1 SecurityGroup (cluster scoped). Instances attach through the
 *   ovn.kubernetes.io/security_groups annotation on the VM template.
 * - cilium: cilium.io/v2 CiliumNetworkPolicy (namespaced). The policy selects endpoints carrying
 *   the sg.kubevirt-dashboard.io/<name> label, which is set on the VM template. A cluster-wide group
 *   is a CiliumClusterwideNetworkPolicy selecting global.sg.kubevirt-dashboard.io/<name>; its
 *   `namespace` is undefined.
 */
export type SgProvider = "kube-ovn" | "cilium"
export type SgDirection = "ingress" | "egress"
export type SgProtocol = "all" | "tcp" | "udp" | "icmp"
/** addressGroup (Cilium only) references a CiliumCIDRGroup by name. */
export type SgRemoteType = "any" | "cidr" | "group" | "addressGroup"

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

/** Returns why a rule cannot be saved, or "" when it is valid. */
export const ruleProblem = (rule: SgRule) => {
  if (rule.remoteType === "cidr") {
    const remote = rule.remote.trim()
    if (!remote) return t("A CIDR rule needs a CIDR block.")
    if (!remote.includes(":") && !parseIPv4Cidr(remote)) return t("{cidr} is not a valid CIDR.", { cidr: remote })
  }
  if (rule.remoteType === "group" && !rule.remote.trim()) return t("Choose a security group.")
  if (rule.remoteType === "addressGroup" && !rule.remote.trim()) return t("Choose an address group.")
  if ((rule.protocol === "tcp" || rule.protocol === "udp") && rule.ports.trim()) {
    const match = /^(\d+)(?:-(\d+))?$/.exec(rule.ports.trim())
    const min = Number(match?.[1])
    const max = Number(match?.[2] ?? match?.[1])
    if (!match || min < 1 || max > 65535 || min > max) return t("Invalid port range {ports}. Use 22 or 8000-8100 within 1-65535.", { ports: rule.ports })
  }
  return ""
}

export const ruleSummary = (rule: SgRule) => {
  const proto = rule.protocol === "all" ? t("All traffic") : rule.protocol.toUpperCase()
  const ports = rule.protocol === "all" || rule.protocol === "icmp" ? "" : rule.ports ? ` ${rule.ports}` : " all ports"
  return `${proto}${ports}`
}

export const remoteSummary = (rule: SgRule) =>
  rule.remoteType === "any" ? t("Anywhere")
    : rule.remoteType === "group" ? t("Security group {name}", { name: rule.remote })
      : rule.remoteType === "addressGroup" ? t("Address group {name}", { name: rule.remote })
        : rule.remote

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
  ingress: { cidr: "fromCIDR", cidrSet: "fromCIDRSet", endpoints: "fromEndpoints", entities: "fromEntities" },
  egress: { cidr: "toCIDR", cidrSet: "toCIDRSet", endpoints: "toEndpoints", entities: "toEntities" },
} as const

const supportedCiliumRuleKeys = new Set(["fromCIDR", "fromCIDRSet", "fromEndpoints", "fromEntities", "toCIDR", "toCIDRSet", "toEndpoints", "toEntities", "toPorts", "icmps"])

/** Label key of a Cilium group: namespaced groups and cluster-wide groups use different prefixes. */
const groupLabel = (global: boolean) => (global ? ciliumGlobalGroupLabel : ciliumSecurityGroupLabel)

const groupFromSelector = (selector: UnknownRecord, global: boolean) => {
  const labels = asRecord(selector.matchLabels)
  const keys = Object.keys(labels)
  const prefix = groupLabel(global)("")
  if (keys.length === 1 && keys[0].startsWith(prefix)) return keys[0].slice(prefix.length)
  return null
}

const fromCiliumRule = (rule: UnknownRecord, direction: SgDirection, action: SgRule["action"], self: string, global: boolean): { rules: SgRule[]; unsupported: number; sameGroup: boolean } => {
  // `{}` is the default-deny placeholder written by ciliumSpec; it allows nothing.
  if (Object.keys(rule).length === 0) return { rules: [], unsupported: 0, sameGroup: false }
  if (Object.keys(rule).some((key) => !supportedCiliumRuleKeys.has(key))) return { rules: [], unsupported: 1, sameGroup: false }
  const keys = ciliumPeerKeys[direction]
  const peers: Array<Pick<SgRule, "remoteType" | "remote">> = []
  let unsupported = 0
  let sameGroup = false
  for (const cidr of (rule[keys.cidr] as string[] | undefined) || []) peers.push({ remoteType: cidr === "0.0.0.0/0" ? "any" : "cidr", remote: cidr === "0.0.0.0/0" ? "" : cidr })
  for (const entry of asList(rule[keys.cidrSet])) {
    if (Object.keys(entry).length === 1 && entry.cidrGroupRef) peers.push({ remoteType: "addressGroup", remote: str(entry.cidrGroupRef) })
    else if (Object.keys(entry).length === 1 && entry.cidr) peers.push({ remoteType: "cidr", remote: str(entry.cidr) })
    else unsupported++
  }
  for (const selector of asList(rule[keys.endpoints])) {
    const group = groupFromSelector(selector, global)
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

const toCiliumRule = (rule: SgRule, global: boolean): UnknownRecord => {
  const keys = ciliumPeerKeys[rule.direction]
  const out: UnknownRecord = {}
  if (rule.remoteType === "any") out[keys.entities] = ["all"]
  else if (rule.remoteType === "cidr") out[keys.cidr] = [rule.remote]
  else if (rule.remoteType === "addressGroup") out[keys.cidrSet] = [{ cidrGroupRef: rule.remote }]
  else out[keys.endpoints] = [{ matchLabels: { [groupLabel(global)(rule.remote)]: "true" } }]
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
  const global = !obj.metadata.namespace
  let unsupported = 0
  let allowSameGroup = false
  const rules: SgRule[] = []
  const sections: Array<[string, SgDirection, SgRule["action"]]> = [["ingress", "ingress", "allow"], ["ingressDeny", "ingress", "deny"], ["egress", "egress", "allow"], ["egressDeny", "egress", "deny"]]
  for (const [key, direction, action] of sections) {
    for (const rule of asList(spec[key])) {
      const parsed = fromCiliumRule(rule, direction, action, name, global)
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
    selector: Object.entries(selectorLabels).map(([key, value]) => `${key}=${value}`).join(", ") || (global ? "all endpoints" : "all endpoints in namespace"),
    raw: obj,
  }
}

const ciliumSpec = (name: string, sg: Pick<SecurityGroup, "rules" | "allowSameGroup">, global: boolean) => {
  const label = groupLabel(global)(name)
  const spec: UnknownRecord = { endpointSelector: { matchLabels: { [label]: "true" } } }
  const sections: Record<string, UnknownRecord[]> = { ingress: [], ingressDeny: [], egress: [], egressDeny: [] }
  if (sg.allowSameGroup) sections.ingress.push({ fromEndpoints: [{ matchLabels: { [label]: "true" } }] })
  for (const rule of sg.rules) {
    const key = `${rule.direction}${rule.action === "deny" ? "Deny" : ""}`
    sections[key].push(toCiliumRule(rule, global))
  }
  for (const [key, value] of Object.entries(sections)) {
    if (value.length) spec[key] = value
  }
  // An empty ingress list still puts endpoints into default-deny, matching cloud security group semantics.
  if (!spec.ingress && !spec.ingressDeny) spec.ingress = [{}]
  return spec
}

// --- CRUD ---

/** Cilium lists include the cluster-wide groups, which apply in every namespace. */
export const listSecurityGroups = async (provider: SgProvider, namespace?: string): Promise<SecurityGroup[]> => {
  if (provider === "kube-ovn") return (await listItems(`${OVN}/security-groups`)).map(fromKubeOvn)
  const path = namespace && namespace !== "all" ? `${CILIUM}/namespaces/${namespace}/ciliumnetworkpolicies` : `${CILIUM}/ciliumnetworkpolicies`
  const [namespaced, clusterwide] = await Promise.all([listItems(path), listItems(`${CILIUM}/ciliumclusterwidenetworkpolicies`).catch(() => [] as KubeObject[])])
  return [...clusterwide, ...namespaced].map(fromCilium)
}

export const isGlobalGroup = (sg: Pick<SecurityGroup, "provider" | "namespace">) => sg.provider === "cilium" && !sg.namespace

export const sgUrl = (provider: SgProvider, name: string, namespace?: string) =>
  provider === "kube-ovn" ? `${OVN}/security-groups/${name}`
    : namespace ? `${CILIUM}/namespaces/${namespace}/ciliumnetworkpolicies/${name}`
      : `${CILIUM}/ciliumclusterwidenetworkpolicies/${name}`

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
  // No namespace makes a cluster-wide group.
  const global = !input.namespace
  return requestJson(global ? `${CILIUM}/ciliumclusterwidenetworkpolicies` : `${CILIUM}/namespaces/${input.namespace}/ciliumnetworkpolicies`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apiVersion: "cilium.io/v2",
      kind: global ? "CiliumClusterwideNetworkPolicy" : "CiliumNetworkPolicy",
      metadata: { name: input.name, ...(global ? {} : { namespace: input.namespace }), labels: { [managedSecurityGroupLabel]: "true" }, annotations },
      spec: ciliumSpec(input.name, input, global),
    }),
  })
}

export const saveSecurityGroupRules = async (sg: SecurityGroup, rules: SgRule[], allowSameGroup: boolean) => {
  const url = sgUrl(sg.provider, sg.name, sg.namespace)
  if (sg.provider === "kube-ovn") {
    return requestJson(url, { method: "PATCH", headers: { "Content-Type": "application/merge-patch+json" }, body: JSON.stringify({ spec: kubeOvnSpec({ rules, allowSameGroup }) }) })
  }
  // Replace the rule sections while keeping the policy's own selector when it is not dashboard managed.
  const next = ciliumSpec(sg.name, { rules, allowSameGroup }, isGlobalGroup(sg))
  if (!sg.managed) next.endpointSelector = asRecord(sg.raw.spec).endpointSelector || {}
  const body = { ...sg.raw, spec: next }
  return requestJson(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
}

export const deleteSecurityGroup = (sg: SecurityGroup) => requestJson(sgUrl(sg.provider, sg.name, sg.namespace), { method: "DELETE" })

// --- Instance binding ---

type VmLike = KubeObject

const templateMeta = (vm: VmLike) => asRecord(asRecord(asRecord(vm.spec).template).metadata)

/** Groups of one engine on a VM; `global` selects the cluster-wide Cilium groups. */
export const vmSecurityGroups = (vm: VmLike, provider: SgProvider, global = false): string[] => {
  const meta = templateMeta(vm)
  if (provider === "kube-ovn") {
    return str(asRecord(meta.annotations)[kubeOvnAnnotations.securityGroups]).split(",").map((item) => item.trim()).filter(Boolean)
  }
  const prefix = groupLabel(global)("")
  return Object.entries(asRecord(meta.labels)).filter(([key, value]) => key.startsWith(prefix) && value === "true").map(([key]) => key.slice(prefix.length))
}

export const vmMatchesGroup = (vm: VmLike, sg: SecurityGroup) => {
  if (sg.provider === "cilium" && sg.namespace && vm.metadata.namespace !== sg.namespace) return false
  if (sg.provider === "cilium" && !sg.managed) {
    const selector = asRecord(asRecord(sg.raw.spec).endpointSelector).matchLabels
    const labels = asRecord(templateMeta(vm).labels)
    const entries = Object.entries(asRecord(selector))
    return entries.length > 0 && entries.every(([key, value]) => labels[key] === value)
  }
  return vmSecurityGroups(vm, sg.provider, isGlobalGroup(sg)).includes(sg.name)
}

const mergePatch = (url: string, body: unknown) =>
  requestJson(url, { method: "PATCH", headers: { "Content-Type": "application/merge-patch+json" }, body: JSON.stringify(body) })

/**
 * Sets the security groups of a VM. Writes the VM template (persistent) and the running
 * virt-launcher pod (so the change applies without restarting where the CNI supports it).
 */
export const setVmSecurityGroups = async (vm: VmLike, provider: SgProvider, groups: string[], global = false) => {
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
    const current = vmSecurityGroups(vm, provider, global)
    const label = groupLabel(global)
    const labels: Record<string, string | null> = {}
    for (const group of current) labels[label(group)] = null
    for (const group of groups) labels[label(group)] = "true"
    metaPatch = { labels }
  }
  await mergePatch(`${VM_API}/namespaces/${namespace}/virtualmachines/${name}`, { spec: { template: { metadata: metaPatch } } })
  const pods = await listItems(`/api/v1/namespaces/${namespace}/pods?labelSelector=${encodeURIComponent(`vm.kubevirt.io/name=${name}`)}`)
  await Promise.all(pods.map((pod) => mergePatch(`/api/v1/namespaces/${namespace}/pods/${pod.metadata.name}`, { metadata: metaPatch }).catch(() => null)))
}

// --- Routing and provider selection ---

export const sgDetailPath = (sg: Pick<SecurityGroup, "provider" | "name" | "namespace">) =>
  sg.provider === "kube-ovn" ? `/vpc/security-groups/kube-ovn/${sg.name}`
    : sg.namespace ? `/vpc/security-groups/cilium/${sg.namespace}/${sg.name}`
      : `/vpc/security-groups/cilium/${sg.name}`

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

/** `global` marks a cluster-wide Cilium group. */
export type SgRef = { provider: SgProvider; name: string; global?: boolean }

export const sgRefKey = (ref: SgRef) => `${ref.provider}:${ref.global ? "cluster/" : ""}${ref.name}`

export const sgRefOf = (sg: SecurityGroup): SgRef => ({ provider: sg.provider, name: sg.name, ...(isGlobalGroup(sg) ? { global: true } : {}) })

export const vmSecurityGroupRefs = (vm: VmLike, providers: SgProvider[]): SgRef[] =>
  providers.flatMap((provider) => [
    ...(provider === "cilium" ? vmSecurityGroups(vm, provider, true).map((name) => ({ provider, name, global: true })) : []),
    ...vmSecurityGroups(vm, provider).map((name) => ({ provider, name })),
  ])

/**
 * Wizard selections are plain strings: the group name, or "cluster/<name>" for a cluster-wide
 * Cilium group ("/" never appears in a group name).
 */
export const sgSelectionKey = (sg: SecurityGroup) => (isGlobalGroup(sg) ? `cluster/${sg.name}` : sg.name)
export const parseSgSelection = (key: string) => (key.startsWith("cluster/") ? { name: key.slice("cluster/".length), global: true } : { name: key, global: false })

export const listAllSecurityGroups = async (providers: SgProvider[], namespace?: string) =>
  (await Promise.all(providers.map((provider) => listSecurityGroups(provider, namespace)))).flat()

/** Applies the full set of security groups across engines, leaving engines without changes untouched. */
export const setVmSecurityGroupRefs = async (vm: VmLike, providers: SgProvider[], refs: SgRef[]) => {
  for (const provider of providers) {
    for (const global of provider === "cilium" ? [false, true] : [false]) {
      const next = refs.filter((ref) => ref.provider === provider && Boolean(ref.global) === global).map((ref) => ref.name)
      const current = vmSecurityGroups(vm, provider, global)
      if (next.length === current.length && next.every((name) => current.includes(name))) continue
      await setVmSecurityGroups(vm, provider, next, global)
    }
  }
}

// --- Address groups (CiliumCIDRGroup) ---

const cidrGroupBases = new Map<string, string>()

/** CiliumCIDRGroup is served as v2 since Cilium 1.18 and as v2alpha1 before. */
const cidrGroupApi = async () => {
  const cached = cidrGroupBases.get(getContext())
  if (cached) return cached
  for (const version of ["v2", "v2alpha1"]) {
    const base = `/apis/cilium.io/${version}/ciliumcidrgroups`
    const res = await apiFetch(`${base}?limit=1`)
    if (res.ok) {
      cidrGroupBases.set(getContext(), base)
      return base
    }
  }
  return "/apis/cilium.io/v2/ciliumcidrgroups"
}

export type AddressGroup = { name: string; description: string; cidrs: string[]; raw: KubeObject }

export const listAddressGroups = async (): Promise<AddressGroup[]> =>
  (await listItems(await cidrGroupApi()).catch(() => [] as KubeObject[])).map((obj) => ({
    name: obj.metadata.name,
    description: obj.metadata.annotations?.[descriptionAnnotation] || "",
    cidrs: (asRecord(obj.spec).externalCIDRs as string[] | undefined) || [],
    raw: obj,
  }))

export const saveAddressGroup = async (input: { name: string; description: string; cidrs: string[] }, existing?: AddressGroup) => {
  const base = await cidrGroupApi()
  const annotations = { [descriptionAnnotation]: input.description || null }
  if (existing) {
    return requestJson(`${base}/${input.name}`, { method: "PATCH", headers: { "Content-Type": "application/merge-patch+json" }, body: JSON.stringify({ metadata: { annotations }, spec: { externalCIDRs: input.cidrs } }) })
  }
  return requestJson(base, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apiVersion: base.split("/").slice(2, 4).join("/"),
      kind: "CiliumCIDRGroup",
      metadata: { name: input.name, ...(input.description ? { annotations: { [descriptionAnnotation]: input.description } } : {}) },
      spec: { externalCIDRs: input.cidrs },
    }),
  })
}

export const deleteAddressGroup = async (name: string) => requestJson(`${await cidrGroupApi()}/${name}`, { method: "DELETE" })

/** Security groups whose rules reference an address group. */
export const addressGroupUsers = (groups: SecurityGroup[], name: string) =>
  groups.filter((sg) => sg.provider === "cilium" && sg.rules.some((rule) => rule.remoteType === "addressGroup" && rule.remote === name))
