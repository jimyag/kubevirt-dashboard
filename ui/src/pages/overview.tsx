import { useMemo } from "react"
import { Link } from "react-router-dom"
import {
  AlertTriangle,
  Cpu,
  Database,
  HardDrive,
  Network,
  Plus,
  Server,
  ShieldCheck,
  Split,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { IconBadge, LoadingState, PageHeader, StatTile, StatusDot } from "@/components/console"
import {
  asList,
  asRecord,
  formatGi,
  listItems,
  parseQuantityGi,
  relativeTime,
  str,
  useAsync,
  useNetworkProfile,
  type KubeObject,
} from "@/lib/kube"
import { listSecurityGroups, useSgProvider } from "@/lib/security-groups"
import { vmShape, vmStatus, vmStatusGroup } from "@/lib/instances"

type EventLike = KubeObject & { type?: string; reason?: string; message?: string; lastTimestamp?: string; eventTime?: string; involvedObject?: { kind?: string; name?: string; namespace?: string } }

const statusRows = [
  { id: "running", label: "Running", color: "bg-green-500" },
  { id: "stopped", label: "Stopped", color: "bg-muted-foreground/40" },
  { id: "transitioning", label: "In progress", color: "bg-yellow-500" },
  { id: "error", label: "Error", color: "bg-red-500" },
]

const nodeReady = (node: KubeObject) => asList(asRecord(node.status).conditions).some((condition) => condition.type === "Ready" && condition.status === "True")

export function OverviewPage() {
  const profile = useNetworkProfile()
  const { provider } = useSgProvider()

  const { data, loading } = useAsync(async () => {
    const [vms, vmis, dvs, nodes, kvPods, events, vpcs, subnets, eips] = await Promise.all([
      listItems("/apis/kubevirt.io/v1/virtualmachines"),
      listItems("/apis/kubevirt.io/v1/virtualmachineinstances"),
      listItems("/apis/cdi.kubevirt.io/v1beta1/datavolumes"),
      listItems("/api/v1/nodes"),
      listItems("/api/v1/namespaces/kubevirt/pods"),
      listItems<EventLike>("/api/v1/events"),
      profile.vpc ? listItems("/apis/kubeovn.io/v1/vpcs") : Promise.resolve([]),
      profile.vpc ? listItems("/apis/kubeovn.io/v1/subnets") : Promise.resolve([]),
      profile.vpc ? listItems("/apis/kubeovn.io/v1/ovn-eips") : Promise.resolve([]),
    ])
    const securityGroups = provider ? await listSecurityGroups(provider) : []
    return { vms, vmis, dvs, nodes, kvPods, events, vpcs, subnets, eips, securityGroups }
  }, {
    vms: [] as KubeObject[], vmis: [] as KubeObject[], dvs: [] as KubeObject[], nodes: [] as KubeObject[], kvPods: [] as KubeObject[],
    events: [] as EventLike[], vpcs: [] as KubeObject[], subnets: [] as KubeObject[], eips: [] as KubeObject[], securityGroups: [] as Awaited<ReturnType<typeof listSecurityGroups>>,
  }, [profile.vpc, provider])

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { running: 0, stopped: 0, transitioning: 0, error: 0 }
    data.vms.forEach((vm) => { counts[vmStatusGroup(vmStatus(vm))]++ })
    return counts
  }, [data.vms])

  const allocation = useMemo(() => {
    let vcpu = 0
    let memoryGi = 0
    data.vmis.forEach((vmi) => {
      const domain = asRecord(asRecord(vmi.spec).domain)
      const cpu = asRecord(domain.cpu)
      vcpu += Number(cpu.cores || 1) * Number(cpu.sockets || 1) * Number(cpu.threads || 1)
      memoryGi += parseQuantityGi(asRecord(domain.memory).guest || asRecord(asRecord(domain.resources).requests).memory)
    })
    const capacityCpu = data.nodes.reduce((sum, node) => sum + Number(asRecord(asRecord(node.status).allocatable).cpu || 0), 0)
    const capacityMemory = data.nodes.reduce((sum, node) => sum + parseQuantityGi(asRecord(asRecord(node.status).allocatable).memory), 0)
    return { vcpu, memoryGi, capacityCpu, capacityMemory }
  }, [data.vmis, data.nodes])

  const diskGi = data.dvs.reduce((sum, dv) => {
    const spec = asRecord(dv.spec)
    return sum + parseQuantityGi(asRecord(asRecord(asRecord(spec.storage || spec.pvc).resources).requests).storage)
  }, 0)

  const infra = ["virt-api", "virt-controller", "virt-handler", "virt-operator"].map((component) => {
    const pods = data.kvPods.filter((pod) => pod.metadata.name.startsWith(component))
    return { component, total: pods.length, healthy: pods.length > 0 && pods.every((pod) => str(asRecord(pod.status).phase) === "Running") }
  })

  const warnings = data.events
    .filter((event) => event.type === "Warning")
    .sort((a, b) => new Date(b.lastTimestamp || b.eventTime || 0).getTime() - new Date(a.lastTimestamp || a.eventTime || 0).getTime())
    .slice(0, 8)

  const readyNodes = data.nodes.filter(nodeReady).length

  if (loading && data.nodes.length === 0) return <LoadingState label="Loading overview..." />

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader
        title="Overview"
        subtitle="Compute, storage and network resources of this cluster"
        actions={
          <>
            <Button asChild variant="outline" className="gap-1.5"><Link to="/kubevirt/cdi/data-volumes"><HardDrive className="size-4" />Disks</Link></Button>
            <Button asChild className="gap-1.5"><Link to="/kubevirt/virtualization/virtual-machines/create"><Plus className="size-4" />Create instance</Link></Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile icon={Server} color="blue" label="Hosts" value={data.nodes.length} hint={`${readyNodes} ready`} to="/nodes" />
        <StatTile icon={Cpu} color="green" label="Instances" value={data.vms.length} hint={`${statusCounts.running} running`} to="/kubevirt/virtualization/virtual-machines" />
        <StatTile icon={Database} color="purple" label="Disks" value={formatGi(diskGi)} hint={`${data.dvs.length} disks`} to="/kubevirt/cdi/data-volumes" />
        {profile.vpc ? (
          <StatTile icon={Network} color="cyan" label="VPCs" value={data.vpcs.length} hint={`${data.subnets.length} subnets`} to="/vpc/vpcs" />
        ) : (
          <StatTile icon={ShieldCheck} color="orange" label="Platform" value={infra.every((item) => item.healthy) ? "Healthy" : "Degraded"} hint="KubeVirt components" />
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Instance status</CardTitle>
            <CardDescription>{data.vms.length} instances in all namespaces</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
              {statusRows.map((row) => statusCounts[row.id] > 0 && (
                <div key={row.id} className={row.color} style={{ width: `${(statusCounts[row.id] / Math.max(1, data.vms.length)) * 100}%` }} />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {statusRows.map((row) => (
                <div key={row.id} className="flex items-center justify-between rounded-lg border p-2.5">
                  <span className="flex items-center gap-2 text-sm"><span className={cn("size-2 rounded-full", row.color)} />{row.label}</span>
                  <span className="text-sm font-semibold tabular-nums">{statusCounts[row.id]}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Allocated capacity</CardTitle>
            <CardDescription>Running instances against host allocatable resources</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              { label: "vCPU", used: allocation.vcpu, total: allocation.capacityCpu, format: (value: number) => `${value}` },
              { label: "Memory", used: allocation.memoryGi, total: allocation.capacityMemory, format: (value: number) => formatGi(Math.round(value)) },
            ].map((item) => {
              const ratio = item.total > 0 ? Math.min(1, item.used / item.total) : 0
              return (
                <div key={item.label} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{item.label}</span>
                    <span className="text-muted-foreground tabular-nums">{item.format(item.used)} / {item.format(item.total)}</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div className={cn("h-full rounded-full", ratio > 0.9 ? "bg-red-500" : ratio > 0.7 ? "bg-yellow-500" : "bg-primary")} style={{ width: `${ratio * 100}%` }} />
                  </div>
                </div>
              )
            })}
            <div className="flex flex-wrap gap-2 pt-1">
              {infra.map((item) => (
                <Badge key={item.component} variant={item.healthy ? "success" : item.total === 0 ? "outline" : "danger"}>{item.component}{item.total ? ` ${item.total}` : ""}</Badge>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle className="text-base">Network and security</CardTitle>
                <CardDescription>{profile.label}</CardDescription>
              </div>
              <Button asChild size="sm" variant="ghost"><Link to="/settings">Change</Link></Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {[
              ...(profile.vpc ? [
                { icon: Network, label: "VPCs", value: data.vpcs.length, to: "/vpc/vpcs" },
                { icon: Split, label: "Subnets", value: data.subnets.length, to: "/vpc/subnets" },
                { icon: Network, label: "Elastic IPs", value: data.eips.length, to: "/networks/kube-ovn/ovn-eips" },
              ] : []),
              ...(provider ? [{ icon: ShieldCheck, label: `Security groups (${provider === "cilium" ? "Cilium" : "Kube-OVN"})`, value: data.securityGroups.length, to: "/vpc/security-groups" }] : [
                { icon: ShieldCheck, label: "Network policies", value: "View", to: "/networks/kubernetes/network-policies" },
              ]),
            ].map((item) => (
              <Link key={item.label} to={item.to} className="flex items-center justify-between rounded-lg border p-2.5 text-sm transition-colors hover:bg-muted/50">
                <span className="flex items-center gap-2"><item.icon className="size-4 text-muted-foreground" />{item.label}</span>
                <span className="font-semibold tabular-nums">{item.value}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-base">Hosts</CardTitle>
            <CardDescription>Instance placement and host capacity</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              {data.nodes.slice(0, 12).map((node) => {
                const running = data.vmis.filter((vmi) => str(asRecord(vmi.status).nodeName) === node.metadata.name).length
                const allocatable = asRecord(asRecord(node.status).allocatable)
                const ready = nodeReady(node)
                return (
                  <Link key={node.metadata.name} to={`/nodes/_cluster/${node.metadata.name}`} className="flex items-center justify-between gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50">
                    <div className="flex min-w-0 items-center gap-3">
                      <IconBadge icon={Server} color={ready ? "blue" : "red"} />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{node.metadata.name}</div>
                        <div className="text-xs text-muted-foreground">{str(allocatable.cpu)} vCPU / {formatGi(Math.round(parseQuantityGi(allocatable.memory)))}</div>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-sm font-semibold tabular-nums">{running} <span className="text-xs font-normal text-muted-foreground">instances</span></span>
                      <StatusDot status={asRecord(node.spec).unschedulable ? "Cordoned" : ready ? "Ready" : "NotReady"} />
                    </div>
                  </Link>
                )
              })}
              {data.nodes.length === 0 && <p className="text-sm text-muted-foreground">No hosts found.</p>}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Recent warnings</CardTitle>
            <CardDescription>Latest warning events across namespaces</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {warnings.map((event) => (
              <div key={event.metadata.uid || event.metadata.name} className="flex gap-3 rounded-lg border p-2.5">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-yellow-600 dark:text-yellow-400" />
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{event.reason}</span>
                    <span className="text-xs text-muted-foreground">{event.involvedObject?.kind}/{event.involvedObject?.name}</span>
                  </div>
                  <p className="line-clamp-2 text-xs text-muted-foreground">{event.message}</p>
                  <span className="text-xs text-muted-foreground">{relativeTime(event.lastTimestamp || event.eventTime)}</span>
                </div>
              </div>
            ))}
            {warnings.length === 0 && <p className="text-sm text-muted-foreground">No warnings. Everything looks healthy.</p>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Running instances</CardTitle>
          <CardDescription>A quick jump to instances that are up</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {data.vms.filter((vm) => vmStatusGroup(vmStatus(vm)) === "running").slice(0, 8).map((vm) => {
            const shape = vmShape(vm)
            return (
              <Link key={`${vm.metadata.namespace}/${vm.metadata.name}`} to={`/kubevirt/virtualization/virtual-machines/${vm.metadata.namespace}/${vm.metadata.name}/overview`} className="rounded-lg border p-3 transition-colors hover:bg-muted/50">
                <div className="truncate text-sm font-medium">{vm.metadata.name}</div>
                <div className="text-xs text-muted-foreground">{vm.metadata.namespace} / {shape.label} / {shape.detail}</div>
              </Link>
            )
          })}
          {statusCounts.running === 0 && <p className="text-sm text-muted-foreground">No running instances.</p>}
        </CardContent>
      </Card>
    </div>
  )
}
