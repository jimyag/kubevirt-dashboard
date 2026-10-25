import type { ComponentType } from "react"
import {
  Activity,
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  Bell,
  Bookmark,
  Boxes,
  Cable,
  ClipboardList,
  CloudDownload,
  Container,
  FileKey,
  FolderCog,
  Gauge,
  History,
  Layers3,
  LockKeyhole,
  PackageCheck,
  PackageSearch,
  Signpost,
  Ungroup,
  Camera,
  Cpu,
  Database,
  Disc3,
  Globe,
  HardDrive,
  Image,
  LayoutDashboard,
  Layers,
  ListChecks,
  ListTree,
  Network,
  Package,
  Route,
  Scale,
  Server,
  Settings,
  Shield,
  ShieldCheck,
  Split,
  Waypoints,
} from "lucide-react"

import { dvCreateConfig, resourceConfigs, vmCreateConfig } from "@/resources/configs"
import { apiVersionFromListPath, expandListPaths, resourceNameFromListPath } from "@/resources/api-paths"
import type { ResourceConfig } from "@/components/resource-management"
import { useDiscovery, useNetworkProfile, type Discovery, type NetworkProfile } from "./kube"
import { resourceLabel, t } from "./i18n"

export type NavItem = {
  name: string
  /** For a group, the first visible child's path (used when the sidebar is collapsed to icons). */
  path: string
  icon: ComponentType<{ className?: string }>
  /** Extra path prefixes that should highlight this entry. */
  match?: string[]
  /** API that must be served for the entry to show. */
  requires?: [groupVersion: string, resource: string]
  visible?: (profile: NetworkProfile) => boolean
  /** Nested pages; makes this entry a collapsible group in the sidebar. */
  children?: NavItem[]
}

export type SectionTone = "home" | "compute" | "storage" | "network" | "security" | "platform"

export type NavSection = { label: string; tone: SectionTone; items: NavItem[] }

type NavGroupKey = "calico" | "cilium" | "kube-ovn"
type DiscoveredNavResource = Discovery["resources"][number]

const resourcePage = ({ path, title }: ResourceConfig): NavItem => ({ name: title, path, icon: Boxes })

const resourcePages = [...Object.values(resourceConfigs), vmCreateConfig, dvCreateConfig]
const resourcesByPath = new Map<string, ResourceConfig>()
for (const config of resourcePages) {
  if (!resourcesByPath.has(config.path)) resourcesByPath.set(config.path, config)
}

const discoveredPage = ({ kind, name, apiVersion }: DiscoveredNavResource): NavItem => ({
  name: kind,
  path: `/catalog/crds/${apiVersion.split("/")[0]}/${name}`,
  icon: Boxes,
})

const envoyChildren = (discovery: Discovery): NavItem[] => {
  const resources = new Map<string, DiscoveredNavResource>()
  for (const resource of discovery.resources) {
    if (resource.apiVersion.split("/")[0] !== "gateway.envoyproxy.io") continue
    const existing = resources.get(resource.name)
    if (!existing || resource.apiVersion.localeCompare(existing.apiVersion) < 0) resources.set(resource.name, resource)
  }
  return [...resources.values()].map(discoveredPage).sort((a, b) => a.name.localeCompare(b.name))
}

const extensionNavGroups = {
  calico: {
    "Policy": ["calicoNetworkPolicies", "calicoGlobalNetworkPolicies", "calicoStagedNetworkPolicies", "calicoStagedGlobalNetworkPolicies", "calicoStagedKubernetesNetworkPolicies", "calicoNetworkSets", "calicoGlobalNetworkSets", "calicoTiers"],
    "BGP": ["calicoBGPConfigurations", "calicoBGPPeers", "calicoBGPFilters"],
    "IPAM": ["calicoIPPools", "calicoIPReservations", "calicoBlockAffinities", "calicoIPAMBlocks", "calicoIPAMConfigs", "calicoIPAMHandles"],
    "Runtime": ["calicoHostEndpoints", "calicoFelixConfigurations", "calicoKubeControllersConfigurations", "calicoClusterInformations", "calicoCalicoNodeStatuses"],
  },
  cilium: {
    "Policy & security": ["ciliumNetworkPolicies", "ciliumClusterwideNetworkPolicies", "ciliumCIDRGroups", "ciliumLocalRedirectPolicies"],
    "Endpoints & nodes": ["ciliumNodes", "ciliumEndpoints", "ciliumEndpointSlices", "ciliumIdentities"],
    "Traffic & routing": ["ciliumEgressGatewayPolicies", "ciliumLoadBalancerIPPools", "ciliumPodIPPools", "ciliumL2AnnouncementPolicies", "ciliumEnvoyConfigs", "ciliumClusterwideEnvoyConfigs", "ciliumGatewayClassConfigs"],
    "BGP": ["ciliumBGPAdvertisements", "ciliumBGPClusterConfigs", "ciliumBGPNodeConfigs", "ciliumBGPNodeConfigOverrides", "ciliumBGPPeerConfigs"],
    "Configuration": ["ciliumNodeConfigs", "ciliumDatapathPlugins"],
  },
  "kube-ovn": {
    "Networking": ["kubeOvnVpcs", "kubeOvnSubnets", "kubeOvnProviderNetworks", "kubeOvnVlans"],
    "IPAM": ["kubeOvnIPPools", "kubeOvnIPs", "kubeOvnVips"],
    "NAT & gateway": ["kubeOvnVpcNatGateways", "kubeOvnIptablesEips", "kubeOvnIptablesDnatRules", "kubeOvnIptablesSnatRules", "kubeOvnIptablesFIPRules", "kubeOvnOvnEips", "kubeOvnOvnDnatRules", "kubeOvnOvnSnatRules", "kubeOvnOvnFips", "kubeOvnSwitchLBRules", "kubeOvnVpcEgressGateways"],
    "Policy & DNS": ["kubeOvnSecurityGroups", "kubeOvnQoSPolicies", "kubeOvnVpcDnses", "kubeOvnDNSNameResolvers"],
    "Routing": ["kubeOvnBgpConfs", "kubeOvnEvpnConfs"],
  },
} satisfies Record<NavGroupKey, Record<string, string[]>>

const extensionChildren = (slug: NavGroupKey, discovery?: Discovery): NavItem[] => {
  return Object.entries(extensionNavGroups[slug]).flatMap(([name, keys]) => {
    const children = keys.flatMap((key) => {
      const config = resourceConfigs[key]
      if (!config) return []
      if (discovery?.loaded) {
        const served = expandListPaths(config).some((path) =>
          discovery.hasResource(apiVersionFromListPath(path), resourceNameFromListPath(path, config.id)))
        if (!served) return []
      }
      return [resourcePage(config)]
    })
    return children.length > 1
      ? [{ name, path: children[0].path, icon: Boxes, children }]
      : children
  })
}

/**
 * Per-section accent classes, backed by the --tone-* tokens in index.css. Each console area keeps
 * one hue across the sidebar icon, header breadcrumb, page title icon and overview metrics.
 */
export const toneClasses: Record<SectionTone, { text: string; bg: string; dot: string; soft: string }> = {
  home: { text: "text-tone-home", bg: "bg-tone-home", dot: "bg-tone-home", soft: "bg-tone-home/12" },
  compute: { text: "text-tone-compute", bg: "bg-tone-compute", dot: "bg-tone-compute", soft: "bg-tone-compute/12" },
  storage: { text: "text-tone-storage", bg: "bg-tone-storage", dot: "bg-tone-storage", soft: "bg-tone-storage/12" },
  network: { text: "text-tone-network", bg: "bg-tone-network", dot: "bg-tone-network", soft: "bg-tone-network/12" },
  security: { text: "text-tone-security", bg: "bg-tone-security", dot: "bg-tone-security", soft: "bg-tone-security/12" },
  platform: { text: "text-tone-platform", bg: "bg-tone-platform", dot: "bg-tone-platform", soft: "bg-tone-platform/12" },
}

export const navSections: NavSection[] = [
  {
    label: "Home",
    tone: "home",
    items: [
      { name: "Overview", path: "/", icon: LayoutDashboard },
      { name: "Events", path: "/events", icon: Bell },
    ],
  },
  {
    label: "Virtual Machines",
    tone: "compute",
    items: [
      {
        name: "Instances & runtime",
        path: "",
        icon: Cpu,
        children: [
          { name: "Instances", path: "/kubevirt/virtualization/virtual-machines", icon: Cpu },
          { name: "Running instances", path: "/kubevirt/virtualization/virtual-machine-instances", icon: Activity, requires: ["kubevirt.io/v1", "virtualmachineinstances"] },
          { name: "Instance Pools", path: "/kubevirt/virtualization/vm-pools", icon: Boxes, requires: ["pool.kubevirt.io/v1beta1", "virtualmachinepools"] },
          { name: "Instance ReplicaSets", path: "/kubevirt/virtualization/vmi-replica-sets", icon: Layers3, requires: ["kubevirt.io/v1", "virtualmachineinstancereplicasets"] },
          { name: "Migrations", path: "/kubevirt/operations/migrations", icon: Route, requires: ["kubevirt.io/v1", "virtualmachineinstancemigrations"] },
        ],
      },
      {
        name: "Images & disks",
        path: "",
        icon: Image,
        children: [
          { name: "Images", path: "/kubevirt/cdi/data-sources", icon: Image, requires: ["cdi.kubevirt.io/v1beta1", "datasources"] },
          { name: "Disks", path: "/kubevirt/cdi/data-volumes", icon: HardDrive, requires: ["cdi.kubevirt.io/v1beta1", "datavolumes"] },
          { name: "Scheduled imports", path: "/kubevirt/cdi/data-import-crons", icon: CloudDownload, requires: ["cdi.kubevirt.io/v1beta1", "dataimportcrons"] },
        ],
      },
      {
        name: "Snapshots & restores",
        path: "",
        icon: History,
        children: [
          { name: "Snapshots", path: "/kubevirt/snapshots/snapshots", icon: Camera, requires: ["snapshot.kubevirt.io/v1beta1", "virtualmachinesnapshots"] },
          { name: "Restores", path: "/kubevirt/snapshots/restores", icon: History, requires: ["snapshot.kubevirt.io/v1beta1", "virtualmachinerestores"] },
          { name: "Snapshot contents", path: "/kubevirt/snapshots/snapshot-contents", icon: Layers, requires: ["snapshot.kubevirt.io/v1beta1", "virtualmachinesnapshotcontents"] },
        ],
      },
      {
        name: "Instance specs",
        path: "",
        icon: Gauge,
        children: [
          { name: "Instance Types", path: "/kubevirt/templates/instance-types", icon: Gauge, match: ["/kubevirt/templates/cluster-instance-types"], requires: ["instancetype.kubevirt.io/v1beta1", "virtualmachineclusterinstancetypes"] },
          { name: "Preferences", path: "/kubevirt/templates/preferences", icon: FolderCog, match: ["/kubevirt/templates/cluster-preferences"], requires: ["instancetype.kubevirt.io/v1beta1", "virtualmachineclusterpreferences"] },
        ],
      },
      { name: "SSH Keys", path: "/kubevirt/operations/ssh-keys", icon: FileKey, requires: ["v1", "secrets"] },
      {
        name: "Advanced",
        path: "",
        icon: Settings,
        children: [
          { name: "KubeVirt", path: "/kubevirt/operations/kubevirts", icon: Cpu, requires: ["kubevirt.io/v1", "kubevirts"] },
          { name: "Storage profiles", path: "/kubevirt/cdi/storage-profiles", icon: Disc3, requires: ["cdi.kubevirt.io/v1beta1", "storageprofiles"] },
          { name: "Import sources", path: "/kubevirt/cdi/volume-import-sources", icon: CloudDownload, requires: ["cdi.kubevirt.io/v1beta1", "volumeimportsources"] },
          { name: "Upload sources", path: "/kubevirt/cdi/volume-upload-sources", icon: ArrowUpFromLine, requires: ["cdi.kubevirt.io/v1beta1", "volumeuploadsources"] },
          { name: "Clone sources", path: "/kubevirt/cdi/volume-clone-sources", icon: ArrowLeftRight, requires: ["cdi.kubevirt.io/v1beta1", "volumeclonesources"] },
          { name: "Object transfers", path: "/kubevirt/cdi/object-transfers", icon: ArrowLeftRight, requires: ["cdi.kubevirt.io/v1beta1", "objecttransfers"] },
        ],
      },
    ],
  },
  {
    label: "Workloads",
    tone: "compute",
    items: [
      { name: "Pods", path: "/kubernetes/workloads/pods", icon: Container },
      { name: "Deployments", path: "/kubernetes/workloads/deployments", icon: Layers3 },
      { name: "StatefulSets", path: "/kubernetes/workloads/statefulsets", icon: Database },
      { name: "DaemonSets", path: "/kubernetes/workloads/daemonsets", icon: Server },
      {
        name: "Batch",
        path: "",
        icon: ClipboardList,
        children: [
          { name: "Jobs", path: "/kubernetes/workloads/jobs", icon: ClipboardList },
          { name: "CronJobs", path: "/kubernetes/workloads/cronjobs", icon: History },
        ],
      },
      { name: "Autoscaling", path: "/kubernetes/workloads/autoscaling", icon: Gauge, match: ["/kubevirt/operations/autoscaling"], requires: ["autoscaling/v2", "horizontalpodautoscalers"] },
      {
        name: "Advanced resources",
        path: "",
        icon: ListTree,
        children: [
          { name: "ReplicaSets", path: "/kubernetes/workloads/replicasets", icon: Layers3 },
          { name: "Replication Controllers", path: "/kubernetes/workloads/replication-controllers", icon: Layers3 },
          { name: "Pod Templates", path: "/kubernetes/workloads/pod-templates", icon: Layers },
          { name: "Controller Revisions", path: "/kubernetes/workloads/controller-revisions", icon: History },
        ],
      },
    ],
  },
  {
    label: "Applications",
    tone: "platform",
    items: [
      { name: "Application Catalog", path: "/applications/catalog", icon: PackageSearch },
      { name: "Installed Applications", path: "/applications/installed", icon: PackageCheck, match: ["/catalog/helm"] },
      { name: "Application Repositories", path: "/applications/repositories", icon: Package },
    ],
  },
  {
    label: "Storage",
    tone: "storage",
    items: [
      { name: "PersistentVolumeClaims", path: "/storage/kubernetes/persistent-volume-claims", icon: Database },
      { name: "PersistentVolumes", path: "/storage/kubernetes/persistent-volumes", icon: HardDrive },
      {
        name: "Storage configuration",
        path: "",
        icon: Settings,
        children: [
          { name: "StorageClasses", path: "/storage/kubernetes/storage-classes", icon: Disc3 },
          { name: "Volume Attributes Classes", path: "/storage/kubernetes/volume-attributes-classes", icon: Layers },
        ],
      },
      {
        name: "Volume snapshots",
        path: "",
        icon: Camera,
        children: [
          { name: "Volume Snapshots", path: "/storage/kubernetes/volume-snapshots", icon: Camera, requires: ["snapshot.storage.k8s.io/v1", "volumesnapshots"] },
          { name: "Volume Snapshot Contents", path: "/storage/kubernetes/volume-snapshot-contents", icon: Layers, requires: ["snapshot.storage.k8s.io/v1", "volumesnapshotcontents"] },
          { name: "Volume Snapshot Classes", path: "/storage/kubernetes/volume-snapshot-classes", icon: Disc3, requires: ["snapshot.storage.k8s.io/v1", "volumesnapshotclasses"] },
        ],
      },
      {
        name: "CSI",
        path: "",
        icon: Database,
        children: [
          { name: "CSI Drivers", path: "/storage/kubernetes/csi-drivers", icon: Database },
          { name: "CSI Nodes", path: "/storage/kubernetes/csi-nodes", icon: Server },
          { name: "CSI Storage Capacities", path: "/storage/kubernetes/csi-storage-capacities", icon: Layers },
          { name: "Volume Attachments", path: "/storage/kubernetes/volume-attachments", icon: HardDrive },
        ],
      },
    ],
  },
  {
    label: "Networking",
    tone: "network",
    items: [
      {
        name: "Services & discovery",
        path: "",
        icon: Network,
        children: [
          { name: "Services", path: "/networks/kubernetes/services", icon: Network },
          { name: "EndpointSlices", path: "/networks/kubernetes/endpoint-slices", icon: Split },
          { name: "Endpoints", path: "/networks/kubernetes/endpoints", icon: Waypoints },
        ],
      },
      {
        name: "Ingress & routing",
        path: "",
        icon: Signpost,
        children: [
          { name: "Ingresses", path: "/networks/kubernetes/ingresses", icon: Signpost },
          { name: "IngressClasses", path: "/networks/kubernetes/ingress-classes", icon: Layers },
          { name: "Gateways", path: "/networks/gateway-api/gateways", icon: Route },
          { name: "GatewayClasses", path: "/networks/gateway-api/gateway-classes", icon: Layers },
          { name: "HTTPRoutes", path: "/networks/gateway-api/http-routes", icon: Waypoints },
        ],
      },
      {
        name: "Virtual private cloud",
        path: "",
        icon: Network,
        visible: (p) => p.vpc,
        children: [
          { name: "VPCs", path: "/vpc/vpcs", icon: Network },
          { name: "Subnets", path: "/vpc/subnets", icon: Split },
          { name: "Route Tables", path: "/vpc/route-tables", icon: Signpost },
          { name: "Peering Connections", path: "/vpc/peering-connections", icon: Cable },
          { name: "Reserved IPs", path: "/vpc/reserved-ips", icon: Bookmark, match: ["/networks/kube-ovn/vips"] },
          { name: "IP Pools", path: "/vpc/ip-pools", icon: Layers3, match: ["/networks/kube-ovn/ip-pools"] },
        ],
      },
      {
        name: "Public IP & NAT",
        path: "",
        icon: Globe,
        visible: (p) => p.vpc,
        children: [
          { name: "Elastic IPs", path: "/vpc/elastic-ips", icon: Globe, match: ["/networks/kube-ovn/iptables-eips", "/networks/kube-ovn/ovn-eips"] },
          { name: "NAT Gateways", path: "/vpc/nat-gateways", icon: Waypoints, match: ["/networks/kube-ovn/vpc-nat-gateways"] },
          { name: "SNAT Rules", path: "/vpc/nat/snat-rules", icon: ArrowUpFromLine, match: ["/networks/kube-ovn/iptables-snat-rules", "/networks/kube-ovn/ovn-snat-rules"] },
          { name: "DNAT Rules", path: "/vpc/nat/dnat-rules", icon: ArrowDownToLine, match: ["/networks/kube-ovn/iptables-dnat-rules", "/networks/kube-ovn/ovn-dnat-rules"] },
          { name: "Floating IPs", path: "/vpc/nat/floating-ips", icon: ArrowLeftRight, match: ["/networks/kube-ovn/iptables-fip-rules", "/networks/kube-ovn/ovn-fips"] },
        ],
      },
      {
        name: "Network policies",
        path: "",
        icon: Shield,
        children: [
          { name: "Network Policies", path: "/networks/kubernetes/network-policies", icon: Shield, match: ["/networks/cilium/network-policies", "/networks/cilium/clusterwide-network-policies"] },
          { name: "Security Groups", path: "/vpc/security-groups", icon: ShieldCheck, visible: (p) => p.acl !== "networkpolicy" },
          { name: "Address Groups", path: "/vpc/address-groups", icon: ListTree, match: ["/networks/cilium/cidr-groups"], requires: ["cilium.io/v2", "ciliumcidrgroups"], visible: (p) => p.aclEngines.includes("cilium") },
        ],
      },
      { name: "Multus Networks", path: "/networks/kubernetes/nads", icon: Ungroup, requires: ["k8s.cni.cncf.io/v1", "network-attachment-definitions"] },
      {
        name: "Network extensions",
        path: "",
        icon: Boxes,
        children: [
          { name: "Calico", path: "/networks/calico", icon: Network, children: extensionChildren("calico") },
          { name: "Cilium", path: "/networks/cilium", icon: Network, children: extensionChildren("cilium") },
          { name: "Kube-OVN", path: "/networks/kube-ovn", icon: Network, children: extensionChildren("kube-ovn") },
          { name: "Envoy Gateway", path: "/networks/envoy-gateway", icon: Route },
        ],
      },
    ],
  },
  {
    label: "Configuration & Security",
    tone: "security",
    items: [
      { name: "ConfigMaps", path: "/kubernetes/config/configmaps", icon: FileKey },
      { name: "Secrets", path: "/kubernetes/config/secrets", icon: LockKeyhole },
      {
        name: "Identity & access",
        path: "",
        icon: LockKeyhole,
        children: [
          { name: "Service Accounts", path: "/kubernetes/security/serviceaccounts", icon: LockKeyhole },
          { name: "Roles", path: "/kubernetes/security/roles", icon: LockKeyhole },
          { name: "Role Bindings", path: "/kubernetes/security/rolebindings", icon: LockKeyhole },
          { name: "Cluster Roles", path: "/kubernetes/security/clusterroles", icon: LockKeyhole },
          { name: "Cluster Role Bindings", path: "/kubernetes/security/clusterrolebindings", icon: LockKeyhole },
        ],
      },
      {
        name: "Resource constraints",
        path: "",
        icon: Scale,
        children: [
          { name: "ResourceQuotas", path: "/kubernetes/policy/resource-quotas", icon: Scale },
          { name: "LimitRanges", path: "/kubernetes/policy/limit-ranges", icon: Scale },
          { name: "Pod Disruption Budgets", path: "/kubernetes/policy/pod-disruption-budgets", icon: Shield },
        ],
      },
      {
        name: "Admission control",
        path: "",
        icon: ShieldCheck,
        children: [
          { name: "Mutating Webhooks", path: "/kubernetes/admission/mutating-webhook-configurations", icon: ShieldCheck },
          { name: "Validating Webhooks", path: "/kubernetes/admission/validating-webhook-configurations", icon: ShieldCheck },
          { name: "Validating Admission Policies", path: "/kubernetes/admission/validating-admission-policies", icon: ShieldCheck },
          { name: "Validating Admission Policy Bindings", path: "/kubernetes/admission/validating-admission-policy-bindings", icon: ShieldCheck },
        ],
      },
      { name: "Certificate Requests", path: "/kubernetes/security/certificate-signing-requests", icon: FileKey },
    ],
  },
  {
    label: "Cluster",
    tone: "platform",
    items: [
      { name: "Nodes", path: "/nodes", icon: Server },
      { name: "Namespaces", path: "/kubernetes/cluster/namespaces", icon: Layers },
      {
        name: "Scheduling & runtime",
        path: "",
        icon: Cpu,
        children: [
          { name: "PriorityClasses", path: "/kubernetes/cluster/priority-classes", icon: Scale },
          { name: "RuntimeClasses", path: "/kubernetes/cluster/runtime-classes", icon: Cpu },
        ],
      },
      {
        name: "API & extensions",
        path: "",
        icon: ListChecks,
        children: [
          { name: "CustomResourceDefinitions", path: "/kubernetes/cluster/custom-resource-definitions", icon: ListTree },
          { name: "Custom resources", path: "/catalog/crds", icon: ListTree },
          { name: "APIServices", path: "/kubernetes/cluster/api-services", icon: Network },
        ],
      },
      {
        name: "API flow control",
        path: "",
        icon: Gauge,
        children: [
          { name: "FlowSchemas", path: "/kubernetes/flow-control/flow-schemas", icon: Gauge },
          { name: "PriorityLevelConfigurations", path: "/kubernetes/flow-control/priority-level-configurations", icon: Gauge },
        ],
      },
      {
        name: "Control plane",
        path: "",
        icon: Server,
        children: [
          { name: "Leases", path: "/kubernetes/cluster/leases", icon: History },
          { name: "ComponentStatuses", path: "/kubernetes/cluster/component-statuses", icon: Activity },
        ],
      },
      { name: "Resource Catalog", path: "/catalog", icon: ListChecks, match: ["/kubernetes", "/kubevirt", "/storage", "/networks"] },
    ],
  },
  {
    label: "Settings",
    tone: "platform",
    items: [
      {
        name: "Console",
        path: "",
        icon: Settings,
        children: [
          { name: "General settings", path: "/settings", icon: Settings },
          { name: "Monitoring", path: "/settings/monitoring", icon: Activity },
        ],
      },
    ],
  },
]

/** Leaf pages use their configured resource title; groups keep their ordinary UI translation. */
export const navItemLabel = (item: NavItem): string => {
  if (item.children) return t(item.name)
  return resourceLabel(resourcesByPath.get(item.path)?.title ?? item.name)
}

export const isNavItemVisible = (item: NavItem, profile: NetworkProfile, discovery: Discovery) => {
  if (item.visible && !item.visible(profile)) return false
  if (item.requires && discovery.loaded) {
    const [groupVersion, resource] = item.requires
    const group = groupVersion.split("/")[0]
    return discovery.hasResource(groupVersion, resource) || (groupVersion !== "v1"
      && ["v1", "v1beta1", "v1alpha1", "v1alpha2", "v1beta2", "v2", "v2alpha1", "v2beta1", "v2beta2"].some((version) => discovery.hasResource(`${group}/${version}`, resource)))
  }
  return true
}


type NavEntry = { section: NavSection; item: NavItem; ancestors: NavItem[]; parent?: NavItem }

const walkPages = (section: NavSection, items: NavItem[], ancestors: NavItem[] = []): NavEntry[] =>
  items.flatMap((item) => item.children
    ? walkPages(section, item.children, [...ancestors, item])
    : [{ section, item, ancestors, parent: ancestors[ancestors.length - 1] }])

/** Every page in the navigation with its full ancestor chain. */
/** Longest-prefix match so specific entries win over generic catalog entries. */
export const findActiveNav = (pathname: string, sections: NavSection[] = navSections): NavEntry | undefined => {
  const allNavItems = sections.flatMap((section) => walkPages(section, section.items))
  if (pathname === "/") return allNavItems[0]
  let best: NavEntry | undefined
  let bestLength = 0
  for (const entry of allNavItems.slice(1)) {
    for (const prefix of [entry.item.path, ...(entry.item.match || [])]) {
      if ((pathname === prefix || pathname.startsWith(`${prefix}/`))
        && (prefix.length > bestLength || (prefix.length === bestLength && prefix === entry.item.path))) {
        best = entry
        bestLength = prefix.length
      }
    }
  }
  return best
}

/** Filter a navigation tree bottom-up; a group with one page is replaced by that page. */
export const filterNavItems = (items: NavItem[], profile: NetworkProfile, discovery: Discovery): NavItem[] =>
  items.flatMap((item): NavItem[] => {
    if (!isNavItemVisible(item, profile, discovery)) return []
    if (!item.children) return [item]
    const children = filterNavItems(item.children, profile, discovery)
    if (item.name === "Network extensions" && children.length === 1) {
      return [{ ...item, path: children[0].path, children }]
    }
    if (children.length <= 1) return children
    return [{ ...item, path: children[0].path, children }]
  })

const extensionSlugs: Record<string, NavGroupKey> = {
  "Calico": "calico",
  "Cilium": "cilium",
  "Kube-OVN": "kube-ovn",
}

const withDiscoveredExtensions = (items: NavItem[], discovery: Discovery): NavItem[] =>
  items.map((item) => {
    if (item.name !== "Network extensions" || !item.children) return item
    return {
      ...item,
      children: item.children.flatMap((child) => {
        if (child.name === "Envoy Gateway") {
          return discovery.loaded ? [{ ...child, children: envoyChildren(discovery) }] : [child]
        }
        const slug = extensionSlugs[child.name]
        return slug ? [{ ...child, children: extensionChildren(slug, discovery) }] : [child]
      }),
    }
  })

export const buildNavSections = (profile: NetworkProfile, discovery: Discovery): NavSection[] =>
  navSections
    .map((section) => ({
      ...section,
      items: filterNavItems(withDiscoveredExtensions(section.items, discovery), profile, discovery),
    }))
    .filter((section) => section.items.length > 0)

/**
 * Navigation filtered by served APIs and the active network stack. A group keeps its visible
 * children; with only one left it becomes that page, and with none it disappears.
 */
export function useNavSections(): NavSection[] {
  const profile = useNetworkProfile()
  const discovery = useDiscovery()
  return buildNavSections(profile, discovery)
}
