import type { ComponentType } from "react"
import {
  Bell,
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

export type SectionTone = "home" | "compute" | "storage" | "network" | "security" | "platform"

export type NavSection = { label: string; tone: SectionTone; items: NavItem[] }

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
    label: "Compute",
    tone: "compute",
    items: [
      { name: "Instances", path: "/kubevirt/virtualization/virtual-machines", icon: Cpu, match: ["/kubevirt/virtualization/virtual-machine-instances"] },
      { name: "Instance Types", path: "/kubevirt/templates/cluster-instance-types", icon: Layers, match: ["/kubevirt/templates"], requires: ["instancetype.kubevirt.io/v1beta1", "virtualmachineclusterinstancetypes"] },
      { name: "Images", path: "/kubevirt/cdi/data-sources", icon: Image, match: ["/kubevirt/cdi/data-import-crons"], requires: ["cdi.kubevirt.io/v1beta1", "datasources"] },
      { name: "Instance Pools", path: "/kubevirt/virtualization/vm-pools", icon: Boxes, requires: ["pool.kubevirt.io/v1beta1", "virtualmachinepools"] },
      { name: "Snapshots", path: "/kubevirt/snapshots/snapshots", icon: Camera, match: ["/kubevirt/snapshots"], requires: ["snapshot.kubevirt.io/v1beta1", "virtualmachinesnapshots"] },
      { name: "Migrations", path: "/kubevirt/operations/migrations", icon: Route },
      { name: "Hosts", path: "/nodes", icon: Server },
    ],
  },
  {
    label: "Storage",
    tone: "storage",
    items: [
      { name: "Disks", path: "/kubevirt/cdi/data-volumes", icon: HardDrive, requires: ["cdi.kubevirt.io/v1beta1", "datavolumes"] },
      { name: "Volumes", path: "/storage/kubernetes/persistent-volume-claims", icon: Database, match: ["/storage/kubernetes/persistent-volumes"] },
      { name: "Storage Classes", path: "/storage/kubernetes/storage-classes", icon: Disc3 },
      { name: "Volume Snapshots", path: "/storage/kubernetes/volume-snapshots", icon: Camera, requires: ["snapshot.storage.k8s.io/v1", "volumesnapshots"] },
    ],
  },
  {
    label: "Networking",
    tone: "network",
    items: [
      { name: "VPCs", path: "/vpc/vpcs", icon: Network, visible: (p) => p.vpc },
      { name: "Subnets", path: "/vpc/subnets", icon: Split, visible: (p) => p.vpc },
      { name: "Elastic IPs", path: "/vpc/elastic-ips", icon: Globe, match: ["/networks/kube-ovn/iptables-eips", "/networks/kube-ovn/ovn-eips"], visible: (p) => p.vpc },
      { name: "NAT Gateways", path: "/vpc/nat-gateways", icon: Waypoints, match: ["/networks/kube-ovn/vpc-nat-gateways", "/networks/kube-ovn/iptables-snat-rules", "/networks/kube-ovn/iptables-dnat-rules", "/networks/kube-ovn/iptables-fip-rules", "/networks/kube-ovn/ovn-snat-rules", "/networks/kube-ovn/ovn-dnat-rules", "/networks/kube-ovn/ovn-fips"], visible: (p) => p.vpc },
      { name: "Load Balancers", path: "/networks/kubernetes/services", icon: Scale },
      { name: "Multus Networks", path: "/networks/kubernetes/nads", icon: Route, requires: ["k8s.cni.cncf.io/v1", "network-attachment-definitions"] },
    ],
  },
  {
    label: "Security",
    tone: "security",
    items: [
      { name: "Security Groups", path: "/vpc/security-groups", icon: ShieldCheck, visible: (p) => p.acl !== "networkpolicy" },
      { name: "Network Policies", path: "/networks/kubernetes/network-policies", icon: Shield, match: ["/networks/cilium/network-policies", "/networks/cilium/clusterwide-network-policies"] },
    ],
  },
  {
    label: "Platform",
    tone: "platform",
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
