import { useEffect, useMemo, useState, type ReactNode } from "react"
import { Link, useNavigate } from "react-router-dom"
import { toast } from "sonner"
import * as YAML from "js-yaml"
import {
  Check,
  Cpu,
  HardDrive,
  Image as ImageIcon,
  KeyRound,
  MoreHorizontal,
  Network,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Square,
  Trash2,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  ChoiceCard,
  Combobox,
  ConfirmDialog,
  EmptyState,
  FieldRow,
  FilterInput,
  KeyValueGrid,
  LoadingState,
  NativeSelect,
  PageHeader,
  Pager,
  StatusDot,
  Toolbar,
  Panel,
} from "@/components/console"
import { namespaceScope, useFilteredRows, usePaged, type FilterField } from "@/lib/filter"
import {
  asList,
  asRecord,
  kubeOvnAnnotations,
  listItems,
  namespacedPath,
  relativeTime,
  requestJson,
  str,
  subnetUsage,
  useAsync,
  useDiscovery,
  useNamespaces,
  useNetworkProfile,
  type KubeObject,
} from "@/lib/kube"
import { engineLabel, isGlobalGroup, listSecurityGroups, parseSgSelection, sgRefKey, sgSelectionKey, useSgProvider, vmSecurityGroupRefs, type SecurityGroup } from "@/lib/security-groups"
import { fetchInstanceUsage, formatBytes, useMetricsPoll } from "@/lib/metrics"
import { cidrContains, ipv4Cidr, isDnsLabel, isQuantity } from "@/lib/validate"
import { bandwidthProblem, bandwidthText, canUseReservedIp, listAttachableNetworks, nextNicName, type AttachableNetwork } from "@/lib/vm-network"
import { buildVirtualMachine, vmDetailPath, vmNetworkLabel, vmShape, vmStatus, vmStatusGroup, type WizardState } from "@/lib/instances"
import { t } from "@/lib/i18n"
import { usePolling } from "@/lib/polling"
import { jsonPut } from "@/resources/configs"

const VM_API = "/apis/kubevirt.io/v1"
const SUB_API = "/apis/subresources.kubevirt.io/v1"
const vmAction = async (vm: KubeObject, action: "start" | "stop" | "restart") =>
  requestJson(`${SUB_API}/namespaces/${vm.metadata.namespace}/virtualmachines/${vm.metadata.name}/${action}`, jsonPut())

const vmDelete = async (vm: KubeObject) =>
  requestJson(`${VM_API}/namespaces/${vm.metadata.namespace}/virtualmachines/${vm.metadata.name}`, { method: "DELETE" })

// --- Instance list ---

type PowerAction = "start" | "stop" | "restart"
type PowerRequest = { action: PowerAction; vms: KubeObject[] }
const powerLabel: Record<PowerAction, string> = { start: "Start", stop: "Stop", restart: "Restart" }

const statusTabs = [
  { id: "all", label: "All" },
  { id: "running", label: "Running" },
  { id: "stopped", label: "Stopped" },
  { id: "transitioning", label: "In progress" },
  { id: "error", label: "Error" },
] as const

type InstanceRow = {
  vm: KubeObject
  key: string
  status: string
  ips: string[]
  node: string
  shape: ReturnType<typeof vmShape>
  network: ReturnType<typeof vmNetworkLabel>
  vpc: string
  groups: ReturnType<typeof vmSecurityGroupRefs>
}

const instanceFields: FilterField<InstanceRow>[] = [
  { key: "name", label: "Name", value: (row) => row.vm.metadata.name },
  { key: "namespace", label: "Namespace", aliases: ["ns"], value: (row) => row.vm.metadata.namespace },
  { key: "status", label: "Status", value: (row) => row.status },
  { key: "ip", label: "IP address", value: (row) => row.ips },
  { key: "spec", label: "Spec", value: (row) => [row.shape.label, row.shape.detail] },
  { key: "network", label: "Network", aliases: ["subnet"], value: (row) => row.network.label },
  { key: "vpc", label: "VPC", value: (row) => row.vpc },
  { key: "sg", label: "Security groups", value: (row) => row.groups.map((group) => group.name) },
  { key: "host", label: "Host", aliases: ["node"], value: (row) => row.node },
  { key: "label", label: "Labels", value: (row) => Object.entries(row.vm.metadata.labels || {}).map(([name, value]) => `${name}=${value}`) },
]

export function InstanceListPage() {
  const namespaces = useNamespaces()
  const profile = useNetworkProfile()
  const { provider, providers } = useSgProvider()
  const [namespace, setNamespace] = useState(() => {
    const stored = readLocal("instances-namespace")
    return stored === "all" ? "" : stored || ""
  })
  const ns = useMemo(() => namespaceScope(namespace, namespaces), [namespace, namespaces])
  const scope = ns.scope
  const [statusTab, setStatusTab] = useState<(typeof statusTabs)[number]["id"]>("all")
  const [search, setSearch] = useState("")
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [deleting, setDeleting] = useState<KubeObject[] | null>(null)
  const [powering, setPowering] = useState<PowerRequest | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    try {
      localStorage.setItem("instances-namespace", namespace)
    } catch {
      // Remembering the namespace is a convenience only.
    }
  }, [namespace])

  const { data, loading, reload } = useAsync(async () => {
    const [vms, vmis, types, subnets] = await Promise.all([
      listItems(namespacedPath(VM_API, "virtualmachines", scope)),
      listItems(namespacedPath(VM_API, "virtualmachineinstances", scope)),
      listItems("/apis/instancetype.kubevirt.io/v1beta1/virtualmachineclusterinstancetypes"),
      profile.vpc ? listItems("/apis/kubeovn.io/v1/subnets").catch(() => [] as KubeObject[]) : Promise.resolve([] as KubeObject[]),
    ])
    const instanceTypes = Object.fromEntries(types.map((type) => [type.metadata.name, { cpu: Number(asRecord(asRecord(type.spec).cpu).guest || 0), memory: str(asRecord(asRecord(type.spec).memory).guest) }]))
    const vpcBySubnet = Object.fromEntries(subnets.map((subnet) => [subnet.metadata.name, str(asRecord(subnet.spec).vpc, "ovn-cluster")]))
    return { vms, vmis, instanceTypes, vpcBySubnet }
  }, { vms: [] as KubeObject[], vmis: [] as KubeObject[], instanceTypes: {} as Record<string, { cpu: number; memory: string }>, vpcBySubnet: {} as Record<string, string> }, [scope, profile.vpc])

  usePolling(reload, 15000)

  // Live CPU and memory of virt-launcher pods; null when metrics-server is not installed.
  const usage = useMetricsPoll(() => fetchInstanceUsage(scope), [scope])
  const key = (vm: KubeObject) => `${vm.metadata.namespace}/${vm.metadata.name}`

  // One row model per VM, built once per reload, so filtering and rendering share it.
  const allRows = useMemo(() => {
    const vmiByKey = Object.fromEntries(data.vmis.map((vmi) => [`${vmi.metadata.namespace}/${vmi.metadata.name}`, vmi]))
    return data.vms
      .filter((vm) => ns.match(vm.metadata.namespace))
      .map((vm): InstanceRow => {
        const vmiStatus = asRecord(vmiByKey[key(vm)]?.status)
        return {
          vm,
          key: key(vm),
          status: vmStatus(vm),
          ips: asList(vmiStatus.interfaces).map((iface) => str(iface.ipAddress)).filter(Boolean),
          node: str(vmiStatus.nodeName),
          shape: vmShape(vm, data.instanceTypes),
          network: vmNetworkLabel(vm),
          vpc: data.vpcBySubnet[vmNetworkLabel(vm).label] || "",
          groups: vmSecurityGroupRefs(vm, providers),
        }
      })
      .sort((a, b) => a.vm.metadata.name.localeCompare(b.vm.metadata.name))
  }, [data, ns, providers])

  const counts = useMemo(() => {
    const result: Record<string, number> = { all: allRows.length, running: 0, stopped: 0, transitioning: 0, error: 0 }
    allRows.forEach((row) => { result[vmStatusGroup(row.status)]++ })
    return result
  }, [allRows])

  const tabRows = useMemo(() => (statusTab === "all" ? allRows : allRows.filter((row) => vmStatusGroup(row.status) === statusTab)), [allRows, statusTab])
  const rows = useFilteredRows(tabRows, instanceFields, search)
  const { rows: pageRows, ...paging } = usePaged(rows)

  const selectedVms = rows.filter((row) => selected[row.key]).map((row) => row.vm)
  const allSelected = rows.length > 0 && selectedVms.length === rows.length

  const runActions = async ({ action, vms }: PowerRequest) => {
    setBusy(true)
    try {
      const results = await Promise.allSettled(vms.map((vm) => vmAction(vm, action)))
      const failed = results.flatMap((result, index) => result.status === "rejected" ? [`${vms[index].metadata.name}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`] : [])
      if (failed.length) toast.error(t("{action} failed for {failed} of {total}", { action: t(powerLabel[action]), failed: failed.length, total: vms.length }), { description: failed.slice(0, 5).join("\n") })
      setSelected({})
      reload()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("Instances")}
        actions={
          <Button asChild className="gap-1.5">
            <Link to="/kubevirt/virtualization/virtual-machines/create"><Plus className="size-4" />{t("Create instance")}</Link>
          </Button>
        }
      />

      <div className="flex flex-wrap gap-1 border-b">
        {statusTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setStatusTab(tab.id)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              statusTab === tab.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t(tab.label)}
            <span className="rounded-md bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">{counts[tab.id]}</span>
          </button>
        ))}
      </div>

      <Toolbar
        right={<FilterInput value={search} onChange={setSearch} fields={instanceFields} rows={tabRows} placeholder={t("Filter, e.g. web ip:10.0 host:node-1")} />}
      >
        <Button size="sm" variant="outline" onClick={reload} className="gap-2"><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />{t("Refresh")}</Button>
        <Combobox value={namespace} onChange={setNamespace} options={namespaces} placeholder={t("All namespaces")} aria-label={t("Namespace")} />
        {selectedVms.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 px-2 py-1">
            <span className="text-sm text-muted-foreground">{selectedVms.length} selected</span>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setPowering({ action: "start", vms: selectedVms })} className="gap-1.5"><Play className="size-3.5" />{t("Start")}</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setPowering({ action: "stop", vms: selectedVms })} className="gap-1.5"><Square className="size-3.5" />{t("Stop")}</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setPowering({ action: "restart", vms: selectedVms })} className="gap-1.5"><RotateCcw className="size-3.5" />{t("Restart")}</Button>
            <Button size="sm" variant="destructive" disabled={busy} onClick={() => setDeleting(selectedVms)} className="gap-1.5"><Trash2 className="size-3.5" />{t("Delete")}</Button>
          </div>
        )}
      </Toolbar>

      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] caption-bottom text-sm">
            <thead className="bg-muted/50">
              <tr className="border-b">
                <th className="h-9 w-10 px-3 text-left">
                  <input type="checkbox" className="size-4 accent-primary" aria-label={t("Select all instances")} checked={allSelected} onChange={(e) => setSelected(e.target.checked ? Object.fromEntries(rows.map((row) => [row.key, true])) : {})} />
                </th>
                {["Name", "Status", "IP address", "Spec", usage ? "Usage" : null, "Network", provider ? "Security groups" : null, "Host", "Created", ""].filter((header) => header !== null).map((header, index) => (
                  <th key={index} className={cn("h-10 px-3 text-left text-xs font-medium text-muted-foreground", header === "Created" && "text-right")}>{header && t(header)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && data.vms.length === 0 ? (
                <tr><td colSpan={11}><LoadingState /></td></tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={11}>
                    <EmptyState
                      icon={Cpu}
                      title={allRows.length === 0 && !namespace ? t("No instances yet") : t("No matching instances")}
                      action={allRows.length === 0 && !namespace && <Button asChild size="sm"><Link to="/kubevirt/virtualization/virtual-machines/create">{t("Create instance")}</Link></Button>}
                    />
                  </td>
                </tr>
              ) : pageRows.map(({ vm, ips, shape, network, vpc, status, groups, node }) => {
                return (
                  <tr key={key(vm)} className="border-b transition-colors last:border-0 hover:bg-muted/40">
                    <td className="px-3 py-2">
                      <input type="checkbox" className="size-4 accent-primary" aria-label={t("Select {v0}", { v0: vm.metadata.name })} checked={Boolean(selected[key(vm)])} onChange={(e) => setSelected((current) => ({ ...current, [key(vm)]: e.target.checked }))} />
                    </td>
                    <td className="px-3 py-2">
                      <Link to={vmDetailPath(vm)} className="font-medium hover:text-primary transition-colors">{vm.metadata.name}</Link>
                      <div className="text-xs text-muted-foreground">{vm.metadata.namespace}</div>
                    </td>
                    <td className="px-3 py-2"><StatusDot status={status} /></td>
                    <td className="px-3 py-2 font-mono text-xs">{ips.length ? ips.map((ip) => <div key={ip}>{ip}</div>) : <span className="text-muted-foreground">-</span>}</td>
                    <td className="px-3 py-2">
                      <div className="text-sm">{shape.label}</div>
                      <div className="text-xs text-muted-foreground">{shape.detail}</div>
                    </td>
                    {usage && (
                      <td className="px-3 py-2 text-xs tabular-nums">
                        {usage[key(vm)] ? (
                          <>
                            <div>{t("{n} cores", { n: usage[key(vm)].cpuCores.toFixed(2) })}</div>
                            <div className="text-muted-foreground">{formatBytes(usage[key(vm)].memoryBytes)}</div>
                          </>
                        ) : <span className="text-muted-foreground">-</span>}
                      </td>
                    )}
                    <td className="px-3 py-2">
                      {network.kind === "subnet" ? (
                        <Link to={`/vpc/subnets/${network.label}`} className="text-sm hover:text-primary transition-colors">{network.label}</Link>
                      ) : (
                        <span className={cn("text-sm", network.kind === "pod" && "text-muted-foreground")}>{network.label}</span>
                      )}
                      {vpc && <div className="text-xs text-muted-foreground">{t("VPC {vpc}", { vpc })}</div>}
                    </td>
                    {provider && (
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {groups.length ? groups.map((group) => (
                            <Badge key={sgRefKey(group)} variant="outline" title={group.global ? t("Cluster wide") : engineLabel[group.provider]}>
                              {group.name}
                            </Badge>
                          )) : <span className="text-sm text-muted-foreground">-</span>}
                        </div>
                      </td>
                    )}
                    <td className="px-3 py-2 text-sm text-muted-foreground">{node || "-"}</td>
                    <td className="px-3 py-2 text-right text-sm text-muted-foreground tabular-nums">{relativeTime(vm.metadata.creationTimestamp)}</td>
                    <td className="px-3 py-2 text-right">
                      <InstanceRowMenu vm={vm} running={vmStatusGroup(status) === "running"} onPower={(action) => setPowering({ action, vms: [vm] })} onDelete={() => setDeleting([vm])} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <Pager {...paging} />
      </div>

      <ConfirmDialog
        open={powering !== null}
        onOpenChange={(open) => !open && setPowering(null)}
        title={powering && powering.vms.length > 1
          ? t(`${powerLabel[powering.action]} {count} instances?`, { count: powering.vms.length })
          : t(`${powerLabel[powering?.action || "start"]} instance {name}?`, { name: powering?.vms[0]?.metadata.name })}
        description={powering?.action === "stop" ? t("The guest OS is asked to shut down.") : powering?.action === "restart" ? t("The guest OS is restarted.") : undefined}
        confirmLabel={t(powerLabel[powering?.action || "start"])}
        onConfirm={async () => {
          if (powering) await runActions(powering)
        }}
      >
        {powering && powering.vms.length > 1 && (
          <div className="max-h-40 overflow-y-auto rounded-lg border bg-muted/30 p-2 text-sm">
            {powering.vms.map((vm) => <div key={key(vm)}>{vm.metadata.namespace}/{vm.metadata.name}</div>)}
          </div>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={deleting && deleting.length > 1 ? t("Delete {count} instances?", { count: deleting.length }) : t("Delete instance {name}?", { name: deleting?.[0]?.metadata.name })}
        description={t("The instance and the disks created with it are deleted. This cannot be undone.")}
        destructive
        confirmLabel={t("Delete")}
        onConfirm={async () => {
          const results = await Promise.allSettled((deleting || []).map(vmDelete))
          setSelected({})
          reload()
          const failed = results.find((result) => result.status === "rejected")
          if (failed && failed.status === "rejected") throw failed.reason
        }}
      >
        {deleting && deleting.length > 1 && (
          <div className="max-h-40 overflow-y-auto rounded-lg border bg-muted/30 p-2 text-sm">
            {deleting.map((vm) => <div key={key(vm)}>{vm.metadata.namespace}/{vm.metadata.name}</div>)}
          </div>
        )}
      </ConfirmDialog>
    </div>
  )
}

function InstanceRowMenu({ vm, running, onPower, onDelete }: { vm: KubeObject; running: boolean; onPower: (action: PowerAction) => void; onDelete: () => void }) {
  const navigate = useNavigate()
  const run = onPower
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" aria-label={t("Actions for {v0}", { v0: vm.metadata.name })}><MoreHorizontal className="size-4" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={running} onClick={() => run("start")}><Play />{t("Start")}</DropdownMenuItem>
        <DropdownMenuItem disabled={!running} onClick={() => run("stop")}><Square />{t("Stop")}</DropdownMenuItem>
        <DropdownMenuItem disabled={!running} onClick={() => run("restart")}><RotateCcw />{t("Restart")}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!running} onClick={() => navigate(vmDetailPath(vm, "console"))}>{t("Serial console")}</DropdownMenuItem>
        <DropdownMenuItem disabled={!running} onClick={() => navigate(vmDetailPath(vm, "vnc"))}>{t("VNC")}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate(vmDetailPath(vm, "manifest"))}>{t("View YAML")}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onDelete}><Trash2 />{t("Delete")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// --- Create wizard ---

const shapePresets = [
  { cpu: 1, memory: "2Gi", label: "1 vCPU / 2 GiB", hint: "Small" },
  { cpu: 2, memory: "4Gi", label: "2 vCPU / 4 GiB", hint: "General" },
  { cpu: 4, memory: "8Gi", label: "4 vCPU / 8 GiB", hint: "General" },
  { cpu: 4, memory: "16Gi", label: "4 vCPU / 16 GiB", hint: "Memory" },
  { cpu: 8, memory: "16Gi", label: "8 vCPU / 16 GiB", hint: "Compute" },
  { cpu: 8, memory: "32Gi", label: "8 vCPU / 32 GiB", hint: "General" },
]

const steps = [
  { id: "basics", label: "Basics", icon: Cpu },
  { id: "image", label: "Image & disks", icon: ImageIcon },
  { id: "network", label: "Network & security", icon: Network },
  { id: "access", label: "Login", icon: KeyRound },
  { id: "review", label: "Review", icon: Check },
] as const

type StepId = (typeof steps)[number]["id"]

const readLocal = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function StepSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Panel title={title} description={description} bodyClassName="space-y-4">{children}</Panel>
  )
}

export function CreateInstancePage() {
  const navigate = useNavigate()
  const namespaces = useNamespaces()
  const profile = useNetworkProfile()
  const discovery = useDiscovery()
  const cdiAvailable = discovery.hasResource("cdi.kubevirt.io/v1beta1", "datavolumes")
  const { provider: defaultEngine, providers: engines } = useSgProvider()
  const [step, setStep] = useState<StepId>("basics")
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState("")
  const [state, setState] = useState<WizardState>(() => ({
    name: `vm-${Math.random().toString(36).slice(2, 7)}`,
    // The list stores "" (or the legacy "all") for all namespaces; a new instance needs a concrete one.
    namespace: [null, "", "all"].includes(readLocal("instances-namespace")) ? "default" : readLocal("instances-namespace") as string,
    description: "",
    startAfterCreate: true,
    specMode: "custom",
    instanceType: "",
    cpu: 2,
    memory: "4Gi",
    imageSource: "datasource",
    dataSource: "",
    registryUrl: "quay.io/containerdisks/ubuntu:24.04",
    httpUrl: "",
    containerDisk: "quay.io/containerdisks/fedora:latest",
    pvcName: "",
    rootSize: "20Gi",
    storageClass: "",
    dataDisks: [],
    vpc: "",
    subnet: "",
    fixedIp: "",
    reservedIp: "",
    bandwidth: { ingress: "", egress: "" },
    extraNics: [],
    binding: profile.vpc ? "bridge" : "masquerade",
    sgEngine: null,
    securityGroups: [],
    username: "cloud-user",
    password: "",
    sshKey: "",
  }))
  const set = (patch: Partial<WizardState>) => setState((current) => ({ ...current, ...patch }))
  const [ipMode, setIpMode] = useState<"auto" | "fixed" | "reserved">("auto")
  const aclProvider = state.sgEngine && engines.includes(state.sgEngine) ? state.sgEngine : defaultEngine

  const { data: catalog, loading: catalogLoading } = useAsync(async () => {
    const [instanceTypes, dataSources, storageClasses, vpcs, subnets, pvcs, vips, vms] = await Promise.all([
      listItems("/apis/instancetype.kubevirt.io/v1beta1/virtualmachineclusterinstancetypes"),
      listItems("/apis/cdi.kubevirt.io/v1beta1/datasources"),
      listItems("/apis/storage.k8s.io/v1/storageclasses"),
      profile.vpc ? listItems("/apis/kubeovn.io/v1/vpcs") : Promise.resolve([]),
      profile.kubeOvnInstalled ? listItems("/apis/kubeovn.io/v1/subnets") : Promise.resolve([]),
      listItems(`/api/v1/namespaces/${state.namespace}/persistentvolumeclaims`),
      profile.vpc ? listItems("/apis/kubeovn.io/v1/vips") : Promise.resolve([]),
      profile.vpc ? listItems(`${VM_API}/virtualmachines`) : Promise.resolve([]),
    ])
    const networks = await listAttachableNetworks(subnets)
    return { instanceTypes, dataSources, storageClasses, vpcs, subnets, pvcs, vips, vms, networks }
  }, { instanceTypes: [] as KubeObject[], dataSources: [] as KubeObject[], storageClasses: [] as KubeObject[], vpcs: [] as KubeObject[], subnets: [] as KubeObject[], pvcs: [] as KubeObject[], vips: [] as KubeObject[], vms: [] as KubeObject[], networks: [] as AttachableNetwork[] }, [profile.vpc, profile.kubeOvnInstalled, state.namespace])

  const { data: securityGroups } = useAsync(
    async () => aclProvider ? (await listSecurityGroups(aclProvider, state.namespace)).filter((sg) => sg.managed) : [],
    [] as SecurityGroup[],
    [aclProvider, state.namespace],
  )

  // Sensible defaults once catalog data arrives.
  const [defaults, setDefaults] = useState({ dataSources: catalog.dataSources, vpcs: catalog.vpcs, loading: catalogLoading, vpc: profile.vpc, cdi: cdiAvailable, discoveryLoaded: discovery.loaded })
  if (catalog.dataSources !== defaults.dataSources || catalog.vpcs !== defaults.vpcs || catalogLoading !== defaults.loading || profile.vpc !== defaults.vpc || cdiAvailable !== defaults.cdi || discovery.loaded !== defaults.discoveryLoaded) {
    setDefaults({ dataSources: catalog.dataSources, vpcs: catalog.vpcs, loading: catalogLoading, vpc: profile.vpc, cdi: cdiAvailable, discoveryLoaded: discovery.loaded })
    setState((current) => {
      const next = { ...current }
      if (!current.dataSource && catalog.dataSources.length) next.dataSource = `${catalog.dataSources[0].metadata.namespace}/${catalog.dataSources[0].metadata.name}`
      if (discovery.loaded && !catalogLoading && !catalog.dataSources.length && current.imageSource === "datasource") next.imageSource = cdiAvailable ? "registry" : "containerdisk"
      if (discovery.loaded && !cdiAvailable) { next.imageSource = "containerdisk"; next.dataDisks = [] }
      if (profile.vpc && !current.vpc && catalog.vpcs.length) next.vpc = catalog.vpcs.find((vpc) => asRecord(vpc.status).default === true)?.metadata.name || catalog.vpcs[0].metadata.name
      // Kube-OVN subnets are routable, so let the guest own the subnet address by default.
      if (profile.vpc && !defaults.vpc) next.binding = "bridge"
      return next
    })
  }

  // Kube-OVN refuses pods from namespaces outside a custom VPC's spec.namespaces list.
  const vpcAllowsNamespace = (vpc: KubeObject) => {
    const allowed = (asRecord(vpc.spec).namespaces as string[] | undefined) || []
    return asRecord(vpc.status).default === true || allowed.length === 0 || allowed.includes(state.namespace)
  }
  const usableVpcs = catalog.vpcs.filter(vpcAllowsNamespace)
  const vpcSubnets = catalog.subnets.filter((subnet) => str(asRecord(subnet.spec).vpc, "ovn-cluster") === state.vpc && str(asRecord(subnet.spec).provider, "ovn") === "ovn" && subnet.metadata.name !== "join")
  const selectedSubnet = catalog.subnets.find((subnet) => subnet.metadata.name === state.subnet)
  const subnetCidr = ipv4Cidr(str(asRecord(selectedSubnet?.spec).cidrBlock))
  // Reserved IPs of the chosen subnet that this namespace may use and no other instance holds.
  const usedVips = new Set(catalog.vms.map((item) => str(asRecord(asRecord(asRecord(asRecord(item.spec).template).metadata).annotations)[kubeOvnAnnotations.vip])).filter(Boolean))
  const freeVips = catalog.vips.filter((vip) => canUseReservedIp(vip, state.subnet, state.namespace, usedVips))
  const vipAddress = (vip?: KubeObject) => str(asRecord(vip?.status).v4ip) || str(asRecord(vip?.spec).v4ip)

  const defaultStorageClass = catalog.storageClasses.find((sc) => sc.metadata.annotations?.["storageclass.kubernetes.io/is-default-class"] === "true")?.metadata.name
  const vm = useMemo(() => buildVirtualMachine({ ...state, sgEngine: aclProvider }, profile.vpc), [state, aclProvider, profile.vpc])

  const problems: Partial<Record<StepId, string>> = {}
  if (!isDnsLabel(state.name)) problems.basics = t("Name must be at most 63 lowercase letters, digits and dashes, starting and ending with a letter or digit.")
  else if (!state.namespace) problems.basics = t("Choose a namespace.")
  else if (state.specMode === "instancetype" && !state.instanceType) problems.basics = t("Choose an instance type.")
  else if (state.specMode === "custom" && (!Number.isInteger(state.cpu) || state.cpu < 1)) problems.basics = t("vCPU must be a whole number of at least 1.")
  else if (state.specMode === "custom" && !isQuantity(state.memory)) problems.basics = t("Memory must be a quantity such as 4Gi.")
  if (discovery.loaded && !cdiAvailable && (state.imageSource !== "containerdisk" || state.dataDisks.length > 0)) problems.image = t("Persistent disks require CDI.")
  else if (state.imageSource === "datasource" && !state.dataSource) problems.image = t("Choose an image.")
  if (state.imageSource === "registry" && !state.registryUrl.trim()) problems.image = t("Enter a registry image.")
  if (state.imageSource === "http" && !/^https?:\/\//.test(state.httpUrl)) problems.image = t("Enter an http(s) URL.")
  if (state.imageSource === "containerdisk" && !state.containerDisk.trim()) problems.image = t("Enter a container disk image.")
  if (state.imageSource === "pvc" && !state.pvcName) problems.image = t("Choose a volume to clone.")
  if (!problems.image && state.imageSource !== "containerdisk" && !isQuantity(state.rootSize)) problems.image = t("System disk size must be a quantity such as 20Gi.")
  if (!problems.image && state.dataDisks.some((size) => !isQuantity(size))) problems.image = t("Data disk sizes must be quantities such as 50Gi.")
  if (profile.vpc && !vpcSubnets.some((subnet) => subnet.metadata.name === state.subnet)) problems.network = t("Choose a subnet.")
  else if (profile.vpc && catalog.vpcs.length > 0 && !usableVpcs.some((vpc) => vpc.metadata.name === state.vpc)) problems.network = t("VPC {vpc} does not allow namespace {namespace}.", { vpc: state.vpc, namespace: state.namespace })
  else if (profile.vpc && ipMode === "reserved" && !freeVips.some((vip) => vip.metadata.name === state.reservedIp)) problems.network = t("Choose a reserved IP.")
  else if (profile.vpc && ipMode === "fixed" && !state.fixedIp.trim()) problems.network = t("Enter a private IP.")
  else if (profile.vpc && state.fixedIp.trim() && subnetCidr && !cidrContains(subnetCidr, state.fixedIp)) problems.network = t("{ip} is not inside {cidr}.", { ip: state.fixedIp.trim(), cidr: subnetCidr })
  else if (profile.vpc && state.fixedIp.trim() && state.fixedIp.trim() === str(asRecord(selectedSubnet?.spec).gateway)) problems.network = t("The private IP cannot be the subnet gateway.")
  if (!problems.network && [state.bandwidth.ingress, state.bandwidth.egress].some((value) => bandwidthProblem(value))) problems.network = t("Bandwidth must be a whole number of Mbit/s, or empty for unlimited.")
  if (!problems.network && state.extraNics.some((nic) => !nic.network.value)) problems.network = t("Choose a network for each extra interface.")
  if (!state.password && !state.sshKey.trim()) problems.access = t("Set a password or an SSH key so you can log in.")

  const stepIndex = steps.findIndex((item) => item.id === step)
  const firstProblem = steps.find((item) => problems[item.id])

  const create = async () => {
    if (firstProblem) {
      setStep(firstProblem.id)
      return
    }
    setCreating(true)
    setError("")
    try {
      await requestJson(`${VM_API}/namespaces/${state.namespace}/virtualmachines`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(vm) })
      navigate(`/kubevirt/virtualization/virtual-machines/${state.namespace}/${state.name}/overview`)
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Failed to create instance"))
    } finally {
      setCreating(false)
    }
  }

  const selectedType = catalog.instanceTypes.find((type) => type.metadata.name === state.instanceType)
  const summary = [
    { label: t("Name"), value: `${state.namespace}/${state.name}` },
    {
      label: t("Spec"),
      value: state.specMode === "instancetype"
        ? `${state.instanceType || "N/A"}${selectedType ? ` (${str(asRecord(asRecord(selectedType.spec).cpu).guest)} vCPU / ${str(asRecord(asRecord(selectedType.spec).memory).guest)})` : ""}`
        : `${state.cpu} vCPU / ${state.memory}`,
    },
    {
      label: t("Image"),
      value: state.imageSource === "datasource" ? state.dataSource : state.imageSource === "registry" ? state.registryUrl : state.imageSource === "http" ? state.httpUrl : state.imageSource === "pvc" ? t("Clone of {name}", { name: state.pvcName }) : `${state.containerDisk} (${t("ephemeral")})`,
    },
    { label: t("System disk"), value: state.imageSource === "containerdisk" ? "Ephemeral" : t("{size} on {storageClass}", { size: state.rootSize, storageClass: state.storageClass || defaultStorageClass || t("default class") }) },
    { label: t("Data disks"), value: state.dataDisks.length ? state.dataDisks.join(", ") : "None" },
    { label: t("Network"), value: profile.vpc ? `${state.vpc} / ${state.subnet || "N/A"}${state.reservedIp ? ` (${vipAddress(catalog.vips.find((vip) => vip.metadata.name === state.reservedIp)) || state.reservedIp})` : state.fixedIp ? ` (${state.fixedIp})` : ""}` : "Pod network" },
    ...(state.extraNics.length ? [{ label: t("Extra interfaces"), value: state.extraNics.map((nic) => nic.network.subnet || nic.network.nad).join(", ") }] : []),
    ...(profile.vpc && (state.bandwidth.ingress || state.bandwidth.egress) ? [{ label: t("Bandwidth"), value: t("In {ingress} / out {egress}", { ingress: bandwidthText(state.bandwidth.ingress) || t("Unlimited"), egress: bandwidthText(state.bandwidth.egress) || t("Unlimited") }) }] : []),
    { label: t("Interface binding"), value: state.binding },
    { label: t("Security groups"), value: aclProvider ? `${state.securityGroups.map((key) => parseSgSelection(key).name).join(", ") || t("None")}${engines.length > 1 ? ` (${engineLabel[aclProvider]})` : ""}` : t("Not available") },
    { label: t("Login"), value: `${state.username || t("default user")}${state.password ? ` / ${t("password")}` : ""}${state.sshKey.trim() ? ` / ${t("SSH key")}` : ""}` },
    { label: t("Power on"), value: state.startAfterCreate ? "After creation" : "Stay stopped" },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: t("Instances"), to: "/kubevirt/virtualization/virtual-machines" }, { label: t("Create") }]}
        title={t("Create instance")}
      />

      <div className="grid gap-6 lg:grid-cols-[220px_1fr_300px]">
        <nav className="flex gap-1 overflow-x-auto lg:flex-col">
          {steps.map((item, index) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setStep(item.id)}
              className={cn(
                "flex shrink-0 items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                step === item.id ? "bg-primary/10 text-primary font-semibold" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              )}
            >
              <span className={cn("flex size-6 items-center justify-center rounded-full border text-xs tabular-nums", step === item.id ? "border-primary" : index < stepIndex && !problems[item.id] ? "border-green-500 text-green-600 dark:text-green-400" : "")}>
                {index < stepIndex && !problems[item.id] ? <Check className="size-3.5" /> : index + 1}
              </span>
              {t(item.label)}
              {problems[item.id] && index < stepIndex && <span className="size-2 rounded-full bg-red-500" />}
            </button>
          ))}
        </nav>

        <div className="min-w-0 space-y-4">
          {step === "basics" && (
            <>
              <StepSection title={t("Instance details")}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FieldRow label={t("Name")} hint={t("Lowercase letters, digits and dashes.")}><Input value={state.name} onChange={(e) => set({ name: e.target.value.toLowerCase() })} /></FieldRow>
                  <FieldRow label={t("Namespace (project)")}>
                    <NativeSelect value={state.namespace} onChange={(e) => set({ namespace: e.target.value, securityGroups: [], pvcName: "", reservedIp: "" })}>
                      {Array.from(new Set([state.namespace, ...namespaces])).map((ns) => <option key={ns} value={ns}>{ns}</option>)}
                    </NativeSelect>
                  </FieldRow>
                  <div className="sm:col-span-2">
                    <FieldRow label={t("Description")}><Input value={state.description} onChange={(e) => set({ description: e.target.value })} placeholder={t("Optional")} /></FieldRow>
                  </div>
                </div>
              </StepSection>
              <StepSection title={t("Spec")}>
                <div className="grid gap-2 sm:grid-cols-2">
                  <ChoiceCard selected={state.specMode === "custom"} onClick={() => set({ specMode: "custom" })} title={t("Custom")} description={t("Set vCPU and memory")} />
                  <ChoiceCard selected={state.specMode === "instancetype"} onClick={() => set({ specMode: "instancetype" })} disabled={catalog.instanceTypes.length === 0} title={t("Instance type")} description={catalog.instanceTypes.length ? t("{count} cluster instance types", { count: catalog.instanceTypes.length }) : t("No cluster instance types found")} />
                </div>
                {state.specMode === "custom" ? (
                  <>
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {shapePresets.map((preset) => (
                        <ChoiceCard key={preset.label} selected={state.cpu === preset.cpu && state.memory === preset.memory} onClick={() => set({ cpu: preset.cpu, memory: preset.memory })} title={t(preset.label)} description={t(preset.hint)} />
                      ))}
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <FieldRow label={t("vCPU")}><Input type="number" min={1} value={state.cpu} onChange={(e) => set({ cpu: Math.max(1, Number(e.target.value) || 1) })} /></FieldRow>
                      <FieldRow label={t("Memory")}><Input value={state.memory} onChange={(e) => set({ memory: e.target.value })} placeholder={t("4Gi")} /></FieldRow>
                    </div>
                  </>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {catalog.instanceTypes.map((type) => (
                      <ChoiceCard
                        key={type.metadata.name}
                        selected={state.instanceType === type.metadata.name}
                        onClick={() => set({ instanceType: type.metadata.name })}
                        title={type.metadata.name}
                        description={t("{v0} vCPU / {v1}", { v0: str(asRecord(asRecord(type.spec).cpu).guest, "?"), v1: str(asRecord(asRecord(type.spec).memory).guest, "?") })}
                      />
                    ))}
                  </div>
                )}
              </StepSection>
            </>
          )}

          {step === "image" && (
            <>
              <StepSection title={t("Image")}>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  <ChoiceCard selected={state.imageSource === "datasource"} onClick={() => set({ imageSource: "datasource" })} disabled={catalog.dataSources.length === 0} icon={ImageIcon} title={t("Public image")} description={catalog.dataSources.length ? t("Images published as DataSources") : t("No DataSources found")} />
                  <ChoiceCard selected={state.imageSource === "registry"} disabled={!cdiAvailable} onClick={() => set({ imageSource: "registry" })} icon={ImageIcon} title={t("Registry image")} description={t("Import a containerdisk into a persistent disk")} />
                  <ChoiceCard selected={state.imageSource === "http"} disabled={!cdiAvailable} onClick={() => set({ imageSource: "http" })} icon={ImageIcon} title={t("Image URL")} description={t("Import a qcow2/raw image over HTTP")} />
                  <ChoiceCard selected={state.imageSource === "pvc"} disabled={!cdiAvailable} onClick={() => set({ imageSource: "pvc" })} icon={HardDrive} title={t("Clone a volume")} description={t("Copy an existing disk in this namespace")} />
                  <ChoiceCard selected={state.imageSource === "containerdisk"} onClick={() => set({ imageSource: "containerdisk" })} icon={ImageIcon} title={t("Ephemeral")} description={t("Boot a containerdisk; changes are lost on stop")} />
                </div>
                {discovery.loaded && !cdiAvailable && <p className="text-sm text-muted-foreground">{t("Persistent disks require CDI.")}</p>}
                {state.imageSource === "datasource" && (
                  <FieldRow label={t("Image")}>
                    <NativeSelect value={state.dataSource} onChange={(e) => set({ dataSource: e.target.value })}>
                      {catalog.dataSources.map((ds) => {
                        const value = `${ds.metadata.namespace}/${ds.metadata.name}`
                        return <option key={value} value={value}>{ds.metadata.name} ({ds.metadata.namespace})</option>
                      })}
                    </NativeSelect>
                  </FieldRow>
                )}
                {state.imageSource === "registry" && <FieldRow label={t("Registry image")} hint={t("For example quay.io/containerdisks/ubuntu:24.04")}><Input value={state.registryUrl} onChange={(e) => set({ registryUrl: e.target.value })} /></FieldRow>}
                {state.imageSource === "http" && <FieldRow label={t("Image URL")}><Input value={state.httpUrl} onChange={(e) => set({ httpUrl: e.target.value })} placeholder={t("https://cloud-images.ubuntu.com/.../ubuntu.img")} /></FieldRow>}
                {state.imageSource === "containerdisk" && <FieldRow label={t("Container disk")}><Input value={state.containerDisk} onChange={(e) => set({ containerDisk: e.target.value })} /></FieldRow>}
                {state.imageSource === "pvc" && (
                  <FieldRow label={t("Source volume")}>
                    <NativeSelect value={state.pvcName} onChange={(e) => set({ pvcName: e.target.value })}>
                      <option value="">{t("Select a volume")}</option>
                      {catalog.pvcs.map((pvc) => <option key={pvc.metadata.name} value={pvc.metadata.name}>{pvc.metadata.name} ({str(asRecord(asRecord(asRecord(pvc.spec).resources).requests).storage)})</option>)}
                    </NativeSelect>
                  </FieldRow>
                )}
              </StepSection>
              <StepSection title={t("Disks")}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FieldRow label={t("System disk size")}><Input value={state.rootSize} disabled={state.imageSource === "containerdisk"} onChange={(e) => set({ rootSize: e.target.value })} /></FieldRow>
                  <FieldRow label={t("Storage class")}>
                    <NativeSelect value={state.storageClass} onChange={(e) => set({ storageClass: e.target.value })}>
                      <option value="">{t("Default")}{defaultStorageClass ? ` (${defaultStorageClass})` : ""}</option>
                      {catalog.storageClasses.map((sc) => <option key={sc.metadata.name} value={sc.metadata.name}>{sc.metadata.name}</option>)}
                    </NativeSelect>
                  </FieldRow>
                </div>
                <div className="space-y-2">
                  {state.dataDisks.map((size, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <span className="w-24 text-sm text-muted-foreground">{t("Data disk")} {index + 1}</span>
                      <Input className="max-w-[160px]" value={size} onChange={(e) => set({ dataDisks: state.dataDisks.map((item, i) => i === index ? e.target.value : item) })} />
                      <Button size="icon" variant="ghost" aria-label={t("Remove data disk")} onClick={() => set({ dataDisks: state.dataDisks.filter((_, i) => i !== index) })}><Trash2 className="size-4 text-muted-foreground" /></Button>
                    </div>
                  ))}
                  <Button size="sm" variant="outline" disabled={!cdiAvailable} className="gap-1.5" onClick={() => set({ dataDisks: [...state.dataDisks, "50Gi"] })}><Plus className="size-4" />{t("Add data disk")}</Button>
                </div>
              </StepSection>
            </>
          )}

          {step === "network" && (
            <>
              <StepSection title={t("Network")} description={profile.vpc ? t("VPC network") : t("Pod network")}>
                {profile.vpc ? (
                  <>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <FieldRow label={t("VPC")}>
                        <NativeSelect value={state.vpc} onChange={(e) => set({ vpc: e.target.value, subnet: "", fixedIp: "", reservedIp: "" })}>
                          {catalog.vpcs.map((vpc) => (
                            <option key={vpc.metadata.name} value={vpc.metadata.name} disabled={!vpcAllowsNamespace(vpc)}>
                              {vpc.metadata.name}{vpcAllowsNamespace(vpc) ? "" : t(" (not open to {namespace})", { namespace: state.namespace })}
                            </option>
                          ))}
                        </NativeSelect>
                      </FieldRow>
                    </div>
                    <div className="space-y-2">
                      <div className="text-sm font-medium">{t("Subnet")}</div>
                      {vpcSubnets.length === 0 && <p className="text-sm text-muted-foreground">{t("No subnets in this VPC.")} <Link to="/vpc/subnets" className="text-primary hover:underline">{t("Create a subnet")}</Link> {t("first.")}</p>}
                      <div className="grid gap-2 sm:grid-cols-2">
                        {vpcSubnets.map((subnet) => {
                          const usage = subnetUsage(subnet)
                          const namespacesBound = (asRecord(subnet.spec).namespaces as string[] | undefined) || []
                          return (
                            <ChoiceCard
                              key={subnet.metadata.name}
                              selected={state.subnet === subnet.metadata.name}
                              onClick={() => set({ subnet: subnet.metadata.name, fixedIp: subnet.metadata.name === state.subnet ? state.fixedIp : "", reservedIp: subnet.metadata.name === state.subnet ? state.reservedIp : "" })}
                              title={<span className="flex items-center gap-2">{subnet.metadata.name}<span className="font-mono text-xs font-normal text-muted-foreground">{str(asRecord(subnet.spec).cidrBlock)}</span></span>}
                              description={t("{v0} IPs available{v1}", { v0: Math.max(0, usage.total - usage.used), v1: namespacesBound.length ? t(" / bound to {namespaces}", { namespaces: namespacesBound.join(", ") }) : "" })}
                            />
                          )
                        })}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="text-sm font-medium">{t("Private IP")}</div>
                      <div className="grid gap-2 sm:grid-cols-3">
                        <ChoiceCard selected={ipMode === "auto"} onClick={() => { setIpMode("auto"); set({ fixedIp: "", reservedIp: "" }) }} title={t("Automatic")} description={t("Allocated from the subnet")} />
                        <ChoiceCard selected={ipMode === "fixed"} onClick={() => { setIpMode("fixed"); set({ reservedIp: "" }) }} title={t("Specify")} description={subnetCidr ? t("An address inside {cidr}", { cidr: subnetCidr }) : t("An address in the subnet")} />
                        <ChoiceCard selected={ipMode === "reserved"} onClick={() => { setIpMode("reserved"); set({ fixedIp: "" }) }} title={t("Reserved IP")} description={t("{count} free in this subnet", { count: freeVips.length })} />
                      </div>
                      {ipMode === "fixed" && <Input className="max-w-xs font-mono" value={state.fixedIp} onChange={(e) => set({ fixedIp: e.target.value })} placeholder={subnetCidr ? subnetCidr.split("/")[0] : "10.0.0.10"} aria-label={t("Private IP")} />}
                      {ipMode === "reserved" && (
                        freeVips.length ? (
                          <NativeSelect className="max-w-xs" value={state.reservedIp} onChange={(e) => set({ reservedIp: e.target.value })} aria-label={t("Reserved IP")}>
                            <option value="">{t("Choose a reserved IP")}</option>
                            {freeVips.map((vip) => <option key={vip.metadata.name} value={vip.metadata.name}>{vipAddress(vip) || t("pending")} ({vip.metadata.name})</option>)}
                          </NativeSelect>
                        ) : (
                          <p className="text-sm text-muted-foreground">{t("No free reserved IP in this subnet.")} <Link to="/vpc/reserved-ips" className="text-primary hover:underline">{t("Reserve one")}</Link></p>
                        )
                      )}
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <FieldRow label={t("Inbound bandwidth (Mbit/s)")}><Input inputMode="numeric" value={state.bandwidth.ingress} onChange={(e) => set({ bandwidth: { ...state.bandwidth, ingress: e.target.value } })} placeholder={t("Unlimited")} /></FieldRow>
                      <FieldRow label={t("Outbound bandwidth (Mbit/s)")}><Input inputMode="numeric" value={state.bandwidth.egress} onChange={(e) => set({ bandwidth: { ...state.bandwidth, egress: e.target.value } })} placeholder={t("Unlimited")} /></FieldRow>
                    </div>
                  </>
                ) : (
                  <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">{t("The instance gets an address from the pod CIDR.")} {profile.kubeOvnInstalled ? t("VPC networking can be turned on under Settings, Networking.") : t("Install Kube-OVN to place instances in VPCs and subnets.")}</div>
                )}
                <div className="space-y-2">
                  <div className="text-sm font-medium">{t("Interface binding")}</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <ChoiceCard selected={state.binding === "bridge"} onClick={() => set({ binding: "bridge" })} title={t("Bridge")} description={t("Guest owns the subnet IP. No live migration.")} />
                    <ChoiceCard selected={state.binding === "masquerade"} onClick={() => set({ binding: "masquerade" })} title={t("Masquerade")} description={t("NAT in the pod. Supports live migration.")} />
                  </div>
                </div>
              </StepSection>
              <StepSection title={t("Extra network interfaces")} description={t("Multus attachments, bridge binding")}>
                {state.extraNics.map((nic, index) => (
                  <div key={nic.name} className="flex items-center gap-2">
                    <span className="w-14 font-mono text-sm text-muted-foreground">{nic.name}</span>
                    <NativeSelect
                      value={nic.network.value}
                      onChange={(e) => {
                        const network = catalog.networks.find((item) => item.value === e.target.value)
                        if (network) set({ extraNics: state.extraNics.map((item, i) => i === index ? { ...item, network } : item) })
                      }}
                      aria-label={t("Network of {nic}", { nic: nic.name })}
                    >
                      {catalog.networks.map((network) => (
                        <option key={network.value} value={network.value}>
                          {network.subnet ? t("Subnet {subnet} ({cidr})", { subnet: network.subnet, cidr: network.cidr }) : `${network.nad} (${network.cniType})`}
                        </option>
                      ))}
                    </NativeSelect>
                    <Button size="icon" variant="ghost" aria-label={t("Remove interface")} onClick={() => set({ extraNics: state.extraNics.filter((_, i) => i !== index) })}><Trash2 className="size-4 text-muted-foreground" /></Button>
                  </div>
                ))}
                {catalog.networks.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("No attachable networks.")} <Link to="/networks/kubernetes/nads" className="text-primary hover:underline">{t("Multus networks")}</Link></p>
                ) : (
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => set({ extraNics: [...state.extraNics, { name: nextNicName(state.extraNics.map((nic) => nic.name)), network: catalog.networks[0] }] })}><Plus className="size-4" />{t("Add interface")}</Button>
                )}
              </StepSection>
              <StepSection title={t("Security groups")} description={aclProvider === "cilium" ? t("Groups from namespace {namespace} and cluster-wide groups.", { namespace: state.namespace }) : undefined}>
                {aclProvider ? (
                  <>
                    {engines.length > 1 && (
                      <div className="space-y-2">
                        <div className="text-sm font-medium">{t("Enforcement engine")}</div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {engines.map((engine) => (
                            <ChoiceCard
                              key={engine}
                              selected={aclProvider === engine}
                              onClick={() => set({ sgEngine: engine, securityGroups: [] })}
                              icon={ShieldCheck}
                              title={<span className="flex items-center gap-2">{engineLabel[engine]}{engine === defaultEngine && <Badge variant="outline">{t("Default")}</Badge>}</span>}
                              description={engine === "cilium" ? t("Deny rules and address groups") : t("Port ACLs with rule priorities")}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                    {securityGroups.length === 0 && <p className="text-sm text-muted-foreground">{t("No security groups yet.")} <Link to="/vpc/security-groups" className="text-primary hover:underline">{t("Create one")}</Link>{t(", or continue without.")}</p>}
                    <div className="grid gap-2 sm:grid-cols-2">
                      {securityGroups.map((sg) => {
                        const key = sgSelectionKey(sg)
                        return (
                        <ChoiceCard
                          key={key}
                          selected={state.securityGroups.includes(key)}
                          onClick={() => set({ securityGroups: state.securityGroups.includes(key) ? state.securityGroups.filter((item) => item !== key) : [...state.securityGroups, key] })}
                          title={<span className="flex items-center gap-2">{sg.name}{isGlobalGroup(sg) && <Badge variant="outline">{t("Cluster wide")}</Badge>}</span>}
                          description={sg.description || t("{inbound} inbound / {outbound} outbound rules", { inbound: sg.rules.filter((rule) => rule.direction === "ingress").length, outbound: sg.rules.filter((rule) => rule.direction === "egress").length })}
                        />
                        )
                      })}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("Use")} <Link to="/networks/kubernetes/network-policies" className="text-primary hover:underline">{t("network policies")}</Link> {t("to restrict traffic on this stack.")}</p>
                )}
              </StepSection>
            </>
          )}

          {step === "access" && (
            <StepSection title={t("Login")} description={t("Applied by cloud-init on first boot")}>
              <div className="grid gap-4 sm:grid-cols-2">
                <FieldRow label={t("Username")}><Input value={state.username} onChange={(e) => set({ username: e.target.value })} /></FieldRow>
                <FieldRow label={t("Password")} hint={t("Stored in the VM spec as cloud-init user data.")}><Input type="password" value={state.password} onChange={(e) => set({ password: e.target.value })} autoComplete="new-password" /></FieldRow>
              </div>
              <FieldRow label={t("SSH public keys")} hint={t("One key per line.")}>
                <textarea
                  value={state.sshKey}
                  onChange={(e) => set({ sshKey: e.target.value })}
                  placeholder={t("ssh-ed25519 AAAA... user@host")}
                  className="min-h-28 rounded-lg border bg-background px-3 py-2 font-mono text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </FieldRow>
              <label className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div>
                  <div className="text-sm font-medium">{t("Start after creation")}</div>
                  <div className="text-xs text-muted-foreground">{t("Power on as soon as disks are ready.")}</div>
                </div>
                <Switch checked={state.startAfterCreate} onCheckedChange={(checked) => set({ startAfterCreate: checked })} />
              </label>
            </StepSection>
          )}

          {step === "review" && (
            <>
              <StepSection title={t("Review")}>
                <KeyValueGrid items={summary} />
              </StepSection>
              <StepSection title={t("Manifest")}>
                <pre className="max-h-[480px] overflow-auto rounded-lg bg-muted/30 p-4 font-mono text-xs text-foreground whitespace-pre">{YAML.dump(vm, { noRefs: true, lineWidth: 120 })}</pre>
              </StepSection>
            </>
          )}

          {(problems[step] || error) && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm break-all">{error || problems[step]}</div>
          )}

          <div className="flex items-center justify-between gap-2">
            <Button variant="outline" onClick={() => stepIndex > 0 ? setStep(steps[stepIndex - 1].id) : navigate(-1)}>{stepIndex > 0 ? t("Previous") : t("Cancel")}</Button>
            {step !== "review" ? (
              <Button onClick={() => setStep(steps[stepIndex + 1].id)}>{t("Next: {step}", { step: t(steps[stepIndex + 1].label) })}</Button>
            ) : (
              <Button onClick={create} disabled={creating}>{creating ? t("Creating...") : t("Create instance")}</Button>
            )}
          </div>
        </div>

        <aside className="hidden lg:block">
          <Panel title={t("Summary")} className="sticky top-20" bodyClassName="space-y-3 text-sm">
              {summary.slice(0, 8).map((item) => (
                <div key={item.label} className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground">{t(item.label)}</span>
                  <span className="break-all font-medium">{item.value}</span>
                </div>
              ))}
              {firstProblem && <div className="rounded-lg bg-muted/50 p-2 text-xs text-muted-foreground">{problems[firstProblem.id]}</div>}
              <Button className="w-full" onClick={create} disabled={creating}>{creating ? t("Creating...") : t("Create instance")}</Button>
            </Panel>
        </aside>
      </div>
    </div>
  )
}
