import { useMemo, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { Plus } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { DataTable, EmptyState, LoadingState, PageHeader, Panel, StatusDot, UsageBar } from "@/components/console"
import { fetchNodeUsage, formatBytes, parseBytes, parseCpuCores, useMetricsPoll } from "@/lib/metrics"
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
import { engineLabel, listAllSecurityGroups, useSgProvider } from "@/lib/security-groups"
import { vmStatus, vmStatusGroup } from "@/lib/instances"
import { toneClasses, type SectionTone } from "@/lib/navigation"

type EventLike = KubeObject & { type?: string; reason?: string; message?: string; lastTimestamp?: string; eventTime?: string; involvedObject?: { kind?: string; name?: string; namespace?: string } }

const statusRows = [
  { id: "running", label: "Running", status: "Running" },
  { id: "stopped", label: "Stopped", status: "Stopped" },
  { id: "transitioning", label: "In progress", status: "Pending" },
  { id: "error", label: "Error", status: "Error" },
]

const nodeReady = (node: KubeObject) => asList(asRecord(node.status).conditions).some((condition) => condition.type === "Ready" && condition.status === "True")

function Metric({ label, value, detail, to, tone, ratio }: { label: string; value: ReactNode; detail?: ReactNode; to?: string; tone: SectionTone; ratio?: number }) {
  const colors = toneClasses[tone]
  const body = (
    <div className={cn("relative h-full px-4 pt-3.5 pb-3", to && "transition-colors hover:bg-muted/50")}>
      <span className={cn("absolute inset-x-0 top-0 h-0.5", colors.bg)} />
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className={cn("size-1.5 rounded-full", colors.dot)} />
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      {ratio !== undefined && (
        <div className={cn("mt-1.5 h-1 overflow-hidden rounded-full", colors.soft)}>
          <div className={cn("h-full rounded-full", ratio > 0.9 ? "bg-red-500" : colors.bg)} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
        </div>
      )}
      {detail && <div className="mt-1 text-xs text-muted-foreground tabular-nums">{detail}</div>}
    </div>
  )
  return to ? <Link to={to}>{body}</Link> : body
}

function CountRow({ label, value, to, children }: { label: ReactNode; value: ReactNode; to?: string; children?: ReactNode }) {
  const row = (
    <div className={cn("flex items-center justify-between gap-3 px-4 py-2 text-sm", to && "transition-colors hover:bg-muted/50")}>
      <span className="flex min-w-0 items-center gap-2">{children ?? label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
  return to ? <Link to={to} className="block">{row}</Link> : row
}

export function OverviewPage() {
  const profile = useNetworkProfile()
  const { providers } = useSgProvider()
  const nodeUsage = useMetricsPoll(fetchNodeUsage, [])

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
      // Both Kube-OVN NAT models: VPC NAT gateway (iptables) and OVN native EIPs.
      profile.vpc ? Promise.all([listItems("/apis/kubeovn.io/v1/iptables-eips"), listItems("/apis/kubeovn.io/v1/ovn-eips")]).then((lists) => lists.flat()) : Promise.resolve([]),
    ])
    const securityGroups = await listAllSecurityGroups(providers)
    return { vms, vmis, dvs, nodes, kvPods, events, vpcs, subnets, eips, securityGroups }
  }, {
    vms: [] as KubeObject[], vmis: [] as KubeObject[], dvs: [] as KubeObject[], nodes: [] as KubeObject[], kvPods: [] as KubeObject[],
    events: [] as EventLike[], vpcs: [] as KubeObject[], subnets: [] as KubeObject[], eips: [] as KubeObject[], securityGroups: [] as Awaited<ReturnType<typeof listAllSecurityGroups>>,
  }, [profile.vpc, providers.join(",")])

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

  const components = ["virt-operator", "virt-api", "virt-controller", "virt-handler"].map((component) => {
    const pods = data.kvPods.filter((pod) => pod.metadata.name.startsWith(component))
    const running = pods.filter((pod) => str(asRecord(pod.status).phase) === "Running").length
    return { component, total: pods.length, running }
  })

  const warnings = data.events
    .filter((event) => event.type === "Warning")
    .sort((a, b) => new Date(b.lastTimestamp || b.eventTime || 0).getTime() - new Date(a.lastTimestamp || a.eventTime || 0).getTime())
    .slice(0, 10)

  const readyNodes = data.nodes.filter(nodeReady).length
  const pct = (used: number, total: number) => total > 0 ? `${Math.round((used / total) * 100)}%` : "-"

  if (loading && data.nodes.length === 0) return <LoadingState />

  return (
    <div className="space-y-5">
      <PageHeader
        title="Overview"
        actions={<Button asChild size="sm" className="gap-1.5"><Link to="/kubevirt/virtualization/virtual-machines/create"><Plus className="size-4" />Create instance</Link></Button>}
      />

      <div className="grid grid-cols-2 divide-x divide-y overflow-hidden rounded-lg border bg-card md:grid-cols-5 md:divide-y-0">
        <Metric tone="compute" label="Hosts" value={data.nodes.length} detail={`${readyNodes} ready`} to="/nodes" />
        <Metric tone="compute" label="Instances" value={data.vms.length} detail={`${statusCounts.running} running`} to="/kubevirt/virtualization/virtual-machines" />
        <Metric tone="compute" label="vCPU allocated" value={pct(allocation.vcpu, allocation.capacityCpu)} ratio={allocation.capacityCpu ? allocation.vcpu / allocation.capacityCpu : 0} detail={`${allocation.vcpu} of ${allocation.capacityCpu}`} />
        <Metric tone="compute" label="Memory allocated" value={pct(allocation.memoryGi, allocation.capacityMemory)} ratio={allocation.capacityMemory ? allocation.memoryGi / allocation.capacityMemory : 0} detail={`${formatGi(Math.round(allocation.memoryGi))} of ${formatGi(Math.round(allocation.capacityMemory))}`} />
        <Metric tone="storage" label="Disks" value={formatGi(diskGi)} detail={`${data.dvs.length} volumes`} to="/kubevirt/cdi/data-volumes" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          <DataTable
            minWidth={520}
            rows={data.nodes}
            rowKey={(node) => node.metadata.name}
            empty={<EmptyState title="No hosts" />}
            columns={[
              { header: "Host", cell: (node) => <Link to={`/nodes/_cluster/${node.metadata.name}`} className="font-medium hover:text-primary transition-colors">{node.metadata.name}</Link> },
              { header: "Status", cell: (node) => <StatusDot status={asRecord(node.spec).unschedulable ? "Cordoned" : nodeReady(node) ? "Ready" : "NotReady"} /> },
              { header: "Instances", className: "text-right", cell: (node) => <span className="tabular-nums">{data.vmis.filter((vmi) => str(asRecord(vmi.status).nodeName) === node.metadata.name).length}</span> },
              {
                header: nodeUsage ? "CPU used" : "vCPU",
                className: nodeUsage ? "w-44" : "text-right",
                cell: (node) => {
                  const allocatable = parseCpuCores(asRecord(asRecord(node.status).allocatable).cpu)
                  const used = nodeUsage?.[node.metadata.name]?.cpuCores
                  if (used === undefined) return <span className="tabular-nums">{str(asRecord(asRecord(node.status).allocatable).cpu)}</span>
                  return <UsageBar used={used} total={allocatable} label={`${used.toFixed(1)} / ${allocatable} cores`} />
                },
              },
              {
                header: nodeUsage ? "Memory used" : "Memory",
                className: nodeUsage ? "w-48" : "text-right",
                cell: (node) => {
                  const allocatable = parseBytes(asRecord(asRecord(node.status).allocatable).memory)
                  const used = nodeUsage?.[node.metadata.name]?.memoryBytes
                  if (used === undefined) return <span className="tabular-nums">{formatGi(Math.round(parseQuantityGi(asRecord(asRecord(node.status).allocatable).memory)))}</span>
                  return <UsageBar used={used} total={allocatable} label={`${formatBytes(used)} / ${formatBytes(allocatable)}`} />
                },
              },
            ]}
          />

          <Panel title="Warning events" bodyClassName="p-0">
            {warnings.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">None</p>
            ) : (
              <div className="divide-y">
                {warnings.map((event) => (
                  <div key={event.metadata.uid || event.metadata.name} className="grid gap-x-4 px-4 py-2 text-sm md:grid-cols-[160px_1fr_auto]">
                    <span className="font-medium">{event.reason}</span>
                    <span className="min-w-0 text-muted-foreground">
                      <span className="font-mono text-xs text-foreground">{event.involvedObject?.kind}/{event.involvedObject?.name}</span> {event.message}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">{relativeTime(event.lastTimestamp || event.eventTime)}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Instances" bodyClassName="p-0 divide-y">
            <div className="flex h-1.5 overflow-hidden">
              {[["running", "bg-green-500"], ["transitioning", "bg-amber-500"], ["error", "bg-red-500"], ["stopped", "bg-muted-foreground/30"]].map(([id, color]) => statusCounts[id] > 0 && (
                <div key={id} className={color} style={{ width: `${(statusCounts[id] / Math.max(1, data.vms.length)) * 100}%` }} />
              ))}
            </div>
            {statusRows.map((row) => (
              <CountRow key={row.id} label={row.label} value={statusCounts[row.id]} to="/kubevirt/virtualization/virtual-machines">
                <StatusDot status={row.status} label={row.label} />
              </CountRow>
            ))}
          </Panel>

          <Panel title="Network" description={profile.label} actions={<Link to="/settings" className="text-xs text-muted-foreground hover:text-foreground">Change</Link>} bodyClassName="p-0 divide-y">
            {profile.vpc && (
              <>
                <CountRow label="VPCs" value={data.vpcs.length} to="/vpc/vpcs" />
                <CountRow label="Subnets" value={data.subnets.length} to="/vpc/subnets" />
                <CountRow label="Elastic IPs" value={data.eips.length} to="/vpc/elastic-ips" />
              </>
            )}
            {providers.length > 0 ? (
              <CountRow label={`Security groups (${providers.map((engine) => engineLabel[engine]).join(", ")})`} value={data.securityGroups.length} to="/vpc/security-groups" />
            ) : (
              <CountRow label="Network policies" value="" to="/networks/kubernetes/network-policies" />
            )}
          </Panel>

          <Panel title="KubeVirt" bodyClassName="p-0 divide-y">
            {components.map((item) => (
              <CountRow key={item.component} label={item.component} value={item.total ? `${item.running}/${item.total}` : "-"}>
                <StatusDot status={item.total === 0 ? "Unknown" : item.running === item.total ? "Running" : "Degraded"} label={item.component} />
              </CountRow>
            ))}
          </Panel>
        </div>
      </div>
    </div>
  )
}
