import type { ComponentType } from "react"
import {
  Boxes,
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
  Network,
  Route,
  Scale,
  Server,
  Settings,
  Shield,
  ShieldCheck,
  Split,
  Waypoints,
} from "lucide-react"

import { useDiscovery, useNetworkProfile, type Discovery, type NetworkProfile } from "./kube"

export type NavItem = {
  name: string
  path: string
  icon: ComponentType<{ className?: string }>
  /** Extra path prefixes that should highlight this entry. */
  match?: string[]
  /** API that must be served for the entry to show. */
  requires?: [groupVersion: string, resource: string]
  visible?: (profile: NetworkProfile) => boolean
}

export type NavSection = { label: string; items: NavItem[] }

export const navSections: NavSection[] = [
  {
    label: "Home",
    items: [{ name: "Overview", path: "/", icon: LayoutDashboard }],
  },
  {
    label: "Compute",
    items: [
      { name: "Instances", path: "/kubevirt/virtualization/virtual-machines", icon: Cpu, match: ["/kubevirt/virtualization/virtual-machine-instances"] },
      { name: "Instance Types", path: "/kubevirt/templates/cluster-instance-types", icon: Layers, match: ["/kubevirt/templates"], requires: ["instancetype.kubevirt.io/v1beta1", "virtualmachineclusterinstancetypes"] },
      { name: "Images", path: "/kubevirt/cdi/data-sources", icon: Image, match: ["/kubevirt/cdi/data-import-crons"], requires: ["cdi.kubevirt.io/v1beta1", "datasources"] },
      { name: "Instance Pools", path: "/kubevirt/virtualization/vm-pools", icon: Boxes, requires: ["pool.kubevirt.io/v1alpha1", "virtualmachinepools"] },
      { name: "Snapshots", path: "/kubevirt/snapshots/snapshots", icon: Camera, match: ["/kubevirt/snapshots"], requires: ["snapshot.kubevirt.io/v1beta1", "virtualmachinesnapshots"] },
      { name: "Migrations", path: "/kubevirt/operations/migrations", icon: Route },
      { name: "Hosts", path: "/nodes", icon: Server },
    ],
  },
  {
    label: "Storage",
    items: [
      { name: "Disks", path: "/kubevirt/cdi/data-volumes", icon: HardDrive, requires: ["cdi.kubevirt.io/v1beta1", "datavolumes"] },
      { name: "Volumes", path: "/storage/kubernetes/persistent-volume-claims", icon: Database, match: ["/storage/kubernetes/persistent-volumes"] },
      { name: "Storage Classes", path: "/storage/kubernetes/storage-classes", icon: Disc3 },
      { name: "Volume Snapshots", path: "/storage/kubernetes/volume-snapshots", icon: Camera, requires: ["snapshot.storage.k8s.io/v1", "volumesnapshots"] },
    ],
  },
  {
    label: "Networking",
    items: [
      { name: "VPCs", path: "/vpc/vpcs", icon: Network, visible: (p) => p.vpc },
      { name: "Subnets", path: "/vpc/subnets", icon: Split, visible: (p) => p.vpc },
      { name: "Elastic IPs", path: "/networks/kube-ovn/ovn-eips", icon: Globe, match: ["/networks/kube-ovn/iptables-eips", "/networks/kube-ovn/ovn-fips", "/networks/kube-ovn/iptables-fip-rules"], visible: (p) => p.vpc },
      { name: "NAT Gateways", path: "/networks/kube-ovn/vpc-nat-gateways", icon: Waypoints, match: ["/networks/kube-ovn/iptables-snat-rules", "/networks/kube-ovn/iptables-dnat-rules", "/networks/kube-ovn/ovn-snat-rules", "/networks/kube-ovn/ovn-dnat-rules"], visible: (p) => p.vpc },
      { name: "Load Balancers", path: "/networks/kubernetes/services", icon: Scale },
      { name: "Multus Networks", path: "/networks/kubernetes/nads", icon: Route, requires: ["k8s.cni.cncf.io/v1", "network-attachment-definitions"] },
    ],
  },
  {
    label: "Security",
    items: [
      { name: "Security Groups", path: "/vpc/security-groups", icon: ShieldCheck, visible: (p) => p.acl !== "networkpolicy" },
      { name: "Network Policies", path: "/networks/kubernetes/network-policies", icon: Shield, match: ["/networks/cilium/network-policies", "/networks/cilium/clusterwide-network-policies"] },
    ],
  },
  {
    label: "Platform",
    items: [
      { name: "Resource Catalog", path: "/catalog", icon: ListChecks, match: ["/kubernetes", "/kubevirt", "/storage", "/networks"] },
      { name: "Settings", path: "/settings", icon: Settings },
    ],
  },
]

export const isNavItemVisible = (item: NavItem, profile: NetworkProfile, discovery: Discovery) => {
  if (item.visible && !item.visible(profile)) return false
  if (item.requires && discovery.loaded) {
    const [groupVersion, resource] = item.requires
    const group = groupVersion.split("/")[0]
    // Accept any served version of the group for the resource.
    return discovery.hasResource(groupVersion, resource) || ["v1", "v1beta1", "v1alpha1", "v1alpha2", "v2"].some((version) => discovery.hasResource(`${group}/${version}`, resource))
  }
  return true
}


const allNavItems = navSections.flatMap((section) => section.items.map((item) => ({ section, item })))

/** Longest-prefix match so specific entries win over generic catalog entries. */
export const findActiveNav = (pathname: string) => {
  if (pathname === "/") return allNavItems[0]
  let best: (typeof allNavItems)[number] | undefined
  let bestLength = 0
  for (const entry of allNavItems.slice(1)) {
    for (const prefix of [entry.item.path, ...(entry.item.match || [])]) {
      if ((pathname === prefix || pathname.startsWith(`${prefix}/`)) && prefix.length > bestLength) {
        best = entry
        bestLength = prefix.length
      }
    }
  }
  return best
}

/** Navigation sections filtered by served APIs and the active network stack. */
export function useNavSections() {
  const profile = useNetworkProfile()
  const discovery = useDiscovery()
  return navSections
    .map((section) => ({ ...section, items: section.items.filter((item) => isNavItemVisible(item, profile, discovery)) }))
    .filter((section) => section.items.length > 0)
}
