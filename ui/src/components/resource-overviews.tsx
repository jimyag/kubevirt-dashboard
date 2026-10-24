import { useEffect, useState, type ReactNode } from "react"
import { Link } from "react-router-dom"

import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { StatusDot, UsageBar } from "@/components/console"
import { listItems, relativeTime, str } from "@/lib/kube"
import { fetchNodeUsage, formatBytes, formatStorageSize, parseBytes, parseCpuCores } from "@/lib/metrics"
import { t } from "@/lib/i18n"
import {
  asRecord,
  asRecordList,
  compactValue,
  hasRenderableValue,
  humanizeKey,
  joinList,
} from "@/lib/detail-values"
import {
  ChipList,
  CompactKvTable,
  DetailValue,
  DetailVolumeTable,
  KvSection,
  PortsTable,
  SectionCard,
  SummaryCard,
  SummaryRow,
  ValueSection,
} from "@/components/detail-parts"
import type { DetailSection, KubeResource, ResourceConfig } from "@/components/resource-management"

/** Kind-specific overview tabs for Resource Catalog detail pages. */

type ContainerStatusView = { status: string; label: string; since?: string; detail?: string }

/** Display state of one container from its status entry. */
const containerState = (statusEntry: Record<string, unknown>): ContainerStatusView | null => {
  const state = asRecord(statusEntry.state)
  const running = asRecord(state.running)
  const waiting = asRecord(state.waiting)
  const terminated = asRecord(state.terminated)
  if (state.running) return { status: "Running", label: t("Running"), since: str(running.startedAt) }
  if (state.waiting) return { status: str(waiting.reason, "Waiting"), label: str(waiting.reason, t("Waiting")), detail: str(waiting.message) }
  if (state.terminated) {
    const reason = str(terminated.reason, "Terminated")
    return { status: reason === "Completed" ? "Succeeded" : "Error", label: t("{reason} (exit {code})", { reason, code: compactValue(terminated.exitCode) }), since: str(terminated.finishedAt), detail: str(terminated.message) }
  }
  return null
}

const resourceText = (value: unknown) => Object.entries(asRecord(value)).map(([key, amount]) => `${key} ${compactValue(amount)}`).join(" · ")

/** One card per container: image, state, restarts, ports, resources, command and mounts. */
function ContainerCards({ containers, statuses = [], init }: { containers: Record<string, unknown>[]; statuses?: Record<string, unknown>[]; init?: boolean }) {
  if (containers.length === 0) return <span className="text-sm text-muted-foreground">{t("No containers")}</span>
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      {containers.map((container) => {
        const name = str(container.name)
        const statusEntry = statuses.find((item) => item.name === name) || {}
        const state = containerState(statusEntry)
        const resources = asRecord(container.resources)
        const ports = asRecordList(container.ports).map((port) => `${compactValue(port.containerPort)}/${str(port.protocol, "TCP")}${port.name ? ` (${str(port.name)})` : ""}`)
        const mounts = asRecordList(container.volumeMounts).map((mount) => `${str(mount.mountPath)}${mount.readOnly ? " (ro)" : ""}`)
        const command = [...(Array.isArray(container.command) ? container.command : []), ...(Array.isArray(container.args) ? container.args : [])].map(String).join(" ")
        const rows: Array<{ label: string; value: ReactNode }> = [
          ...(statuses.length ? [
            { label: t("Ready"), value: statusEntry.ready ? t("Yes") : t("No") },
            { label: t("Restarts"), value: compactValue(statusEntry.restartCount ?? 0) },
          ] : []),
          ...(state?.since ? [{ label: t("Since"), value: <span title={state.since}>{relativeTime(state.since)}</span> }] : []),
          ...(ports.length ? [{ label: t("Ports"), value: <span className="font-mono text-xs">{ports.join(", ")}</span> }] : []),
          ...(resourceText(resources.requests) ? [{ label: t("Requests"), value: <span className="font-mono text-xs">{resourceText(resources.requests)}</span> }] : []),
          ...(resourceText(resources.limits) ? [{ label: t("Limits"), value: <span className="font-mono text-xs">{resourceText(resources.limits)}</span> }] : []),
          ...(command ? [{ label: t("Command"), value: <span className="line-clamp-3 font-mono text-xs break-all" title={command}>{command}</span> }] : []),
          ...(mounts.length ? [{ label: t("Mounts"), value: <span className="font-mono text-xs break-all">{mounts.slice(0, 4).join(", ")}{mounts.length > 4 ? ` +${mounts.length - 4}` : ""}</span> }] : []),
        ]
        return (
          <div key={name} className="min-w-0 rounded-md border px-3 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium">{name}</span>
                {init && <Badge variant="outline">{t("init")}</Badge>}
              </div>
              {state && <StatusDot status={state.status} label={state.label} />}
            </div>
            <div className="mt-1 font-mono text-xs break-all text-muted-foreground">{str(container.image)}</div>
            {state?.detail && <p className="mt-1 text-xs break-words text-muted-foreground">{state.detail}</p>}
            {rows.length > 0 && (
              <dl className="mt-2 grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
                {rows.map((row) => (
                  <div key={row.label} className="contents">
                    <dt className="text-xs text-muted-foreground">{row.label}</dt>
                    <dd className="min-w-0">{row.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        )
      })}
    </div>
  )
}

const ownerText = (resource: KubeResource) => (resource.metadata.ownerReferences || []).map((owner) => `${owner.kind}/${owner.name}`).join(", ")

function PodDetailOverview({ resource }: { resource: KubeResource }) {
  const spec = asRecord(resource.spec)
  const status = asRecord(resource.status)
  const containers = asRecordList(spec.containers)
  const initContainers = asRecordList(spec.initContainers)
  const containerStatuses = asRecordList(status.containerStatuses)
  const initContainerStatuses = asRecordList(status.initContainerStatuses)
  const restarts = containerStatuses.reduce((sum, item) => sum + Number(item.restartCount || 0), 0)
  const podIPs = asRecordList(status.podIPs).map((item) => item.ip).filter(Boolean)
  const phase = str(status.phase, "Unknown")
  const reason = str(status.reason)
  const node = str(spec.nodeName)

  return (
    <div className="space-y-4">
      <SummaryRow>
        <SummaryCard label={t("Status")} value={reason ? `${phase} (${reason})` : phase} variant={reason || phase} />
        <SummaryCard label={t("Pod IP")} value={podIPs.length ? podIPs.join(", ") : status.podIP} />
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">{t("Node")}</dt>
          <dd className="mt-1 text-sm font-medium">{node ? <Link to={`/nodes/_cluster/${node}`} className="hover:text-primary">{node}</Link> : t("Unscheduled")}</dd>
        </div>
        <SummaryCard label={t("Restarts")} value={String(restarts)} />
        <SummaryCard label={t("QoS")} value={status.qosClass} />
        <SummaryCard label={t("Started")} value={status.startTime} />
        <SummaryCard label={t("Controlled by")} value={ownerText(resource)} />
        <SummaryCard label={t("Service account")} value={spec.serviceAccountName} />
      </SummaryRow>

      <SectionCard title={t("Containers")}>
        <ContainerCards containers={containers} statuses={containerStatuses} />
      </SectionCard>
      {initContainers.length > 0 && (
        <SectionCard title={t("Init containers")}>
          <ContainerCards containers={initContainers} statuses={initContainerStatuses} init />
        </SectionCard>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <KvSection title={t("Scheduling")} rows={[
          { label: t("Restart policy"), value: spec.restartPolicy },
          { label: t("Priority class"), value: spec.priorityClassName },
          { label: t("Runtime class"), value: spec.runtimeClassName },
          { label: t("Node selector"), value: spec.nodeSelector },
          { label: t("Tolerations"), value: spec.tolerations },
          { label: t("Affinity"), value: spec.affinity },
        ]} />
        <KvSection title={t("Networking")} rows={[
          { label: t("Host IP"), value: status.hostIP },
          { label: t("DNS policy"), value: spec.dnsPolicy },
          { label: t("Host network"), value: spec.hostNetwork },
          { label: t("Host PID"), value: spec.hostPID },
          { label: t("Host IPC"), value: spec.hostIPC },
        ]} />
      </div>

      {asRecordList(spec.volumes).length > 0 && (
        <SectionCard title={t("Volumes")}>
          <DetailVolumeTable volumes={asRecordList(spec.volumes)} />
        </SectionCard>
      )}
      <ValueSection title={t("Conditions")} value={status.conditions} />
    </div>
  )
}

function WorkloadDetailOverview({ resource }: { resource: KubeResource }) {
  const spec = asRecord(resource.spec)
  const status = asRecord(resource.status)
  const template = asRecord(spec.template)
  const templateSpec = asRecord(template.spec)
  const containers = asRecordList(templateSpec.containers)
  const volumes = asRecordList(templateSpec.volumes)
  const selector = asRecord(spec.selector).matchLabels || spec.selector
  const desired = Number(spec.replicas ?? status.replicas ?? 0)
  const ready = Number(status.readyReplicas ?? 0)
  const hasReplicas = spec.replicas !== undefined || status.replicas !== undefined
  const strategy = asRecord(spec.strategy || spec.updateStrategy)

  return (
    <div className="space-y-4">
      <SummaryRow>
        {hasReplicas && (
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">{t("Ready replicas")}</dt>
            <dd className="mt-1"><UsageBar used={ready} total={desired} label={t("{ready} of {desired} ready", { ready, desired })} /></dd>
          </div>
        )}
        <SummaryCard label={t("Updated")} value={status.updatedReplicas} />
        <SummaryCard label={t("Available")} value={status.availableReplicas} />
        <SummaryCard label={t("Strategy")} value={strategy.type} />
        <SummaryCard label={t("Schedule")} value={spec.schedule} />
        <SummaryCard label={t("Selector")} value={selector} />
        <SummaryCard label={t("Images")} value={containers.map((container) => str(container.image))} />
      </SummaryRow>

      {containers.length > 0 && (
        <SectionCard title={t("Containers")}>
          <ContainerCards containers={containers} />
        </SectionCard>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <KvSection title={t("Rollout")} rows={[
          { label: t("Strategy"), value: strategy },
          { label: t("Min ready seconds"), value: spec.minReadySeconds },
          { label: t("Revision history"), value: spec.revisionHistoryLimit },
          { label: t("Paused"), value: spec.paused },
          { label: t("Suspend"), value: spec.suspend },
          { label: t("Observed generation"), value: status.observedGeneration },
        ]} />
        <KvSection title={t("Pod template")} rows={[
          { label: t("Service account"), value: templateSpec.serviceAccountName },
          { label: t("Restart policy"), value: templateSpec.restartPolicy },
          { label: t("Node selector"), value: templateSpec.nodeSelector },
          { label: t("Labels"), value: asRecord(template.metadata).labels },
        ]} />
      </div>
      {volumes.length > 0 && (
        <SectionCard title={t("Volumes")}>
          <DetailVolumeTable volumes={volumes} />
        </SectionCard>
      )}
      <ValueSection title={t("Conditions")} value={status.conditions} />
    </div>
  )
}

function ServiceDetailOverview({ resource }: { resource: KubeResource }) {
  const spec = asRecord(resource.spec)
  const status = asRecord(resource.status)
  const ports = asRecordList(spec.ports)
  const ingress = asRecordList(asRecord(status.loadBalancer).ingress).map((item) => item.ip || item.hostname).filter(Boolean)
  const clusterIPs = Array.isArray(spec.clusterIPs) && spec.clusterIPs.length ? spec.clusterIPs : [spec.clusterIP]
  return (
    <div className="space-y-4">
      <SummaryRow>
        <SummaryCard label={t("Type")} value={spec.type || "ClusterIP"} />
        <SummaryCard label={t("Cluster IP")} value={clusterIPs.filter((ip) => ip && ip !== "None").join(", ") || (spec.clusterIP === "None" ? "None (headless)" : "")} />
        <SummaryCard label={t("External address")} value={[...ingress, ...(Array.isArray(spec.externalIPs) ? spec.externalIPs : []), spec.externalName].filter(Boolean)} />
        <SummaryCard label={t("Selector")} value={asRecord(spec.selector)} />
      </SummaryRow>
      {ports.length > 0 && <SectionCard title={t("Ports")}><PortsTable ports={ports} /></SectionCard>}
      <KvSection title={t("Traffic")} rows={[
        { label: t("Session affinity"), value: spec.sessionAffinity === "None" ? "" : spec.sessionAffinity },
        { label: t("External traffic policy"), value: spec.externalTrafficPolicy },
        { label: t("Internal traffic policy"), value: spec.internalTrafficPolicy },
        { label: t("IP families"), value: spec.ipFamilies },
        { label: t("IP family policy"), value: spec.ipFamilyPolicy },
        { label: t("Load balancer class"), value: spec.loadBalancerClass },
      ]} />
      <ValueSection title={t("Conditions")} value={status.conditions} />
    </div>
  )
}

function NetworkDetailOverview({ resource }: { resource: KubeResource }) {
  const spec = asRecord(resource.spec)
  const status = asRecord(resource.status)
  if (resource.kind === "Service") return <ServiceDetailOverview resource={resource} />
  const selector = spec.selector || asRecord(spec.podSelector).matchLabels || spec.podSelector
  return (
    <div className="space-y-4">
      <SummaryRow>
        <SummaryCard label={t("Type")} value={spec.type} />
        <SummaryCard label={t("Class")} value={spec.ingressClassName || spec.gatewayClassName || spec.controllerName || spec.provider} />
        <SummaryCard label={t("Selector")} value={selector} />
        <SummaryCard label={t("Address")} value={spec.cidrBlock || spec.cidr || spec.vpc || asRecord(status).addresses} />
      </SummaryRow>
      {asRecordList(spec.ports).length > 0 && <SectionCard title={t("Ports")}><PortsTable ports={asRecordList(spec.ports)} /></SectionCard>}
      <div className="grid gap-4 xl:grid-cols-2">
        <KvSection title={t("Routing and selectors")} rows={[
            { label: t("Policy types"), value: spec.policyTypes },
            { label: t("Rules"), value: spec.rules || spec.ingress || spec.egress },
            { label: t("Hostnames"), value: spec.hostnames },
            { label: t("Parent refs"), value: spec.parentRefs },
          ]} />
        <KvSection title={t("Addresses")} rows={[
            { label: t("Cluster IP"), value: spec.clusterIP },
            { label: t("External IPs"), value: spec.externalIPs },
            { label: t("Load balancer"), value: status.loadBalancer },
            { label: t("CIDR"), value: spec.cidrBlock || spec.cidr },
            { label: t("Gateway"), value: spec.gateway || spec.gatewayNode },
          ]} />
      </div>
      <ValueSection title={t("Status")} value={status.conditions || status} />
    </div>
  )
}

function StorageDetailOverview({ resource }: { resource: KubeResource }) {
  const spec = asRecord(resource.spec)
  const status = asRecord(resource.status)
  return (
    <div className="space-y-4">
      <SummaryRow>
        <SummaryCard label={t(resource.kind === "StorageClass" ? "Kind" : "Phase")} value={status.phase || status.status || resource.kind} variant={String(status.phase || status.status || "")} />
        <SummaryCard label={t("Capacity")} value={formatStorageSize(asRecord(status.capacity).storage || asRecord(spec.capacity).storage || asRecord(asRecord(spec.resources).requests).storage)} />
        <SummaryCard label={t(resource.kind === "StorageClass" ? "Provisioner" : "Storage class")} value={spec.storageClassName || resource.storageClassName || resource.provisioner} />
        <SummaryCard label={t(resource.kind === "StorageClass" ? "Reclaim policy" : "Access modes")} value={spec.accessModes || resource.reclaimPolicy} />
      </SummaryRow>
      <div className="grid gap-4 xl:grid-cols-2">
        <KvSection title={t("Storage")} rows={[
            { label: t("Provisioner"), value: resource.provisioner },
            { label: t("Volume name"), value: spec.volumeName },
            { label: t("Volume mode"), value: spec.volumeMode },
            { label: t("Reclaim policy"), value: resource.reclaimPolicy || spec.persistentVolumeReclaimPolicy },
            { label: t("Binding mode"), value: resource.volumeBindingMode },
            { label: t("Expansion"), value: resource.allowVolumeExpansion },
          ]} />
        <KvSection title={t("Source and parameters")} rows={[
            { label: t("Parameters"), value: resource.parameters },
            { label: t("Source"), value: spec.dataSourceRef || spec.dataSource || spec.source || spec.csi || spec.hostPath || spec.nfs },
            { label: t("Claim ref"), value: spec.claimRef },
            { label: t("Node affinity"), value: spec.nodeAffinity },
            { label: t("Conditions"), value: status.conditions },
          ]} />
      </div>
    </div>
  )
}

function VirtualizationDetailOverview({ resource }: { resource: KubeResource }) {
  const spec = asRecord(resource.spec)
  const status = asRecord(resource.status)
  const template = asRecord(spec.template)
  const templateSpec = asRecord(template.spec)
  const domain = asRecord(templateSpec.domain || spec.domain)
  const devices = asRecord(domain.devices)
  return (
    <div className="space-y-4">
      <SummaryRow>
        <SummaryCard label={t("Printable status")} value={status.printableStatus || status.phase || status.conditions} variant={String(status.printableStatus || status.phase || "")} />
        <SummaryCard label={t("Run strategy")} value={spec.runStrategy || spec.running} />
        <SummaryCard label={t("Node")} value={status.nodeName} />
        <SummaryCard label={t("IP")} value={asRecordList(status.interfaces).map((item) => item.ipAddress).filter(Boolean)} />
      </SummaryRow>
      <div className="grid gap-4 xl:grid-cols-2">
        <KvSection title={t("Compute")} rows={[
            { label: t("CPU"), value: domain.cpu },
            { label: t("Memory"), value: asRecord(domain.resources).requests || spec.memory },
            { label: t("Machine"), value: asRecord(domain.machine).type },
            { label: t("Firmware"), value: domain.firmware },
            { label: t("Features"), value: domain.features },
          ]} />
        <KvSection title={t("Runtime")} rows={[
            { label: t("Phase"), value: status.phase },
            { label: t("Conditions"), value: status.conditions },
            { label: t("Guest OS"), value: status.guestOSInfo },
            { label: t("Migration"), value: status.migrationState },
          ]} />
      </div>
      <SectionCard title={t("Disks and volumes")}>
        <div className="grid gap-4 xl:grid-cols-2">
          <DetailValue value={devices.disks || spec.disks} />
          <DetailVolumeTable volumes={asRecordList(templateSpec.volumes || spec.volumes)} />
        </div>
      </SectionCard>
      <ValueSection title={t("Networks")} value={templateSpec.networks || devices.interfaces || spec.networks || spec.interfaces} />
    </div>
  )
}

type NodeRequests = { cpu: number; memory: number; pods: number }

/** Sums container requests of the pods scheduled on a node, like `kubectl describe node`. */
function useNodeRequests(node: string) {
  const [requests, setRequests] = useState<NodeRequests | null>(null)
  const [usage, setUsage] = useState<{ cpuCores: number; memoryBytes: number } | null>(null)
  useEffect(() => {
    let cancelled = false
    listItems(`/api/v1/pods?fieldSelector=${encodeURIComponent(`spec.nodeName=${node},status.phase!=Succeeded,status.phase!=Failed`)}`).then((pods) => {
      if (cancelled) return
      let cpu = 0
      let memory = 0
      for (const pod of pods) {
        for (const container of asRecordList(asRecord(pod.spec).containers)) {
          const podRequests = asRecord(asRecord(container.resources).requests)
          cpu += parseCpuCores(podRequests.cpu)
          memory += parseBytes(podRequests.memory)
        }
      }
      setRequests({ cpu, memory, pods: pods.length })
    })
    fetchNodeUsage().then((all) => {
      if (!cancelled) setUsage(all?.[node] ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [node])
  return { requests, usage }
}

function NodeDetailOverview({ resource }: { resource: KubeResource }) {
  const spec = asRecord(resource.spec)
  const status = asRecord(resource.status)
  const info = asRecord(status.nodeInfo)
  const conditions = asRecordList(status.conditions)
  const readyCondition = conditions.find((item) => item.type === "Ready")
  const ready = readyCondition?.status === "True"
  const roles = Object.keys(resource.metadata.labels || {}).filter((key) => key.startsWith("node-role.kubernetes.io/")).map((key) => key.split("/")[1]).filter(Boolean)
  const addresses = asRecordList(status.addresses)
  const internalIp = addresses.find((item) => item.type === "InternalIP")?.address
  const allocatable = asRecord(status.allocatable)
  const capacity = asRecord(status.capacity)
  const taints = asRecordList(spec.taints)
  // Conditions other than Ready are problems only when True (pressure, unavailable network).
  const problems = conditions.filter((item) => item.type !== "Ready" && item.status === "True")
  const { requests, usage } = useNodeRequests(resource.metadata.name)
  const cpuTotal = parseCpuCores(allocatable.cpu)
  const memoryTotal = parseBytes(allocatable.memory)
  const podsTotal = Number(allocatable.pods || 0)

  return (
    <div className="space-y-4">
      <SummaryRow>
        <SummaryCard label={t("Status")} value={spec.unschedulable ? t("Ready, cordoned") : ready ? t("Ready") : t("Not ready")} variant={spec.unschedulable ? "Cordoned" : ready ? "Ready" : "NotReady"} />
        <SummaryCard label={t("Roles")} value={roles.length ? roles : t("worker")} />
        <SummaryCard label={t("Internal IP")} value={internalIp} />
        <SummaryCard label={t("Kubelet")} value={info.kubeletVersion} />
        <SummaryCard label={t("OS")} value={[info.osImage, info.architecture].filter(Boolean).join(" · ")} />
        <SummaryCard label={t("Container runtime")} value={info.containerRuntimeVersion} />
        <SummaryCard label={t("Kernel")} value={info.kernelVersion} />
      </SummaryRow>

      <SectionCard title={t("Resources")} description={t("Requests of the pods on this node against allocatable capacity.")}>
        <div className="grid gap-6 md:grid-cols-3">
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">{t("CPU requested")}</div>
            <UsageBar used={requests?.cpu ?? 0} total={cpuTotal} label={requests ? t("{used} / {total} cores", { used: requests.cpu.toFixed(2), total: cpuTotal }) : t("Loading...")} />
            {usage && <div className="text-xs text-muted-foreground">{t("In use: {target}", { target: t("{n} cores", { n: usage.cpuCores.toFixed(2) }) })}</div>}
          </div>
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">{t("Memory requested")}</div>
            <UsageBar used={requests?.memory ?? 0} total={memoryTotal} label={requests ? `${formatBytes(requests.memory)} / ${formatBytes(memoryTotal)}` : t("Loading...")} />
            {usage && <div className="text-xs text-muted-foreground">{t("In use: {target}", { target: formatBytes(usage.memoryBytes) })}</div>}
          </div>
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">{t("Pods")}</div>
            <UsageBar used={requests?.pods ?? 0} total={podsTotal} label={requests ? `${requests.pods} / ${podsTotal}` : t("Loading...")} />
          </div>
        </div>
      </SectionCard>

      {problems.length > 0 && <ValueSection title={t("Problems")} value={problems} />}

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard title={t("Capacity")}>
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="h-8 text-xs font-medium text-muted-foreground">{t("Resource")}</TableHead>
                <TableHead className="h-8 text-xs font-medium text-muted-foreground">{t("Capacity")}</TableHead>
                <TableHead className="h-8 text-xs font-medium text-muted-foreground">{t("Allocatable")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.keys(capacity).map((key) => (
                <TableRow key={key} className="hover:bg-muted/40">
                  <TableCell className="py-1.5 font-mono text-xs">{key}</TableCell>
                  <TableCell className="py-1.5 font-mono text-xs">{compactValue(capacity[key])}</TableCell>
                  <TableCell className="py-1.5 font-mono text-xs">{compactValue(allocatable[key])}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionCard>
        <KvSection title={t("Scheduling")} rows={[
          { label: t("Taints"), value: taints.map((taint) => `${str(taint.key)}${taint.value ? `=${str(taint.value)}` : ""}:${str(taint.effect)}`) },
          { label: t("Pod CIDR"), value: spec.podCIDRs || spec.podCIDR },
          { label: t("Addresses"), value: addresses.map((item) => `${str(item.type)}: ${str(item.address)}`) },
          { label: t("Provider ID"), value: spec.providerID },
        ]} />
      </div>
      <ValueSection title={t("Conditions")} value={status.conditions} />
    </div>
  )
}

const admissionRuleText = (rules: unknown) => asRecordList(rules).map((rule) => {
  const operations = joinList(rule.operations)
  const apiGroups = joinList(rule.apiGroups)
  const resources = joinList(rule.resources)
  const scope = compactValue(rule.scope)
  return [operations, apiGroups, resources, scope].filter((item) => item && item !== "N/A").join(" / ")
}).filter(Boolean)

const admissionClientText = (clientConfig: unknown) => {
  const client = asRecord(clientConfig)
  const service = asRecord(client.service)
  if (service.name) {
    return `Service ${compactValue(service.namespace || "default")}/${compactValue(service.name)}${service.path ? compactValue(service.path) : ""}`
  }
  return compactValue(client.url)
}

function AdmissionDetailOverview({ resource }: { resource: KubeResource }) {
  const spec = asRecord(resource.spec)
  const status = asRecord(resource.status)
  const webhooks = asRecordList(resource.webhooks)
  const validations = asRecordList(spec.validations)
  const variables = asRecordList(spec.variables)
  const auditAnnotations = asRecordList(spec.auditAnnotations)
  const matchConstraints = asRecord(spec.matchConstraints || spec.matchResources)

  if (webhooks.length > 0) {
    return (
      <div className="space-y-4">
        <SummaryRow>
          <SummaryCard label={t("Webhooks")} value={webhooks.length} />
          <SummaryCard label={t("Failure policies")} value={[...new Set(webhooks.map((item) => compactValue(item.failurePolicy || "Fail")))]} />
          <SummaryCard label={t("Side effects")} value={[...new Set(webhooks.map((item) => compactValue(item.sideEffects)))]} />
          <SummaryCard label={t("Admission review")} value={[...new Set(webhooks.flatMap((item) => Array.isArray(item.admissionReviewVersions) ? item.admissionReviewVersions.map(compactValue) : []))]} />
        </SummaryRow>
        <SectionCard title={t("Webhooks")} description={t("Client endpoints, matching rules, selector scope, and admission behavior.")}>
          <div className="overflow-x-auto rounded-lg border">
            <Table className="min-w-[1040px]">
              <TableHeader className="bg-muted/60">
                <TableRow>
                  <TableHead className="h-9 text-xs font-medium text-muted-foreground">{t("Name")}</TableHead>
                  <TableHead className="h-9 text-xs font-medium text-muted-foreground">{t("Client")}</TableHead>
                  <TableHead className="h-9 text-xs font-medium text-muted-foreground">{t("Rules")}</TableHead>
                  <TableHead className="h-9 text-xs font-medium text-muted-foreground">{t("Selectors")}</TableHead>
                  <TableHead className="h-9 text-xs font-medium text-muted-foreground">{t("Policy")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {webhooks.map((webhook, index) => (
                  <TableRow key={`${compactValue(webhook.name)}-${index}`} className="hover:bg-muted/50">
                    <TableCell className="max-w-[220px] break-words font-semibold">{compactValue(webhook.name)}</TableCell>
                    <TableCell className="max-w-[240px] break-words text-xs text-muted-foreground">{admissionClientText(webhook.clientConfig)}</TableCell>
                    <TableCell className="max-w-[320px] text-xs text-muted-foreground">
                      <ChipList values={admissionRuleText(webhook.rules)} />
                    </TableCell>
                    <TableCell className="max-w-[240px] text-xs text-muted-foreground">
                      <DetailValue value={{
                        namespaceSelector: webhook.namespaceSelector,
                        objectSelector: webhook.objectSelector,
                        matchConditions: webhook.matchConditions,
                      }} />
                    </TableCell>
                    <TableCell className="max-w-[220px] text-xs text-muted-foreground">
                      <CompactKvTable rows={[
                        { label: t("Failure"), value: webhook.failurePolicy || "Fail" },
                        { label: t("Match"), value: webhook.matchPolicy },
                        { label: t("Side effects"), value: webhook.sideEffects },
                        { label: t("Timeout"), value: webhook.timeoutSeconds },
                        { label: t("Reinvocation"), value: webhook.reinvocationPolicy },
                      ]} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </SectionCard>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <SummaryRow>
        <SummaryCard label={t("Policy")} value={spec.policyName || resource.metadata.name} />
        <SummaryCard label={t("Failure policy")} value={spec.failurePolicy} />
        <SummaryCard label={t("Actions")} value={spec.validationActions} />
        <SummaryCard label={t("Conditions")} value={asRecordList(status.conditions).length || "N/A"} />
      </SummaryRow>
      <div className="grid gap-4 xl:grid-cols-2">
        <KvSection title={t("Policy")} rows={[
            { label: t("Policy name"), value: spec.policyName },
            { label: t("Failure policy"), value: spec.failurePolicy },
            { label: t("Validation actions"), value: spec.validationActions },
            { label: t("Param kind"), value: spec.paramKind },
            { label: t("Param ref"), value: spec.paramRef },
          ]} />
        <KvSection title={t("Match constraints")} rows={[
            { label: t("Resource rules"), value: matchConstraints.resourceRules },
            { label: t("Exclude rules"), value: matchConstraints.excludeResourceRules },
            { label: t("Namespace selector"), value: matchConstraints.namespaceSelector },
            { label: t("Object selector"), value: matchConstraints.objectSelector },
            { label: t("Match conditions"), value: matchConstraints.matchConditions },
          ]} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <ValueSection title={t("Validations")} value={validations} />
        <ValueSection title={t("Variables and audit")} value={{ variables, auditAnnotations }} />
      </div>
      <ValueSection title={t("Status")} value={status.conditions || status} />
    </div>
  )
}

function RbacDetailOverview({ resource }: { resource: KubeResource }) {
  const rules = asRecordList(resource.rules)
  const roleRef = asRecord(resource.roleRef)
  const subjects = asRecordList(resource.subjects)
  const secrets = asRecordList(resource.secrets)
  const imagePullSecrets = asRecordList(resource.imagePullSecrets)

  return (
    <div className="space-y-4">
      <SummaryRow>
        <SummaryCard label={t("Rules")} value={rules.length || "N/A"} />
        <SummaryCard label={t("Subjects")} value={subjects.length || "N/A"} />
        <SummaryCard label={t("Role ref")} value={[roleRef.kind, roleRef.name].filter(Boolean).map(compactValue).join("/")} />
        <SummaryCard label={t("Automount token")} value={resource.automountServiceAccountToken} />
      </SummaryRow>
      {rules.length > 0 && (
        <SectionCard title={t("Rules")}>
          <div className="overflow-x-auto rounded-lg border">
            <Table className="min-w-[900px]">
              <TableHeader className="bg-muted/60">
                <TableRow>
                  <TableHead className="h-9 text-xs font-medium text-muted-foreground">{t("API groups")}</TableHead>
                  <TableHead className="h-9 text-xs font-medium text-muted-foreground">{t("Resources")}</TableHead>
                  <TableHead className="h-9 text-xs font-medium text-muted-foreground">{t("Resource names")}</TableHead>
                  <TableHead className="h-9 text-xs font-medium text-muted-foreground">{t("Verbs")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((rule, index) => (
                  <TableRow key={index} className="hover:bg-muted/50">
                    <TableCell className="max-w-[220px] break-words text-xs">{joinList(rule.apiGroups)}</TableCell>
                    <TableCell className="max-w-[280px] break-words text-xs">{joinList(rule.resources)}</TableCell>
                    <TableCell className="max-w-[240px] break-words text-xs">{joinList(rule.resourceNames)}</TableCell>
                    <TableCell className="max-w-[240px] break-words text-xs">{joinList(rule.verbs)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </SectionCard>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        <ValueSection title={t("Subjects")} value={subjects} />
        <KvSection title={t("Service account")} rows={[
            { label: t("Secrets"), value: secrets },
            { label: t("Image pull secrets"), value: imagePullSecrets },
            { label: t("Automount token"), value: resource.automountServiceAccountToken },
          ]} />
      </div>
    </div>
  )
}

function ConfigDetailOverview({ resource }: { resource: KubeResource }) {
  const data = asRecord(resource.data)
  const binaryData = asRecord(resource.binaryData)
  const type = compactValue(resource.type || resource.kind)
  const keys = Object.keys(data)
  const binaryKeys = Object.keys(binaryData)
  return (
    <div className="space-y-4">
      <SummaryRow>
        <SummaryCard label={t("Type")} value={type} />
        <SummaryCard label={t("Data keys")} value={keys.length} />
        <SummaryCard label={t("Binary keys")} value={binaryKeys.length || "N/A"} />
        <SummaryCard label={t("Immutable")} value={resource.immutable} />
      </SummaryRow>
      <SectionCard title={t("Data")}>
        <div className="grid gap-3 xl:grid-cols-2">
          {keys.length === 0 && <span className="text-sm text-muted-foreground">{t("No data")}</span>}
          {keys.map((key) => (
            <div key={key} className="min-w-0 rounded-lg border bg-muted/30 p-3">
              <div className="mb-2 break-all text-xs font-semibold text-foreground">{key}</div>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs text-foreground">{compactValue(data[key])}</pre>
            </div>
          ))}
        </div>
      </SectionCard>
      {binaryKeys.length > 0 && (
        <SectionCard title={t("Binary data")}>
          <ChipList values={binaryKeys} />
        </SectionCard>
      )}
    </div>
  )
}

function PolicyDetailOverview({ resource }: { resource: KubeResource }) {
  const spec = asRecord(resource.spec)
  const status = asRecord(resource.status)
  const hard = asRecord(spec.hard)
  const used = asRecord(status.used)
  const limits = asRecordList(spec.limits)

  return (
    <div className="space-y-4">
      <SummaryRow>
        <SummaryCard label={t("Type")} value={resource.kind} />
        <SummaryCard label={t("Scopes")} value={spec.scopes || spec.scopeSelector} />
        <SummaryCard label={t("Limits")} value={limits.length || "N/A"} />
        {resource.kind === "PodDisruptionBudget" && <SummaryCard label={t("Disruptions")} value={`${compactValue(status.currentHealthy)} / ${compactValue(status.desiredHealthy)}`} />}
      </SummaryRow>
      <div className="grid gap-4 xl:grid-cols-2">
        <KvSection title={t("Spec")} rows={[
            { label: t("Min available"), value: spec.minAvailable },
            { label: t("Max unavailable"), value: spec.maxUnavailable },
            { label: t("Selector"), value: asRecord(spec.selector).matchLabels || spec.selector },
            { label: t("Hard"), value: hard },
            { label: t("Limits"), value: limits },
          ]} />
        <KvSection title={t("Status")} rows={[
            { label: t("Used"), value: used },
            { label: t("Current healthy"), value: status.currentHealthy },
            { label: t("Desired healthy"), value: status.desiredHealthy },
            { label: t("Expected pods"), value: status.expectedPods },
            { label: t("Disruptions allowed"), value: status.disruptionsAllowed },
          ]} />
      </div>
    </div>
  )
}

function ClusterControlDetailOverview({ resource }: { resource: KubeResource }) {
  const spec = asRecord(resource.spec)
  const status = asRecord(resource.status)
  const fields = Object.entries(resource).filter(([key]) => !["apiVersion", "kind", "metadata", "spec", "status"].includes(key))
  return (
    <div className="space-y-4">
      <SummaryRow>
        <SummaryCard label={t("Kind")} value={resource.kind} />
        <SummaryCard label={t("Version")} value={resource.apiVersion || spec.version} />
        <SummaryCard label={t("Available")} value={status.available ?? status.phase ?? asRecordList(status.conditions).find((item) => item.status === "True")?.type} />
        <SummaryCard label={t("Created")} value={resource.metadata.creationTimestamp} />
      </SummaryRow>
      <KvSection title={t("Fields")} rows={fields.map(([label, value]) => ({ label, value }))} />
      <div className="grid gap-4 xl:grid-cols-2">
        <KvSection title={t("Spec")} rows={Object.entries(spec).map(([label, value]) => ({ label, value }))} />
        <KvSection title={t("Status")} rows={Object.entries(status).map(([label, value]) => ({ label, value }))} />
      </div>
      <ValueSection title={t("Conditions")} value={status.conditions} />
    </div>
  )
}

/** Spec and status as readable key/value sections; used for CRDs without a dedicated layout. */
export function StructuredResourceOverview({ resource, sections, preserveEmpty = false }: { resource: KubeResource; sections: DetailSection[]; preserveEmpty?: boolean }) {
  const spec = asRecord(resource.spec)
  const status = asRecord(resource.status)
  const rows = (record: Record<string, unknown>, skip: string[] = []) =>
    Object.entries(record).filter(([key, value]) => !skip.includes(key) && (preserveEmpty ? value !== undefined : hasRenderableValue(value))).map(([key, value]) => ({ label: t(humanizeKey(key)), value }))
  // Kinds without spec/status (e.g. NetworkAttachmentDefinition config) still show their top-level fields.
  const topLevel = Object.fromEntries(Object.entries(resource).filter(([key]) => !["apiVersion", "kind", "metadata", "spec", "status"].includes(key)))
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <KvSection title={t("Spec")} rows={rows(spec)} preserveEmpty={preserveEmpty} />
        <KvSection title={t("Status")} rows={rows(status, ["conditions"])} preserveEmpty={preserveEmpty} />
      </div>
      <KvSection title={t("Details")} rows={rows(topLevel)} preserveEmpty={preserveEmpty} />
      <ValueSection title={t("Conditions")} value={status.conditions} />
      {sections.filter((section) => !["Metadata", "Status", "Spec"].some((title) => title === section.title || t(title) === section.title)).map((section) => (
        <KvSection key={section.title} title={t(section.title)} description={section.description && t(section.description)} rows={section.items.map((item) => ({ label: t(item.label), value: item.value }))} />
      ))}
    </div>
  )
}

export function ResourceSpecificOverview({ resource, config, sections }: { resource: KubeResource; config: ResourceConfig; sections: DetailSection[] }) {
  const kind = resource.kind || config.kind
  if (kind === "Pod") return <PodDetailOverview resource={resource} />
  if (["Deployment", "StatefulSet", "ReplicaSet", "ReplicationController"].includes(kind)) return <WorkloadDetailOverview resource={resource} />
  if (kind === "Node") return <NodeDetailOverview resource={resource} />
  if (["MutatingWebhookConfiguration", "ValidatingWebhookConfiguration", "ValidatingAdmissionPolicy", "ValidatingAdmissionPolicyBinding"].includes(kind)) return <AdmissionDetailOverview resource={resource} />
  if (["Role", "ClusterRole", "RoleBinding", "ClusterRoleBinding", "ServiceAccount"].includes(kind)) return <RbacDetailOverview resource={resource} />
  if (["ConfigMap", "Secret"].includes(kind)) return <ConfigDetailOverview resource={resource} />
  if (["Endpoints", "EndpointSlice"].includes(kind)) return <StructuredResourceOverview resource={resource} sections={[]} />
  if (["LimitRange", "ResourceQuota", "PodDisruptionBudget"].includes(kind)) return <PolicyDetailOverview resource={resource} />
  if (["APIService", "CustomResourceDefinition", "ComponentStatus", "Namespace", "Lease", "CertificateSigningRequest", "FlowSchema", "PriorityLevelConfiguration", "RuntimeClass", "PriorityClass", "Event"].includes(kind)) return <ClusterControlDetailOverview resource={resource} />
  if (["Service", "Ingress", "IngressClass", "NetworkPolicy", "Gateway", "GatewayClass", "HTTPRoute"].includes(kind)) return <NetworkDetailOverview resource={resource} />
  if (["PersistentVolume", "PersistentVolumeClaim", "StorageClass"].includes(kind)) return <StorageDetailOverview resource={resource} />
  if (["VirtualMachine", "VirtualMachineInstance"].includes(kind)) return <VirtualizationDetailOverview resource={resource} />
  return <StructuredResourceOverview resource={resource} sections={sections} />
}
