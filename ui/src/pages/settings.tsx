import { Link } from "react-router-dom"
import { CheckCircle2, ChevronRight, Network, Sparkles, XCircle } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { ChoiceCard, PageHeader, Panel } from "@/components/console"
import {
  networkProfiles,
  useDiscovery,
  useNetworkProfile,
  writeProfileOverride,
  type NetworkProfileId,
} from "@/lib/kube"
import { engineResource } from "@/lib/security-groups"

const components: Array<{ name: string; description: string; check: [string, string] }> = [
  { name: "KubeVirt", description: "Virtual machine runtime", check: ["kubevirt.io/v1", "virtualmachines"] },
  { name: "CDI", description: "Disk import, upload and clone", check: ["cdi.kubevirt.io/v1beta1", "datavolumes"] },
  { name: "Instance types", description: "Reusable compute shapes", check: ["instancetype.kubevirt.io/v1beta1", "virtualmachineclusterinstancetypes"] },
  { name: "Kube-OVN", description: "VPCs, subnets, EIPs, NAT, security groups", check: ["kubeovn.io/v1", "subnets"] },
  { name: "Cilium", description: "eBPF networking and network policy", check: ["cilium.io/v2", "ciliumnetworkpolicies"] },
  { name: "Multus", description: "Secondary networks for instances", check: ["k8s.cni.cncf.io/v1", "network-attachment-definitions"] },
  { name: "Volume snapshots", description: "CSI snapshot support", check: ["snapshot.storage.k8s.io/v1", "volumesnapshots"] },
]

const stackOrder: NetworkProfileId[] = ["kube-ovn-cilium", "kube-ovn", "cilium", "pod"]

export function SettingsPage() {
  const profile = useNetworkProfile()
  const discovery = useDiscovery()

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" />

      <Panel title="Network stack" bodyClassName="space-y-4">
          <ChoiceCard
            selected={profile.override === "auto"}
            onClick={() => writeProfileOverride("auto")}
            icon={Sparkles}
            title={<span className="flex items-center gap-2">Auto detect <Badge variant="outline">{networkProfiles[profile.detected].label}</Badge></span>}
            description="Use Kube-OVN for VPCs when installed, and Cilium for security groups when both are installed."
          />
          <div className="grid gap-3 md:grid-cols-2">
            {stackOrder.map((id) => {
              const item = networkProfiles[id]
              const missing = (item.vpc && !profile.kubeOvnInstalled) || (item.acl === "cilium" && !profile.ciliumInstalled) || (item.acl === "kube-ovn" && !profile.kubeOvnInstalled)
              return (
                <ChoiceCard
                  key={id}
                  selected={profile.override === id}
                  onClick={() => writeProfileOverride(id)}
                  icon={Network}
                  title={<span className="flex flex-wrap items-center gap-2">{item.label}{item.recommended && <Badge variant="success">Recommended</Badge>}{missing && profile.loaded && <Badge variant="warning">Not installed</Badge>}</span>}
                  description={item.description}
                />
              )
            })}
          </div>
          <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 text-sm sm:grid-cols-3">
            <div>
              <div className="text-xs text-muted-foreground">Active stack</div>
              <div className="font-semibold">{profile.label}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Instance networking</div>
              <div className="font-semibold">{profile.vpc ? "Kube-OVN VPC and subnet" : "Pod network"}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Security groups</div>
              <div className="font-semibold">
                {profile.aclEngines.length === 0
                  ? "Kubernetes NetworkPolicy"
                  : profile.aclEngines.map((engine, index) => `${engineResource[engine]}${index === 0 && profile.aclEngines.length > 1 ? " (default)" : ""}`).join(" or ")}
              </div>
              {profile.aclEngines.length > 1 && <div className="text-xs text-muted-foreground">Choose the engine per security group and per instance.</div>}
            </div>
          </div>
        </Panel>

      <Panel title="Installed components">
          <div className="grid gap-2 md:grid-cols-2">
            {components.map((component) => {
              const [groupVersion, resource] = component.check
              const installed = discovery.hasResource(groupVersion, resource)
              return (
                <div key={component.name} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                  <div>
                    <div className="text-sm font-medium">{component.name}</div>
                    <div className="text-xs text-muted-foreground">{component.description}</div>
                  </div>
                  {!discovery.loaded ? (
                    <span className="text-xs text-muted-foreground">Checking...</span>
                  ) : installed ? (
                    <span className="flex items-center gap-1 text-sm text-green-600 dark:text-green-400"><CheckCircle2 className="size-4" />Installed</span>
                  ) : (
                    <span className="flex items-center gap-1 text-sm text-muted-foreground"><XCircle className="size-4" />Not found</span>
                  )}
                </div>
              )
            })}
          </div>
        </Panel>
    </div>
  )
}

const catalog = [
  { to: "/kubevirt", title: "KubeVirt", description: "VMs, VMIs, pools, CDI, instance types, snapshots, migrations" },
  { to: "/storage", title: "Storage", description: "StorageClasses, PV/PVC, CSI, volume snapshots" },
  { to: "/networks", title: "Networks", description: "Services, Gateway API, Multus, Calico, Cilium, Kube-OVN" },
  { to: "/kubernetes", title: "Kubernetes", description: "Workloads, config, RBAC, policy, admission, cluster" },
]

export function CatalogPage() {
  return (
    <div className="space-y-5">
      <PageHeader title="Resource Catalog" subtitle="Raw API resources, grouped by provider." />
      <div className="divide-y rounded-lg border bg-card">
        {catalog.map((item) => (
          <Link key={item.to} to={item.to} className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-muted/50">
            <div className="min-w-0">
              <div className="text-sm font-medium">{item.title}</div>
              <div className="text-xs text-muted-foreground">{item.description}</div>
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        ))}
      </div>
    </div>
  )
}
