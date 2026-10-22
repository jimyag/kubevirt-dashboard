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
  Terminal,
  Waypoints,
} from "lucide-react"
import { Link, useLocation } from "react-router-dom"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { useNetworkProfile, useDiscovery, type NetworkProfile, type Discovery } from "@/lib/kube"

type NavItem = {
  name: string
  path: string
  icon: ComponentType<{ className?: string }>
  /** Extra path prefixes that should highlight this entry. */
  match?: string[]
  /** API that must be served for the entry to show. */
  requires?: [groupVersion: string, resource: string]
  visible?: (profile: NetworkProfile) => boolean
}

type NavSection = { label: string; items: NavItem[] }

const sections: NavSection[] = [
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

const isVisible = (item: NavItem, profile: NetworkProfile, discovery: Discovery) => {
  if (item.visible && !item.visible(profile)) return false
  if (item.requires && discovery.loaded) {
    const [groupVersion, resource] = item.requires
    const group = groupVersion.split("/")[0]
    // Accept any served version of the group for the resource.
    return discovery.hasResource(groupVersion, resource) || ["v1", "v1beta1", "v1alpha1", "v1alpha2", "v2"].some((version) => discovery.hasResource(`${group}/${version}`, resource))
  }
  return true
}

const allItems = sections.flatMap((section) => section.items)

/** Longest-prefix match so specific entries win over generic catalog entries. */
const activeItemPath = (pathname: string) => {
  if (pathname === "/") return "/"
  let best = ""
  let bestLength = 0
  for (const item of allItems) {
    for (const prefix of [item.path, ...(item.match || [])]) {
      if ((pathname === prefix || pathname.startsWith(`${prefix}/`)) && prefix.length > bestLength) {
        best = item.path
        bestLength = prefix.length
      }
    }
  }
  return best
}

export function AppSidebar() {
  const location = useLocation()
  const profile = useNetworkProfile()
  const discovery = useDiscovery()
  const active = activeItemPath(location.pathname)

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild className="data-[slot=sidebar-menu-button]:!p-1.5">
              <Link to="/">
                <div className="bg-sidebar-primary p-1.5 rounded-lg">
                  <Terminal className="text-sidebar-primary-foreground h-4 w-4" />
                </div>
                <div className="flex flex-col leading-tight">
                  <span className="text-sm font-semibold">Virt Console</span>
                  <span className="text-xs text-muted-foreground">Private cloud</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={active === "/"}>
                  <Link to="/">
                    <LayoutDashboard />
                    <span>Overview</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {sections.map((section) => {
          const items = section.items.filter((item) => isVisible(item, profile, discovery))
          if (items.length === 0) return null
          return (
            <SidebarGroup key={section.label} className="py-1">
              <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map((item) => (
                    <SidebarMenuItem key={item.path}>
                      <SidebarMenuButton
                        asChild
                        isActive={active === item.path}
                        className="data-[active=true]:bg-primary/10 data-[active=true]:text-primary"
                      >
                        <Link to={item.path}>
                          <item.icon />
                          <span>{item.name}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )
        })}
      </SidebarContent>

      <SidebarFooter>
        <Link to="/settings" className="block rounded-lg border bg-card p-2.5 transition-colors hover:bg-muted/50">
          <div className="text-xs text-muted-foreground">Network stack</div>
          <div className="truncate text-sm font-semibold">{profile.loaded ? profile.label : "Detecting..."}</div>
          <div className="text-xs text-muted-foreground">
            ACL: {profile.acl === "kube-ovn" ? "Kube-OVN security groups" : profile.acl === "cilium" ? "Cilium policies" : "NetworkPolicy"}
          </div>
        </Link>
      </SidebarFooter>
    </Sidebar>
  )
}
