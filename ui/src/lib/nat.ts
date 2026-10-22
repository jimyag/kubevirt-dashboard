import { asRecord, str, type KubeObject } from "./kube"

/**
 * Kube-OVN NAT resources (kubeovn.io/v1, cluster scoped). Kube-OVN has two NAT models:
 *
 * - "iptables": a VpcNatGateway pod per custom VPC; IptablesEIP plus IptablesSnatRule,
 *   IptablesDnatRule and IptablesFIPRule bound to an EIP through `spec.eip`.
 * - "ovn": NAT in the OVN logical router; OvnEip plus OvnSnatRule, OvnDnatRule and OvnFip bound
 *   through `spec.ovnEip`.
 *
 * Field names follow the Kube-OVN 1.16 CRDs.
 */

export const OVN_API = "/apis/kubeovn.io/v1"

export type NatEngine = "iptables" | "ovn"
export type NatTab = "gateways" | "eips" | "snat" | "dnat" | "fip"

/** References offered as suggestions in create forms; loaded when a form opens. */
export type NatRefs = {
  gateways: KubeObject[]
  iptablesEips: KubeObject[]
  ovnEips: KubeObject[]
  vpcs: KubeObject[]
  subnets: KubeObject[]
  ips: KubeObject[]
  qosPolicies: KubeObject[]
}

export type NatOption = { value: string; hint?: string }

export type NatFormField = {
  name: string
  label: string
  /** Free text with suggestions; `choices` instead renders fixed ChoiceCards. */
  suggest?: (refs: NatRefs, values: Record<string, string>) => NatOption[]
  choices?: NatOption[]
  required?: boolean
  placeholder?: string
  hint?: string
  mono?: boolean
}

export type NatColumn = {
  key: string
  header: string
  value: (item: KubeObject) => string
  mono?: boolean
  /** Page of the referenced object, so references open the same way from every table. */
  link?: (value: string) => string
}

const gatewayLink = (name: string) => `/vpc/nat-gateways/${name}`
const vpcLink = (name: string) => `/vpc/vpcs/${name}`
const subnetLink = (name: string) => `/vpc/subnets/${name}`
const eipLink = (plural: string) => (name: string) => `/networks/kube-ovn/${plural}/_cluster/${name}`

export type NatKind = {
  plural: string
  kind: string
  /** Singular label, e.g. "SNAT rule". */
  label: string
  /** Generic Resource Catalog route, used for detail pages. */
  catalogPath: string
  columns: NatColumn[]
  /** False for kinds without status.ready (NAT gateways). */
  hasReady: boolean
  fields: NatFormField[]
  defaults?: Record<string, string>
  validate?: (values: Record<string, string>) => string | null
  buildSpec: (values: Record<string, string>) => Record<string, unknown>
}

const spec = (item: KubeObject) => asRecord(item.spec)
const status = (item: KubeObject) => asRecord(item.status)

export const natReady = (item: KubeObject) => {
  const value = status(item).ready
  if (value === true) return "Ready"
  if (value === false) return "NotReady"
  return "Pending"
}

/** Drops empty optional values so the spec only carries what was entered. */
const compact = (values: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(values).filter(([, value]) => value !== "" && value !== undefined && !(Array.isArray(value) && value.length === 0)))

const csv = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean)

const isIp = (value: string) => /^(\d{1,3}\.){3}\d{1,3}$/.test(value) || (value.includes(":") && /^[0-9a-fA-F:]+$/.test(value))
const isCidr = (value: string) => {
  const [ip, prefix] = value.split("/")
  return Boolean(ip) && isIp(ip) && prefix !== undefined && /^\d{1,3}$/.test(prefix)
}
const isPort = (value: string) => /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 65535

const names = (items: KubeObject[], hint?: (item: KubeObject) => string): NatOption[] =>
  items.map((item) => ({ value: item.metadata.name, hint: hint?.(item) }))

const eipAddress = (item: KubeObject) => str(status(item).ip) || str(spec(item).v4ip) || str(status(item).v4Ip) || str(spec(item).v4Ip)

const subnetOptions = (refs: NatRefs) => names(refs.subnets, (subnet) => `${str(spec(subnet).vpc, "ovn-cluster")} · ${str(spec(subnet).cidrBlock)}`)
const ipNameOptions = (refs: NatRefs) => names(refs.ips, (ip) => str(spec(ip).v4IpAddress) || str(spec(ip).ipAddress))
const internalIpOptions = (refs: NatRefs) =>
  refs.ips
    .map((ip) => ({ value: str(spec(ip).v4IpAddress) || str(spec(ip).ipAddress), hint: str(spec(ip).podName) || ip.metadata.name }))
    .filter((option) => option.value)

const protocolChoices: NatOption[] = [{ value: "tcp", hint: "TCP" }, { value: "udp", hint: "UDP" }]

const portFields = (protocolHint = ""): NatFormField[] => [
  { name: "protocol", label: "Protocol", choices: protocolChoices, required: true, hint: protocolHint || undefined },
  { name: "externalPort", label: "External port", required: true, placeholder: "8080", mono: true },
  { name: "internalPort", label: "Internal port", required: true, placeholder: "80", mono: true },
]

const validatePorts = (values: Record<string, string>) => {
  if (!isPort(values.externalPort)) return "External port must be 1-65535"
  if (!isPort(values.internalPort)) return "Internal port must be 1-65535"
  return null
}

// --- iptables (VPC NAT gateway) ---

const gateway: NatKind = {
  plural: "vpc-nat-gateways",
  kind: "VpcNatGateway",
  label: "NAT gateway",
  catalogPath: "/networks/kube-ovn/vpc-nat-gateways",
  hasReady: false,
  columns: [
    { key: "vpc", header: "VPC", value: (item) => str(spec(item).vpc), link: vpcLink },
    { key: "subnet", header: "Subnet", value: (item) => str(spec(item).subnet), link: subnetLink },
    { key: "lanip", header: "LAN IP", value: (item) => str(spec(item).lanIp), mono: true },
    { key: "external", header: "External subnets", value: (item) => ((spec(item).externalSubnets as string[] | undefined) || []).join(", ") },
    { key: "qos", header: "QoS policy", value: (item) => str(spec(item).qosPolicy) },
  ],
  fields: [
    { name: "vpc", label: "VPC", required: true, suggest: (refs) => names(refs.vpcs) },
    {
      name: "subnet",
      label: "Subnet",
      required: true,
      hint: "A subnet of the VPC; the gateway pod gets its LAN address here.",
      suggest: (refs, values) => subnetOptions({ ...refs, subnets: refs.subnets.filter((subnet) => !values.vpc || str(spec(subnet).vpc, "ovn-cluster") === values.vpc) }),
    },
    { name: "lanIp", label: "LAN IP", required: true, mono: true, placeholder: "10.0.1.254", hint: "An unused address in the subnet; route the VPC's default traffic to it." },
    { name: "externalSubnets", label: "External subnets", placeholder: "ovn-vpc-external-network", hint: "Comma separated. Empty uses the default external network.", suggest: (refs) => subnetOptions(refs) },
    { name: "qosPolicy", label: "QoS policy", suggest: (refs) => names(refs.qosPolicies) },
  ],
  validate: (values) => (isIp(values.lanIp) ? null : "LAN IP must be an IP address"),
  buildSpec: (values) => compact({
    vpc: values.vpc,
    subnet: values.subnet,
    lanIp: values.lanIp,
    externalSubnets: csv(values.externalSubnets || ""),
    qosPolicy: values.qosPolicy,
  }),
}

const iptablesEip: NatKind = {
  plural: "iptables-eips",
  kind: "IptablesEIP",
  label: "elastic IP",
  catalogPath: "/networks/kube-ovn/iptables-eips",
  hasReady: true,
  columns: [
    { key: "ip", header: "IP address", value: eipAddress, mono: true },
    { key: "gateway", header: "NAT gateway", value: (item) => str(spec(item).natGwDp), link: gatewayLink },
    { key: "external", header: "External subnet", value: (item) => str(spec(item).externalSubnet) },
    { key: "used", header: "Used by", value: (item) => str(status(item).nat) },
    { key: "qos", header: "QoS policy", value: (item) => str(spec(item).qosPolicy) || str(status(item).qosPolicy) },
  ],
  fields: [
    { name: "natGwDp", label: "NAT gateway", required: true, suggest: (refs) => names(refs.gateways, (gw) => str(spec(gw).vpc)) },
    { name: "externalSubnet", label: "External subnet", placeholder: "ovn-vpc-external-network", hint: "Empty uses the gateway's default external network.", suggest: (refs) => subnetOptions(refs) },
    { name: "v4ip", label: "IPv4 address", mono: true, placeholder: "Allocated automatically" },
    { name: "qosPolicy", label: "QoS policy", suggest: (refs) => names(refs.qosPolicies) },
  ],
  validate: (values) => (values.v4ip && !isIp(values.v4ip) ? "IPv4 address is not valid" : null),
  buildSpec: (values) => compact({ natGwDp: values.natGwDp, externalSubnet: values.externalSubnet, v4ip: values.v4ip, qosPolicy: values.qosPolicy }),
}

const iptablesEipOptions = (refs: NatRefs) => names(refs.iptablesEips, (eip) => [eipAddress(eip), str(spec(eip).natGwDp)].filter(Boolean).join(" · "))

const iptablesSnat: NatKind = {
  plural: "iptables-snat-rules",
  kind: "IptablesSnatRule",
  label: "SNAT rule",
  catalogPath: "/networks/kube-ovn/iptables-snat-rules",
  hasReady: true,
  columns: [
    { key: "eip", header: "Elastic IP", value: (item) => str(spec(item).eip), link: eipLink("iptables-eips") },
    { key: "address", header: "EIP address", value: (item) => str(status(item).v4ip), mono: true },
    { key: "source", header: "Internal CIDR", value: (item) => str(spec(item).internalCIDR), mono: true },
    { key: "gateway", header: "NAT gateway", value: (item) => str(status(item).natGwDp), link: gatewayLink },
  ],
  fields: [
    { name: "eip", label: "Elastic IP", required: true, suggest: iptablesEipOptions },
    { name: "internalCIDR", label: "Internal CIDR", required: true, mono: true, placeholder: "10.0.1.0/24", hint: "Traffic from this range leaves through the EIP.", suggest: (refs) => refs.subnets.map((subnet) => ({ value: str(spec(subnet).cidrBlock), hint: subnet.metadata.name })).filter((option) => option.value) },
  ],
  validate: (values) => (csv(values.internalCIDR).every((item) => isCidr(item) || isIp(item)) ? null : "Internal CIDR is not valid"),
  buildSpec: (values) => ({ eip: values.eip, internalCIDR: values.internalCIDR }),
}

const iptablesDnat: NatKind = {
  plural: "iptables-dnat-rules",
  kind: "IptablesDnatRule",
  label: "DNAT rule",
  catalogPath: "/networks/kube-ovn/iptables-dnat-rules",
  hasReady: true,
  columns: [
    { key: "eip", header: "Elastic IP", value: (item) => str(spec(item).eip), link: eipLink("iptables-eips") },
    { key: "address", header: "EIP address", value: (item) => str(status(item).v4ip), mono: true },
    { key: "protocol", header: "Protocol", value: (item) => str(spec(item).protocol) },
    { key: "external", header: "External port", value: (item) => str(spec(item).externalPort), mono: true },
    { key: "internal", header: "Internal IP", value: (item) => str(spec(item).internalIp), mono: true },
    { key: "internalport", header: "Internal port", value: (item) => str(spec(item).internalPort), mono: true },
    { key: "gateway", header: "NAT gateway", value: (item) => str(status(item).natGwDp), link: gatewayLink },
  ],
  fields: [
    { name: "eip", label: "Elastic IP", required: true, suggest: iptablesEipOptions },
    { name: "internalIp", label: "Internal IP", required: true, mono: true, placeholder: "10.0.1.10", suggest: internalIpOptions },
    ...portFields(),
  ],
  defaults: { protocol: "tcp" },
  validate: (values) => (isIp(values.internalIp) ? validatePorts(values) : "Internal IP is not valid"),
  buildSpec: (values) => ({ eip: values.eip, protocol: values.protocol, externalPort: values.externalPort, internalIp: values.internalIp, internalPort: values.internalPort }),
}

const iptablesFip: NatKind = {
  plural: "iptables-fip-rules",
  kind: "IptablesFIPRule",
  label: "floating IP",
  catalogPath: "/networks/kube-ovn/iptables-fip-rules",
  hasReady: true,
  columns: [
    { key: "eip", header: "Elastic IP", value: (item) => str(spec(item).eip), link: eipLink("iptables-eips") },
    { key: "address", header: "EIP address", value: (item) => str(status(item).v4ip), mono: true },
    { key: "internal", header: "Internal IP", value: (item) => str(spec(item).internalIp), mono: true },
    { key: "gateway", header: "NAT gateway", value: (item) => str(status(item).natGwDp), link: gatewayLink },
  ],
  fields: [
    { name: "eip", label: "Elastic IP", required: true, suggest: iptablesEipOptions, hint: "One floating IP per EIP; the EIP cannot also carry SNAT or DNAT." },
    { name: "internalIp", label: "Internal IP", required: true, mono: true, placeholder: "10.0.1.10", suggest: internalIpOptions },
  ],
  validate: (values) => (isIp(values.internalIp) ? null : "Internal IP is not valid"),
  buildSpec: (values) => ({ eip: values.eip, internalIp: values.internalIp }),
}

// --- OVN native ---

const ovnEip: NatKind = {
  plural: "ovn-eips",
  kind: "OvnEip",
  label: "elastic IP",
  catalogPath: "/networks/kube-ovn/ovn-eips",
  hasReady: true,
  columns: [
    { key: "ip", header: "IP address", value: eipAddress, mono: true },
    { key: "external", header: "External subnet", value: (item) => str(spec(item).externalSubnet) },
    { key: "type", header: "Type", value: (item) => str(status(item).type) || str(spec(item).type) },
    { key: "used", header: "Used by", value: (item) => str(status(item).nat) },
  ],
  fields: [
    { name: "externalSubnet", label: "External subnet", required: true, hint: "The underlay subnet the address comes from.", suggest: (refs) => subnetOptions(refs) },
    { name: "type", label: "Type", choices: [{ value: "nat", hint: "SNAT, DNAT and floating IPs" }, { value: "lrp", hint: "Router port" }, { value: "lsp", hint: "Switch port" }], required: true },
    { name: "v4Ip", label: "IPv4 address", mono: true, placeholder: "Allocated automatically" },
  ],
  defaults: { type: "nat" },
  validate: (values) => (values.v4Ip && !isIp(values.v4Ip) ? "IPv4 address is not valid" : null),
  buildSpec: (values) => compact({ externalSubnet: values.externalSubnet, type: values.type, v4Ip: values.v4Ip }),
}

const ovnEipOptions = (refs: NatRefs) => names(refs.ovnEips, (eip) => [eipAddress(eip), str(spec(eip).externalSubnet)].filter(Boolean).join(" · "))

/** OVN rules address the internal side by an IP CR name, or by VPC plus IP. */
const ovnTargetFields: NatFormField[] = [
  { name: "ipType", label: "Target type", choices: [{ value: "ip", hint: "Instance or pod IP" }, { value: "vip", hint: "Kube-OVN VIP" }], required: true },
  { name: "ipName", label: "IP name", hint: "Kube-OVN IP object, usually <instance>.<namespace>. Leave empty to use VPC and internal IP.", suggest: ipNameOptions },
  { name: "vpc", label: "VPC", hint: "Only with an internal IP.", suggest: (refs) => names(refs.vpcs) },
  { name: "v4Ip", label: "Internal IP", mono: true, placeholder: "10.0.1.10", suggest: internalIpOptions },
]

const validateTarget = (values: Record<string, string>) => {
  if (values.ipName) return null
  if (!values.v4Ip) return "Enter an IP name, or a VPC and internal IP"
  if (!isIp(values.v4Ip)) return "Internal IP is not valid"
  return values.vpc ? null : "A VPC is required with an internal IP"
}

const ovnTarget = (values: Record<string, string>) =>
  values.ipName ? { ipType: values.ipType, ipName: values.ipName } : { ipType: values.ipType, vpc: values.vpc, v4Ip: values.v4Ip }

const ovnFip: NatKind = {
  plural: "ovn-fips",
  kind: "OvnFip",
  label: "floating IP",
  catalogPath: "/networks/kube-ovn/ovn-fips",
  hasReady: true,
  columns: [
    { key: "eip", header: "Elastic IP", value: (item) => str(spec(item).ovnEip), link: eipLink("ovn-eips") },
    { key: "address", header: "EIP address", value: (item) => str(status(item).v4Eip), mono: true },
    { key: "internal", header: "Internal IP", value: (item) => str(status(item).v4Ip) || str(spec(item).v4Ip), mono: true },
    { key: "ipname", header: "IP name", value: (item) => str(spec(item).ipName) },
    { key: "vpc", header: "VPC", value: (item) => str(status(item).vpc) || str(spec(item).vpc), link: vpcLink },
    { key: "type", header: "Type", value: (item) => str(spec(item).type) },
  ],
  fields: [
    { name: "ovnEip", label: "Elastic IP", required: true, suggest: ovnEipOptions },
    ...ovnTargetFields,
    { name: "type", label: "Mode", choices: [{ value: "centralized", hint: "Through the gateway node" }, { value: "distributed", hint: "On the instance's node" }], required: true },
  ],
  defaults: { ipType: "ip", type: "centralized" },
  validate: validateTarget,
  buildSpec: (values) => ({ ovnEip: values.ovnEip, ...ovnTarget(values), type: values.type }),
}

const ovnSnat: NatKind = {
  plural: "ovn-snat-rules",
  kind: "OvnSnatRule",
  label: "SNAT rule",
  catalogPath: "/networks/kube-ovn/ovn-snat-rules",
  hasReady: true,
  columns: [
    { key: "eip", header: "Elastic IP", value: (item) => str(spec(item).ovnEip), link: eipLink("ovn-eips") },
    { key: "address", header: "EIP address", value: (item) => str(status(item).v4Eip), mono: true },
    { key: "source", header: "Source", value: (item) => str(spec(item).vpcSubnet) || str(spec(item).ipName) || str(status(item).v4IpCidr) },
    { key: "cidr", header: "Internal CIDR", value: (item) => str(status(item).v4IpCidr) || str(spec(item).v4IpCidr), mono: true },
    { key: "vpc", header: "VPC", value: (item) => str(status(item).vpc) || str(spec(item).vpc), link: vpcLink },
  ],
  fields: [
    { name: "ovnEip", label: "Elastic IP", required: true, suggest: ovnEipOptions },
    { name: "vpcSubnet", label: "Subnet", hint: "SNAT the whole subnet. Or leave empty and give an IP name.", suggest: (refs) => subnetOptions(refs) },
    { name: "ipName", label: "IP name", hint: "SNAT a single instance or pod.", suggest: ipNameOptions },
  ],
  validate: (values) => (values.vpcSubnet || values.ipName ? null : "Enter a subnet or an IP name"),
  buildSpec: (values) => compact({ ovnEip: values.ovnEip, vpcSubnet: values.vpcSubnet, ipName: values.vpcSubnet ? "" : values.ipName }),
}

const ovnDnat: NatKind = {
  plural: "ovn-dnat-rules",
  kind: "OvnDnatRule",
  label: "DNAT rule",
  catalogPath: "/networks/kube-ovn/ovn-dnat-rules",
  hasReady: true,
  columns: [
    { key: "eip", header: "Elastic IP", value: (item) => str(spec(item).ovnEip), link: eipLink("ovn-eips") },
    { key: "address", header: "EIP address", value: (item) => str(status(item).v4Eip), mono: true },
    { key: "protocol", header: "Protocol", value: (item) => str(spec(item).protocol) || str(status(item).protocol) },
    { key: "external", header: "External port", value: (item) => str(spec(item).externalPort), mono: true },
    { key: "internal", header: "Internal IP", value: (item) => str(status(item).v4Ip) || str(spec(item).v4Ip), mono: true },
    { key: "internalport", header: "Internal port", value: (item) => str(spec(item).internalPort), mono: true },
    { key: "ipname", header: "IP name", value: (item) => str(spec(item).ipName) },
  ],
  fields: [
    { name: "ovnEip", label: "Elastic IP", required: true, suggest: ovnEipOptions },
    ...ovnTargetFields,
    ...portFields(),
  ],
  defaults: { ipType: "ip", protocol: "tcp" },
  validate: (values) => validateTarget(values) || validatePorts(values),
  buildSpec: (values) => ({ ovnEip: values.ovnEip, ...ovnTarget(values), protocol: values.protocol, externalPort: values.externalPort, internalPort: values.internalPort }),
}

export const natKinds: Record<NatEngine, Partial<Record<NatTab, NatKind>>> = {
  iptables: { gateways: gateway, eips: iptablesEip, snat: iptablesSnat, dnat: iptablesDnat, fip: iptablesFip },
  ovn: { eips: ovnEip, snat: ovnSnat, dnat: ovnDnat, fip: ovnFip },
}

export const natEngineLabel: Record<NatEngine, string> = {
  iptables: "VPC NAT gateway",
  ovn: "OVN native",
}

export const natManifest = (kind: NatKind, name: string, values: Record<string, string>) => ({
  apiVersion: "kubeovn.io/v1",
  kind: kind.kind,
  metadata: { name },
  spec: kind.buildSpec(values),
})
