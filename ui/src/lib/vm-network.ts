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
export const extraNicSpec = (nics: ExtraNic[]) => ({
  interfaces: nics.map((nic) => ({ name: nic.name, bridge: {} })),
  networks: nics.map((nic) => ({ name: nic.name, multus: { networkName: nic.network.nad } })),
  annotations: Object.fromEntries(nics.filter((nic) => nic.network.provider && nic.network.subnet).map((nic) => [providerSwitchAnnotation(nic.network.provider!), nic.network.subnet!])),
})

/** First free nicN name. */
export const nextNicName = (taken: string[]) => {
  for (let index = 1; ; index++) if (!taken.includes(`nic${index}`)) return `nic${index}`
}

const templateSpec = (vm: KubeObject) => asRecord(asRecord(asRecord(vm.spec).template).spec)
const templateAnnotations = (vm: KubeObject) => asRecord(asRecord(asRecord(asRecord(vm.spec).template).metadata).annotations)

const mergePatch = (url: string, body: unknown) =>
  requestJson(url, { method: "PATCH", headers: { "Content-Type": "application/merge-patch+json" }, body: JSON.stringify(body) })

const vmUrl = (vm: KubeObject) => `${VM_API}/namespaces/${vm.metadata.namespace}/virtualmachines/${vm.metadata.name}`

/** Adds an extra NIC to the VM template. A running instance picks it up after a restart or hotplug. */
export const addVmNic = async (vm: KubeObject, network: AttachableNetwork) => {
  const spec = templateSpec(vm)
  const interfaces = asList(asRecord(asRecord(spec.domain).devices).interfaces)
  const networks = asList(spec.networks)
  const name = nextNicName([...interfaces, ...networks].map((item) => str(item.name)))
  const extra = extraNicSpec([{ name, network }])
  await mergePatch(vmUrl(vm), {
    spec: {
      template: {
        ...(Object.keys(extra.annotations).length ? { metadata: { annotations: extra.annotations } } : {}),
        spec: { domain: { devices: { interfaces: [...interfaces, ...extra.interfaces] } }, networks: [...networks, ...extra.networks] },
      },
    },
  })
}

/** Removes an extra NIC from the VM template, with its subnet annotation when no other NIC uses it. */
export const removeVmNic = async (vm: KubeObject, nicName: string, provider?: string) => {
  const spec = templateSpec(vm)
  const interfaces = asList(asRecord(asRecord(spec.domain).devices).interfaces).filter((item) => str(item.name) !== nicName)
  const networks = asList(spec.networks).filter((item) => str(item.name) !== nicName)
  await mergePatch(vmUrl(vm), {
    spec: {
      template: {
        ...(provider ? { metadata: { annotations: { [providerSwitchAnnotation(provider)]: null } } } : {}),
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
  const annotations = {
    [kubeOvnAnnotations.ingressRate]: bandwidth.ingress.trim() || null,
    [kubeOvnAnnotations.egressRate]: bandwidth.egress.trim() || null,
  }
  await mergePatch(vmUrl(vm), { spec: { template: { metadata: { annotations } } } })
  const namespace = vm.metadata.namespace
  const pods = await listItems(`/api/v1/namespaces/${namespace}/pods?labelSelector=${encodeURIComponent(`vm.kubevirt.io/name=${vm.metadata.name}`)}`)
  await Promise.all(pods.map((pod) => mergePatch(`/api/v1/namespaces/${namespace}/pods/${pod.metadata.name}`, { metadata: { annotations } }).catch(() => null)))
}

export const bandwidthText = (value: string) => (value ? `${value} Mbit/s` : "")

export const bandwidthSummary = (vm: KubeObject) => {
  const bandwidth = vmBandwidth(vm)
  if (!bandwidth.ingress && !bandwidth.egress) return t("Unlimited")
  return t("In {ingress} / out {egress}", { ingress: bandwidthText(bandwidth.ingress) || t("Unlimited"), egress: bandwidthText(bandwidth.egress) || t("Unlimited") })
}
