import {
  asList,
  asRecord,
  kubeOvnAnnotations,
  listItems,
  requestJson,
  str,
  type KubeObject,
  type UnknownRecord,
} from "./kube"
import { t } from "./i18n"

/**
 * Instance networking beyond the primary interface: extra NICs through Multus
 * NetworkAttachmentDefinitions, and Kube-OVN bandwidth limits.
 */

const VM_API = "/apis/kubevirt.io/v1"
export const NAD_API = "/apis/k8s.cni.cncf.io/v1"
export const reservedIpNamespaceAnnotation = "kubevirt-dashboard.io/reserved-ip-namespace"
export const reservedIpNamespace = (vip: KubeObject) => vip.metadata.annotations?.[reservedIpNamespaceAnnotation] ?? str(asRecord(vip.spec).namespace)

export function canUseReservedIp(vip: KubeObject, subnet: string, namespace: string, usedNames: Set<string>): boolean {
  const spec = asRecord(vip.spec)
  const scope = reservedIpNamespace(vip)
  // Namespaced Vip objects create AAP virtual ports, which conflict with a VM's real port.
  return !str(spec.namespace) && !str(spec.type) && str(spec.subnet) === subnet &&
    (!scope || scope === namespace) && !vip.metadata.labels?.["ovn.kubernetes.io/ip_reserved"] && !usedNames.has(vip.metadata.name)
}

/** A network an extra NIC can join: a Kube-OVN subnet behind a NAD, or any other NAD. */
export type AttachableNetwork = {
  /** `<nad namespace>/<nad name>` or `<nad>@<subnet>` for Kube-OVN. */
  value: string
  nad: string
  subnet?: string
  /** Kube-OVN provider of the NAD, e.g. attachnet.default.ovn. */
  provider?: string
  cidr?: string
  cniType: string
}

const nadConfig = (nad: KubeObject): UnknownRecord => {
  try {
    const parsed = JSON.parse(str(asRecord(nad.spec).config, "{}")) as UnknownRecord
    // A conflist keeps the plugin under plugins[0].
    return Array.isArray(parsed.plugins) ? asRecord(parsed.plugins[0]) : parsed
  } catch {
    return {}
  }
}

const nadRef = (nad: KubeObject) => `${nad.metadata.namespace}/${nad.metadata.name}`

/**
 * Networks for extra NICs. A Kube-OVN NAD is only usable through a subnet whose spec.provider
 * names it, so it is offered once per such subnet; other NADs are offered as they are.
 */
export const attachableNetworks = (nads: KubeObject[], subnets: KubeObject[]): AttachableNetwork[] =>
  nads.flatMap((nad): AttachableNetwork[] => {
    const config = nadConfig(nad)
    const cniType = str(config.type, "unknown")
    if (cniType !== "kube-ovn") return [{ value: nadRef(nad), nad: nadRef(nad), cniType }]
    const provider = str(config.provider, `${nad.metadata.name}.${nad.metadata.namespace}.ovn`)
    return subnets
      .filter((subnet) => str(asRecord(subnet.spec).provider) === provider)
      .map((subnet) => ({ value: `${nadRef(nad)}@${subnet.metadata.name}`, nad: nadRef(nad), subnet: subnet.metadata.name, provider, cidr: str(asRecord(subnet.spec).cidrBlock), cniType }))
  })

export const listAttachableNetworks = async (subnets: KubeObject[]) => {
  const nads = await listItems(`${NAD_API}/network-attachment-definitions`).catch(() => [] as KubeObject[])
  return attachableNetworks(nads, subnets)
}

/** Annotation that picks the Kube-OVN subnet of an attachment. */
export const providerSwitchAnnotation = (provider: string) => `${provider}.kubernetes.io/logical_switch`

export type ExtraNic = { name: string; network: AttachableNetwork }

/** Interface, network and template annotations for extra NICs (bridge binding: the only one Multus supports). */
export const extraNicSpec = (nics: ExtraNic[], annotations: UnknownRecord = {}) => ({
  interfaces: nics.map((nic) => ({ name: nic.name, bridge: {} })),
  networks: nics.map((nic) => ({ name: nic.name, multus: { networkName: nic.network.nad } })),
  annotations: Object.fromEntries(nics.filter((nic) => nic.network.provider && nic.network.subnet).flatMap((nic) => [
    [providerSwitchAnnotation(nic.network.provider!), nic.network.subnet!],
    ...[kubeOvnAnnotations.securityGroups, kubeOvnAnnotations.portSecurity, kubeOvnAnnotations.ingressRate, kubeOvnAnnotations.egressRate]
      .flatMap((key) => typeof annotations[key] === "string" ? [[key.replace("ovn.kubernetes.io/", `${nic.network.provider}.kubernetes.io/`), str(annotations[key])]] : []),
  ])),
})

/** First free nicN name. */
export const nextNicName = (taken: string[]) => {
  for (let index = 1; ; index++) if (!taken.includes(`nic${index}`)) return `nic${index}`
}

const templateSpec = (vm: KubeObject) => asRecord(asRecord(asRecord(vm.spec).template).spec)
const templateAnnotations = (vm: KubeObject) => asRecord(asRecord(asRecord(asRecord(vm.spec).template).metadata).annotations)

export const vmSubnets = (vm: KubeObject): string[] => [...new Set(Object.entries(templateAnnotations(vm))
  .filter(([key]) => key.endsWith(".kubernetes.io/logical_switch"))
  .map(([, value]) => str(value)).filter(Boolean))]

export const vmOvnProviders = (vm: KubeObject, nads: KubeObject[], networks = asList(templateSpec(vm).networks)): string[] => {
  const attached = new Set(networks.flatMap((network) => {
    const name = str(asRecord(network.multus).networkName)
    return name ? [name.includes("/") ? name : `${vm.metadata.namespace}/${name}`] : []
  }))
  return [...new Set(["ovn", ...nads.filter((nad) => attached.has(nadRef(nad)) && nadConfig(nad).type === "kube-ovn")
    .map((nad) => str(nadConfig(nad).provider, `${nad.metadata.name}.${nad.metadata.namespace}.ovn`))])]
}

/** Kube-OVN annotations are scoped to the provider of each attached interface. */
export const vmOvnAnnotationPatch = async (vm: KubeObject, values: Record<string, string | null>) => {
  const nads = asList(templateSpec(vm).networks).some((network) => network.multus)
    ? await listItems(`${NAD_API}/network-attachment-definitions`) : []
  return Object.fromEntries(vmOvnProviders(vm, nads).flatMap((provider) =>
    Object.entries(values).map(([key, value]) => [`${provider}.kubernetes.io/${key}`, value])))
}

const mergePatch = (url: string, body: unknown) =>
  requestJson(url, { method: "PATCH", headers: { "Content-Type": "application/merge-patch+json" }, body: JSON.stringify(body) })

const vmUrl = (vm: KubeObject) => `${VM_API}/namespaces/${vm.metadata.namespace}/virtualmachines/${vm.metadata.name}`

/** Adds an extra NIC to the VM template. A running instance picks it up after a restart or hotplug. */
export const addVmNic = async (vm: KubeObject, network: AttachableNetwork) => {
  const spec = templateSpec(vm)
  const interfaces = asList(asRecord(asRecord(spec.domain).devices).interfaces)
  const networks = asList(spec.networks)
  const name = nextNicName([...interfaces, ...networks].map((item) => str(item.name)))
  const extra = extraNicSpec([{ name, network }], templateAnnotations(vm))
  await mergePatch(vmUrl(vm), {
    spec: {
      template: {
        ...(Object.keys(extra.annotations).length ? { metadata: { annotations: extra.annotations } } : {}),
        spec: { domain: { devices: { interfaces: [...interfaces, ...extra.interfaces] } }, networks: [...networks, ...extra.networks] },
      },
    },
  })
}

/** Remove provider settings only after the last interface using that provider is removed. */
export const removeVmNic = async (vm: KubeObject, nicName: string, provider?: string) => {
  const spec = templateSpec(vm)
  const interfaces = asList(asRecord(asRecord(spec.domain).devices).interfaces).filter((item) => str(item.name) !== nicName)
  const networks = asList(spec.networks).filter((item) => str(item.name) !== nicName)
  const nads = provider && networks.some((network) => network.multus) ? await listItems(`${NAD_API}/network-attachment-definitions`) : []
  const annotations = provider && !vmOvnProviders(vm, nads, networks).includes(provider)
    ? Object.fromEntries(Object.keys(templateAnnotations(vm)).filter((key) => key.startsWith(`${provider}.kubernetes.io/`)).map((key) => [key, null]))
    : {}
  await mergePatch(vmUrl(vm), {
    spec: {
      template: {
        ...(Object.keys(annotations).length ? { metadata: { annotations } } : {}),
        spec: { domain: { devices: { interfaces } }, networks },
      },
    },
  })
}

// --- Bandwidth ---

export type Bandwidth = { ingress: string; egress: string }

export const vmBandwidth = (vm: KubeObject): Bandwidth => {
  const annotations = templateAnnotations(vm)
  return { ingress: str(annotations[kubeOvnAnnotations.ingressRate]), egress: str(annotations[kubeOvnAnnotations.egressRate]) }
}

/** Empty means unlimited; otherwise a whole number of Mbit/s. */
export const bandwidthProblem = (value: string) => value.trim() === "" || /^[1-9]\d*$/.test(value.trim()) ? "" : value.trim()

export const bandwidthAnnotations = (bandwidth: Bandwidth): Record<string, string> => ({
  ...(bandwidth.ingress.trim() ? { [kubeOvnAnnotations.ingressRate]: bandwidth.ingress.trim() } : {}),
  ...(bandwidth.egress.trim() ? { [kubeOvnAnnotations.egressRate]: bandwidth.egress.trim() } : {}),
})

/**
 * Sets the bandwidth limits on the VM template (persistent) and on the running virt-launcher pod,
 * where Kube-OVN applies them without a restart.
 */
export const setVmBandwidth = async (vm: KubeObject, bandwidth: Bandwidth) => {
  const annotations = await vmOvnAnnotationPatch(vm, {
    ingress_rate: bandwidth.ingress.trim() || null,
    egress_rate: bandwidth.egress.trim() || null,
  })
  await mergePatch(vmUrl(vm), { spec: { template: { metadata: { annotations } } } })
  const namespace = vm.metadata.namespace
  const pods = await listItems(`/api/v1/namespaces/${namespace}/pods?labelSelector=${encodeURIComponent(`kubevirt.io/domain=${vm.metadata.name}`)}`)
  await Promise.all(pods.map((pod) => mergePatch(`/api/v1/namespaces/${namespace}/pods/${pod.metadata.name}`, { metadata: { annotations } })))
}

export const bandwidthText = (value: string) => (value ? `${value} Mbit/s` : "")

export const bandwidthSummary = (vm: KubeObject) => {
  const bandwidth = vmBandwidth(vm)
  if (!bandwidth.ingress && !bandwidth.egress) return t("Unlimited")
  return t("In {ingress} / out {egress}", { ingress: bandwidthText(bandwidth.ingress) || t("Unlimited"), egress: bandwidthText(bandwidth.egress) || t("Unlimited") })
}
