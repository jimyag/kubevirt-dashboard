import * as YAML from "js-yaml"

import {
  asList,
  asRecord,
  ciliumSecurityGroupLabel,
  kubeOvnAnnotations,
  str,
  type KubeObject,
  type UnknownRecord,
} from "./kube"
import { t } from "./i18n"

// --- Instance helpers ---

export const vmDetailPath = (vm: KubeObject, tab = "overview") => `/kubevirt/virtualization/virtual-machines/${vm.metadata.namespace}/${vm.metadata.name}/${tab}`

export const vmStatus = (vm: KubeObject) => str(asRecord(vm.status).printableStatus, "Unknown")

export const vmStatusGroup = (status: string) => {
  const lower = status.toLowerCase()
  if (lower === "running") return "running"
  if (lower === "stopped" || lower === "halted") return "stopped"
  if (["error", "crash", "fail", "unschedulable", "pvcnotfound", "datavolumeerror"].some((key) => lower.includes(key))) return "error"
  return "transitioning"
}

const templateSpec = (vm: KubeObject) => asRecord(asRecord(asRecord(vm.spec).template).spec)
const templateMeta = (vm: KubeObject) => asRecord(asRecord(asRecord(vm.spec).template).metadata)

export const vmShape = (vm: KubeObject, instanceTypes: Record<string, { cpu: number; memory: string }> = {}) => {
  const instancetype = asRecord(asRecord(vm.spec).instancetype)
  const typeName = str(instancetype.name)
  if (typeName) {
    const known = instanceTypes[typeName]
    return { label: typeName, detail: known ? `${known.cpu} vCPU / ${known.memory}` : t("Instance type") }
  }
  const domain = asRecord(templateSpec(vm).domain)
  const cpu = asRecord(domain.cpu)
  const vcpus = Number(cpu.cores || 1) * Number(cpu.sockets || 1) * Number(cpu.threads || 1)
  const memory = str(asRecord(domain.memory).guest) || str(asRecord(asRecord(domain.resources).requests).memory, "N/A")
  return { label: `${vcpus} vCPU`, detail: memory }
}

export const vmNetworkLabel = (vm: KubeObject) => {
  const subnet = str(asRecord(templateMeta(vm).annotations)[kubeOvnAnnotations.logicalSwitch])
  if (subnet) return { kind: "subnet" as const, label: subnet }
  const multus = asList(templateSpec(vm).networks).find((network) => network.multus)
  if (multus) return { kind: "multus" as const, label: str(asRecord(multus.multus).networkName) }
  return { kind: "pod" as const, label: t("Pod network") }
}

// --- Create wizard model ---

export type ImageSource = "datasource" | "registry" | "http" | "containerdisk" | "pvc"

export type WizardState = {
  name: string
  namespace: string
  description: string
  startAfterCreate: boolean
  specMode: "instancetype" | "custom"
  instanceType: string
  cpu: number
  memory: string
  imageSource: ImageSource
  dataSource: string
  registryUrl: string
  httpUrl: string
  containerDisk: string
  pvcName: string
  rootSize: string
  storageClass: string
  dataDisks: string[]
  vpc: string
  subnet: string
  fixedIp: string
  binding: "masquerade" | "bridge"
  /** Engine enforcing the selected security groups; chosen per instance on the Kube-OVN + Cilium stack. */
  sgEngine: "kube-ovn" | "cilium" | null
  securityGroups: string[]
  username: string
  password: string
  sshKey: string
}

export const buildVirtualMachine = (state: WizardState, vpcEnabled: boolean) => {
  const aclProvider = state.sgEngine
  const rootDv = `${state.name}-root`
  const dataVolumeTemplates: UnknownRecord[] = []
  const disks: UnknownRecord[] = [{ name: "rootdisk", disk: { bus: "virtio" }, bootOrder: 1 }]
  const volumes: UnknownRecord[] = []
  const storage = (size: string): UnknownRecord => ({
    resources: { requests: { storage: size } },
    ...(state.storageClass ? { storageClassName: state.storageClass } : {}),
  })

  if (state.imageSource === "containerdisk") {
    volumes.push({ name: "rootdisk", containerDisk: { image: state.containerDisk } })
  } else {
    const spec: UnknownRecord = { storage: storage(state.rootSize) }
    if (state.imageSource === "datasource") {
      const [dsNamespace, dsName] = state.dataSource.split("/")
      spec.sourceRef = { kind: "DataSource", name: dsName, namespace: dsNamespace }
    } else if (state.imageSource === "registry") {
      spec.source = { registry: { url: state.registryUrl.startsWith("docker://") ? state.registryUrl : `docker://${state.registryUrl}` } }
    } else if (state.imageSource === "http") {
      spec.source = { http: { url: state.httpUrl } }
    } else {
      spec.source = { pvc: { name: state.pvcName, namespace: state.namespace } }
    }
    dataVolumeTemplates.push({ metadata: { name: rootDv }, spec })
    volumes.push({ name: "rootdisk", dataVolume: { name: rootDv } })
  }

  state.dataDisks.forEach((size, index) => {
    const dvName = `${state.name}-data-${index + 1}`
    dataVolumeTemplates.push({ metadata: { name: dvName }, spec: { source: { blank: {} }, storage: storage(size) } })
    disks.push({ name: `datadisk${index + 1}`, disk: { bus: "virtio" } })
    volumes.push({ name: `datadisk${index + 1}`, dataVolume: { name: dvName } })
  })

  // Serialize with a YAML library: keys, usernames and passwords may contain ":" or "#".
  const sshKeys = state.sshKey.split("\n").map((key) => key.trim()).filter(Boolean)
  const cloudConfig: UnknownRecord = { hostname: state.name }
  if (state.username) cloudConfig.user = state.username
  if (state.password) {
    cloudConfig.password = state.password
    cloudConfig.chpasswd = { expire: false }
    cloudConfig.ssh_pwauth = true
  }
  if (sshKeys.length) cloudConfig.ssh_authorized_keys = sshKeys
  disks.push({ name: "cloudinitdisk", disk: { bus: "virtio" } })
  volumes.push({ name: "cloudinitdisk", cloudInitNoCloud: { userData: `#cloud-config\n${YAML.dump(cloudConfig, { lineWidth: -1 })}` } })

  const templateLabels: Record<string, string> = { "kubevirt.io/domain": state.name, "vm.kubevirt.io/name": state.name }
  const templateAnnotations: Record<string, string> = {}
  if (vpcEnabled && state.subnet) {
    templateAnnotations[kubeOvnAnnotations.logicalSwitch] = state.subnet
    if (state.fixedIp.trim()) templateAnnotations[kubeOvnAnnotations.ipAddress] = state.fixedIp.trim()
  }
  if (state.securityGroups.length && aclProvider === "kube-ovn") {
    templateAnnotations[kubeOvnAnnotations.securityGroups] = state.securityGroups.join(",")
    templateAnnotations[kubeOvnAnnotations.portSecurity] = "true"
  }
  if (state.securityGroups.length && aclProvider === "cilium") {
    state.securityGroups.forEach((group) => { templateLabels[ciliumSecurityGroupLabel(group)] = "true" })
  }

  const domain: UnknownRecord = {
    devices: { disks, interfaces: [{ name: "default", [state.binding]: {} }] },
  }
  if (state.specMode === "custom") {
    domain.cpu = { cores: state.cpu, sockets: 1, threads: 1 }
    domain.resources = { requests: { memory: state.memory } }
  }

  const spec: UnknownRecord = {
    runStrategy: state.startAfterCreate ? "Always" : "Halted",
    ...(state.specMode === "instancetype" && state.instanceType ? { instancetype: { kind: "VirtualMachineClusterInstancetype", name: state.instanceType } } : {}),
    ...(dataVolumeTemplates.length ? { dataVolumeTemplates } : {}),
    template: {
      metadata: { labels: templateLabels, ...(Object.keys(templateAnnotations).length ? { annotations: templateAnnotations } : {}) },
      spec: {
        domain,
        networks: [{ name: "default", pod: {} }],
        volumes,
      },
    },
  }

  return {
    apiVersion: "kubevirt.io/v1",
    kind: "VirtualMachine",
    metadata: {
      name: state.name,
      namespace: state.namespace,
      labels: { app: state.name },
      ...(state.description ? { annotations: { "kubevirt-dashboard.io/description": state.description } } : {}),
    },
    spec,
  }
}
