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
  listItems,
  namespacedPath,
  relativeTime,
  requestJson,
  str,
  subnetUsage,
  useAsync,
  useNamespaces,
  useNetworkProfile,
  type KubeObject,
} from "@/lib/kube"
import { engineLabel, listSecurityGroups, useSgProvider, vmSecurityGroupRefs, type SecurityGroup } from "@/lib/security-groups"
import { fetchInstanceUsage, formatBytes, useMetricsPoll } from "@/lib/metrics"
import { cidrContains, ipv4Cidr, isDnsLabel, isQuantity } from "@/lib/validate"
import { buildVirtualMachine, vmDetailPath, vmNetworkLabel, vmShape, vmStatus, vmStatusGroup, type WizardState } from "@/lib/instances"

const VM_API = "/apis/kubevirt.io/v1"
const SUB_API = "/apis/subresources.kubevirt.io/v1"
const vmAction = async (vm: KubeObject, action: "start" | "stop" | "restart") =>
  requestJson(`${SUB_API}/namespaces/${vm.metadata.namespace}/virtualmachines/${vm.metadata.name}/${action}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: "{}" })

const vmDelete = async (vm: KubeObject) =>
  requestJson(`${VM_API}/namespaces/${vm.metadata.namespace}/virtualmachines/${vm.metadata.name}`, { method: "DELETE" })

// --- Instance list ---

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
  groups: ReturnType<typeof vmSecurityGroupRefs>
}

const instanceFields: FilterField<InstanceRow>[] = [
  { key: "name", label: "Name", value: (row) => row.vm.metadata.name },
  { key: "namespace", label: "Namespace", aliases: ["ns"], value: (row) => row.vm.metadata.namespace },
  { key: "status", label: "Status", value: (row) => row.status },
  { key: "ip", label: "IP address", value: (row) => row.ips },
  { key: "spec", label: "Spec", value: (row) => [row.shape.label, row.shape.detail] },
  { key: "network", label: "Network", aliases: ["subnet"], value: (row) => row.network.label },
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
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    try {
      localStorage.setItem("instances-namespace", namespace)
    } catch {
      // Remembering the namespace is a convenience only.
    }
  }, [namespace])

  const { data, loading, reload } = useAsync(async () => {
    const [vms, vmis, types] = await Promise.all([
      listItems(namespacedPath(VM_API, "virtualmachines", scope)),
      listItems(namespacedPath(VM_API, "virtualmachineinstances", scope)),
      listItems("/apis/instancetype.kubevirt.io/v1beta1/virtualmachineclusterinstancetypes"),
    ])
    const instanceTypes = Object.fromEntries(types.map((type) => [type.metadata.name, { cpu: Number(asRecord(asRecord(type.spec).cpu).guest || 0), memory: str(asRecord(asRecord(type.spec).memory).guest) }]))
    return { vms, vmis, instanceTypes }
  }, { vms: [] as KubeObject[], vmis: [] as KubeObject[], instanceTypes: {} as Record<string, { cpu: number; memory: string }> }, [scope])

  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) reload()
    }, 15000)
    return () => clearInterval(timer)
  }, [reload])

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

  const runBatch = async (action: "start" | "stop" | "restart") => {
    setBusy(true)
    try {
      const results = await Promise.allSettled(selectedVms.map((vm) => vmAction(vm, action)))
      const failed = results.flatMap((result, index) => result.status === "rejected" ? [`${selectedVms[index].metadata.name}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`] : [])
      if (failed.length) toast.error(`${action} failed for ${failed.length} of ${selectedVms.length}`, { description: failed.slice(0, 5).join("\n") })
      setSelected({})
      reload()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Instances"
        actions={
          <Button asChild className="gap-1.5">
            <Link to="/kubevirt/virtualization/virtual-machines/create"><Plus className="size-4" />Create instance</Link>
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
            {tab.label}
            <span className="rounded-md bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">{counts[tab.id]}</span>
          </button>
        ))}
      </div>

      <Toolbar
        right={<FilterInput value={search} onChange={setSearch} fields={instanceFields} rows={tabRows} placeholder="Filter, e.g. web ip:10.0 host:node-1" />}
      >
        <Button size="sm" variant="outline" onClick={reload} className="gap-2"><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />Refresh</Button>
        <Combobox value={namespace} onChange={setNamespace} options={namespaces} placeholder="All namespaces" aria-label="Namespace" />
        {selectedVms.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 px-2 py-1">
            <span className="text-sm text-muted-foreground">{selectedVms.length} selected</span>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => runBatch("start")} className="gap-1.5"><Play className="size-3.5" />Start</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => runBatch("stop")} className="gap-1.5"><Square className="size-3.5" />Stop</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => runBatch("restart")} className="gap-1.5"><RotateCcw className="size-3.5" />Restart</Button>
            <Button size="sm" variant="destructive" disabled={busy} onClick={() => setDeleting(selectedVms)} className="gap-1.5"><Trash2 className="size-3.5" />Delete</Button>
          </div>
        )}
      </Toolbar>

      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] caption-bottom text-sm">
            <thead className="bg-muted/50">
              <tr className="border-b">
                <th className="h-9 w-10 px-3 text-left">
                  <input type="checkbox" className="size-4 accent-primary" aria-label="Select all instances" checked={allSelected} onChange={(e) => setSelected(e.target.checked ? Object.fromEntries(rows.map((row) => [row.key, true])) : {})} />
                </th>
                {["Name", "Status", "IP address", "Spec", usage ? "Usage" : null, "Network", provider ? "Security groups" : null, "Host", "Created", ""].filter((header) => header !== null).map((header, index) => (
                  <th key={index} className={cn("h-10 px-3 text-left text-xs font-medium text-muted-foreground", header === "Created" && "text-right")}>{header}</th>
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
                      title={allRows.length === 0 && !namespace ? "No instances yet" : "No matching instances"}
                      action={allRows.length === 0 && !namespace && <Button asChild size="sm"><Link to="/kubevirt/virtualization/virtual-machines/create">Create instance</Link></Button>}
                    />
                  </td>
                </tr>
              ) : pageRows.map(({ vm, ips, shape, network, status, groups, node }) => {
                return (
                  <tr key={key(vm)} className="border-b transition-colors last:border-0 hover:bg-muted/40">
                    <td className="px-3 py-2">
                      <input type="checkbox" className="size-4 accent-primary" aria-label={`Select ${vm.metadata.name}`} checked={Boolean(selected[key(vm)])} onChange={(e) => setSelected((current) => ({ ...current, [key(vm)]: e.target.checked }))} />
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
                            <div>{usage[key(vm)].cpuCores.toFixed(2)} cores</div>
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
                      {profile.vpc && network.kind === "subnet" && <div className="text-xs text-muted-foreground">Kube-OVN subnet</div>}
                    </td>
                    {provider && (
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {groups.length ? groups.map((group) => (
                            <Badge key={`${group.provider}:${group.name}`} variant="outline" title={engineLabel[group.provider]}>
                              {group.name}{providers.length > 1 && <span className="text-muted-foreground">{group.provider === "cilium" ? "cil" : "ovn"}</span>}
                            </Badge>
                          )) : <span className="text-sm text-muted-foreground">-</span>}
                        </div>
                      </td>
                    )}
                    <td className="px-3 py-2 text-sm text-muted-foreground">{node || "-"}</td>
                    <td className="px-3 py-2 text-right text-sm text-muted-foreground tabular-nums">{relativeTime(vm.metadata.creationTimestamp)}</td>
                    <td className="px-3 py-2 text-right">
                      <InstanceRowMenu vm={vm} running={vmStatusGroup(status) === "running"} onChanged={reload} onDelete={() => setDeleting([vm])} />
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
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={deleting && deleting.length > 1 ? `Delete ${deleting.length} instances?` : `Delete instance ${deleting?.[0]?.metadata.name}?`}
        description="The instance and the disks created with it are deleted. This cannot be undone."
        destructive
        confirmLabel="Delete"
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

function InstanceRowMenu({ vm, running, onChanged, onDelete }: { vm: KubeObject; running: boolean; onChanged: () => void; onDelete: () => void }) {
  const navigate = useNavigate()
  const run = (action: "start" | "stop" | "restart") => vmAction(vm, action)
    .catch((err) => toast.error(`${action} ${vm.metadata.name} failed`, { description: err instanceof Error ? err.message : String(err) }))
    .then(onChanged)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" aria-label={`Actions for ${vm.metadata.name}`}><MoreHorizontal className="size-4" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={running} onClick={() => run("start")}><Play />Start</DropdownMenuItem>
        <DropdownMenuItem disabled={!running} onClick={() => run("stop")}><Square />Stop</DropdownMenuItem>
        <DropdownMenuItem disabled={!running} onClick={() => run("restart")}><RotateCcw />Restart</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!running} onClick={() => navigate(vmDetailPath(vm, "console"))}>Serial console</DropdownMenuItem>
        <DropdownMenuItem disabled={!running} onClick={() => navigate(vmDetailPath(vm, "vnc"))}>VNC</DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate(vmDetailPath(vm, "manifest"))}>View YAML</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onDelete}><Trash2 />Delete</DropdownMenuItem>
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
  const { provider: defaultEngine, providers: engines } = useSgProvider()
  const [step, setStep] = useState<StepId>("basics")
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState("")
  const [state, setState] = useState<WizardState>(() => ({
    name: `vm-${Math.random().toString(36).slice(2, 7)}`,
    namespace: [null, "all"].includes(readLocal("instances-namespace")) ? "default" : readLocal("instances-namespace") as string,
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
    binding: "masquerade",
    sgEngine: null,
    securityGroups: [],
    username: "cloud-user",
    password: "",
    sshKey: "",
  }))
  const set = (patch: Partial<WizardState>) => setState((current) => ({ ...current, ...patch }))
  const aclProvider = state.sgEngine && engines.includes(state.sgEngine) ? state.sgEngine : defaultEngine

  const { data: catalog, loading: catalogLoading } = useAsync(async () => {
    const [instanceTypes, dataSources, storageClasses, vpcs, subnets, pvcs] = await Promise.all([
      listItems("/apis/instancetype.kubevirt.io/v1beta1/virtualmachineclusterinstancetypes"),
      listItems("/apis/cdi.kubevirt.io/v1beta1/datasources"),
      listItems("/apis/storage.k8s.io/v1/storageclasses"),
      profile.vpc ? listItems("/apis/kubeovn.io/v1/vpcs") : Promise.resolve([]),
      profile.vpc ? listItems("/apis/kubeovn.io/v1/subnets") : Promise.resolve([]),
      listItems(`/api/v1/namespaces/${state.namespace}/persistentvolumeclaims`),
    ])
    return { instanceTypes, dataSources, storageClasses, vpcs, subnets, pvcs }
  }, { instanceTypes: [] as KubeObject[], dataSources: [] as KubeObject[], storageClasses: [] as KubeObject[], vpcs: [] as KubeObject[], subnets: [] as KubeObject[], pvcs: [] as KubeObject[] }, [profile.vpc, state.namespace])

  const { data: securityGroups } = useAsync(
    async () => aclProvider ? (await listSecurityGroups(aclProvider, state.namespace)).filter((sg) => sg.managed) : [],
    [] as SecurityGroup[],
    [aclProvider, state.namespace],
  )

  // Sensible defaults once catalog data arrives.
  useEffect(() => {
    setState((current) => {
      const next = { ...current }
      if (!current.dataSource && catalog.dataSources.length) next.dataSource = `${catalog.dataSources[0].metadata.namespace}/${catalog.dataSources[0].metadata.name}`
      if (!catalogLoading && !catalog.dataSources.length && current.imageSource === "datasource") next.imageSource = "registry"
      if (profile.vpc && !current.vpc && catalog.vpcs.length) next.vpc = catalog.vpcs.find((vpc) => asRecord(vpc.status).default === true)?.metadata.name || catalog.vpcs[0].metadata.name
      return next
    })
  }, [catalog.dataSources, catalog.vpcs, catalogLoading, profile.vpc])

  // Kube-OVN subnets are routable, so let the guest own the subnet address by default.
  useEffect(() => {
    if (profile.vpc) setState((current) => ({ ...current, binding: "bridge" }))
  }, [profile.vpc])

  // Kube-OVN refuses pods from namespaces outside a custom VPC's spec.namespaces list.
  const vpcAllowsNamespace = (vpc: KubeObject) => {
    const allowed = (asRecord(vpc.spec).namespaces as string[] | undefined) || []
    return asRecord(vpc.status).default === true || allowed.length === 0 || allowed.includes(state.namespace)
  }
  const usableVpcs = catalog.vpcs.filter(vpcAllowsNamespace)
  const vpcSubnets = catalog.subnets.filter((subnet) => str(asRecord(subnet.spec).vpc, "ovn-cluster") === state.vpc && !["join"].includes(subnet.metadata.name))
  const selectedSubnet = catalog.subnets.find((subnet) => subnet.metadata.name === state.subnet)
  const subnetCidr = ipv4Cidr(str(asRecord(selectedSubnet?.spec).cidrBlock))
  const defaultStorageClass = catalog.storageClasses.find((sc) => sc.metadata.annotations?.["storageclass.kubernetes.io/is-default-class"] === "true")?.metadata.name
  const vm = useMemo(() => buildVirtualMachine({ ...state, sgEngine: aclProvider }, profile.vpc), [state, aclProvider, profile.vpc])

  const problems: Partial<Record<StepId, string>> = {}
  if (!isDnsLabel(state.name)) problems.basics = "Name must be at most 63 lowercase letters, digits and dashes, starting and ending with a letter or digit."
  else if (!state.namespace) problems.basics = "Choose a namespace."
  else if (state.specMode === "instancetype" && !state.instanceType) problems.basics = "Choose an instance type."
  else if (state.specMode === "custom" && (!Number.isInteger(state.cpu) || state.cpu < 1)) problems.basics = "vCPU must be a whole number of at least 1."
  else if (state.specMode === "custom" && !isQuantity(state.memory)) problems.basics = "Memory must be a quantity such as 4Gi."
  if (state.imageSource === "datasource" && !state.dataSource) problems.image = "Choose an image."
  if (state.imageSource === "registry" && !state.registryUrl.trim()) problems.image = "Enter a registry image."
  if (state.imageSource === "http" && !/^https?:\/\//.test(state.httpUrl)) problems.image = "Enter an http(s) URL."
  if (state.imageSource === "containerdisk" && !state.containerDisk.trim()) problems.image = "Enter a container disk image."
  if (state.imageSource === "pvc" && !state.pvcName) problems.image = "Choose a volume to clone."
  if (!problems.image && state.imageSource !== "containerdisk" && !isQuantity(state.rootSize)) problems.image = "System disk size must be a quantity such as 20Gi."
  if (!problems.image && state.dataDisks.some((size) => !isQuantity(size))) problems.image = "Data disk sizes must be quantities such as 50Gi."
  if (profile.vpc && !state.subnet) problems.network = "Choose a subnet."
  else if (profile.vpc && catalog.vpcs.length > 0 && !usableVpcs.some((vpc) => vpc.metadata.name === state.vpc)) problems.network = `VPC ${state.vpc} does not allow namespace ${state.namespace}.`
  else if (profile.vpc && state.fixedIp.trim() && subnetCidr && !cidrContains(subnetCidr, state.fixedIp)) problems.network = `${state.fixedIp.trim()} is not inside ${subnetCidr}.`
  else if (profile.vpc && state.fixedIp.trim() && state.fixedIp.trim() === str(asRecord(selectedSubnet?.spec).gateway)) problems.network = "The private IP cannot be the subnet gateway."
  if (!state.password && !state.sshKey.trim()) problems.access = "Set a password or an SSH key so you can log in."

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
      setError(err instanceof Error ? err.message : "Failed to create instance")
    } finally {
      setCreating(false)
    }
  }

  const selectedType = catalog.instanceTypes.find((type) => type.metadata.name === state.instanceType)
  const summary = [
    { label: "Name", value: `${state.namespace}/${state.name}` },
    {
      label: "Spec",
      value: state.specMode === "instancetype"
        ? `${state.instanceType || "N/A"}${selectedType ? ` (${str(asRecord(asRecord(selectedType.spec).cpu).guest)} vCPU / ${str(asRecord(asRecord(selectedType.spec).memory).guest)})` : ""}`
        : `${state.cpu} vCPU / ${state.memory}`,
    },
    {
      label: "Image",
      value: state.imageSource === "datasource" ? state.dataSource : state.imageSource === "registry" ? state.registryUrl : state.imageSource === "http" ? state.httpUrl : state.imageSource === "pvc" ? `Clone of ${state.pvcName}` : `${state.containerDisk} (ephemeral)`,
    },
    { label: "System disk", value: state.imageSource === "containerdisk" ? "Ephemeral" : `${state.rootSize} on ${state.storageClass || defaultStorageClass || "default class"}` },
    { label: "Data disks", value: state.dataDisks.length ? state.dataDisks.join(", ") : "None" },
    { label: "Network", value: profile.vpc ? `${state.vpc} / ${state.subnet || "N/A"}${state.fixedIp ? ` (${state.fixedIp})` : ""}` : "Pod network" },
    { label: "Interface binding", value: state.binding },
    { label: "Security groups", value: aclProvider ? `${state.securityGroups.join(", ") || "None"}${engines.length > 1 ? ` (${engineLabel[aclProvider]})` : ""}` : "Not available" },
    { label: "Login", value: `${state.username || "default user"}${state.password ? " / password" : ""}${state.sshKey.trim() ? " / SSH key" : ""}` },
    { label: "Power on", value: state.startAfterCreate ? "After creation" : "Stay stopped" },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: "Instances", to: "/kubevirt/virtualization/virtual-machines" }, { label: "Create" }]}
        title="Create instance"
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
              {item.label}
              {problems[item.id] && index < stepIndex && <span className="size-2 rounded-full bg-red-500" />}
            </button>
          ))}
        </nav>

        <div className="min-w-0 space-y-4">
          {step === "basics" && (
            <>
              <StepSection title="Instance details">
                <div className="grid gap-4 sm:grid-cols-2">
                  <FieldRow label="Name" hint="Lowercase letters, digits and dashes."><Input value={state.name} onChange={(e) => set({ name: e.target.value.toLowerCase() })} /></FieldRow>
                  <FieldRow label="Namespace (project)">
                    <NativeSelect value={state.namespace} onChange={(e) => set({ namespace: e.target.value, securityGroups: [], pvcName: "" })}>
                      {Array.from(new Set([state.namespace, ...namespaces])).map((ns) => <option key={ns} value={ns}>{ns}</option>)}
                    </NativeSelect>
                  </FieldRow>
                  <div className="sm:col-span-2">
                    <FieldRow label="Description"><Input value={state.description} onChange={(e) => set({ description: e.target.value })} placeholder="Optional" /></FieldRow>
                  </div>
                </div>
              </StepSection>
              <StepSection title="Spec">
                <div className="grid gap-2 sm:grid-cols-2">
                  <ChoiceCard selected={state.specMode === "custom"} onClick={() => set({ specMode: "custom" })} title="Custom" description="Set vCPU and memory" />
                  <ChoiceCard selected={state.specMode === "instancetype"} onClick={() => set({ specMode: "instancetype" })} disabled={catalog.instanceTypes.length === 0} title="Instance type" description={catalog.instanceTypes.length ? `${catalog.instanceTypes.length} cluster instance types` : "No cluster instance types found"} />
                </div>
                {state.specMode === "custom" ? (
                  <>
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {shapePresets.map((preset) => (
                        <ChoiceCard key={preset.label} selected={state.cpu === preset.cpu && state.memory === preset.memory} onClick={() => set({ cpu: preset.cpu, memory: preset.memory })} title={preset.label} description={preset.hint} />
                      ))}
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <FieldRow label="vCPU"><Input type="number" min={1} value={state.cpu} onChange={(e) => set({ cpu: Math.max(1, Number(e.target.value) || 1) })} /></FieldRow>
                      <FieldRow label="Memory"><Input value={state.memory} onChange={(e) => set({ memory: e.target.value })} placeholder="4Gi" /></FieldRow>
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
                        description={`${str(asRecord(asRecord(type.spec).cpu).guest, "?")} vCPU / ${str(asRecord(asRecord(type.spec).memory).guest, "?")}`}
                      />
                    ))}
                  </div>
                )}
              </StepSection>
            </>
          )}

          {step === "image" && (
            <>
              <StepSection title="Image">
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  <ChoiceCard selected={state.imageSource === "datasource"} onClick={() => set({ imageSource: "datasource" })} disabled={catalog.dataSources.length === 0} icon={ImageIcon} title="Public image" description={catalog.dataSources.length ? "Images published as DataSources" : "No DataSources found"} />
                  <ChoiceCard selected={state.imageSource === "registry"} onClick={() => set({ imageSource: "registry" })} icon={ImageIcon} title="Registry image" description="Import a containerdisk into a persistent disk" />
                  <ChoiceCard selected={state.imageSource === "http"} onClick={() => set({ imageSource: "http" })} icon={ImageIcon} title="Image URL" description="Import a qcow2/raw image over HTTP" />
                  <ChoiceCard selected={state.imageSource === "pvc"} onClick={() => set({ imageSource: "pvc" })} icon={HardDrive} title="Clone a volume" description="Copy an existing disk in this namespace" />
                  <ChoiceCard selected={state.imageSource === "containerdisk"} onClick={() => set({ imageSource: "containerdisk" })} icon={ImageIcon} title="Ephemeral" description="Boot a containerdisk; changes are lost on stop" />
                </div>
                {state.imageSource === "datasource" && (
                  <FieldRow label="Image">
                    <NativeSelect value={state.dataSource} onChange={(e) => set({ dataSource: e.target.value })}>
                      {catalog.dataSources.map((ds) => {
                        const value = `${ds.metadata.namespace}/${ds.metadata.name}`
                        return <option key={value} value={value}>{ds.metadata.name} ({ds.metadata.namespace})</option>
                      })}
                    </NativeSelect>
                  </FieldRow>
                )}
                {state.imageSource === "registry" && <FieldRow label="Registry image" hint="For example quay.io/containerdisks/ubuntu:24.04"><Input value={state.registryUrl} onChange={(e) => set({ registryUrl: e.target.value })} /></FieldRow>}
                {state.imageSource === "http" && <FieldRow label="Image URL"><Input value={state.httpUrl} onChange={(e) => set({ httpUrl: e.target.value })} placeholder="https://cloud-images.ubuntu.com/.../ubuntu.img" /></FieldRow>}
                {state.imageSource === "containerdisk" && <FieldRow label="Container disk"><Input value={state.containerDisk} onChange={(e) => set({ containerDisk: e.target.value })} /></FieldRow>}
                {state.imageSource === "pvc" && (
                  <FieldRow label="Source volume">
                    <NativeSelect value={state.pvcName} onChange={(e) => set({ pvcName: e.target.value })}>
                      <option value="">Select a volume</option>
                      {catalog.pvcs.map((pvc) => <option key={pvc.metadata.name} value={pvc.metadata.name}>{pvc.metadata.name} ({str(asRecord(asRecord(asRecord(pvc.spec).resources).requests).storage)})</option>)}
                    </NativeSelect>
                  </FieldRow>
                )}
              </StepSection>
              <StepSection title="Disks">
                <div className="grid gap-4 sm:grid-cols-2">
                  <FieldRow label="System disk size"><Input value={state.rootSize} disabled={state.imageSource === "containerdisk"} onChange={(e) => set({ rootSize: e.target.value })} /></FieldRow>
                  <FieldRow label="Storage class">
                    <NativeSelect value={state.storageClass} onChange={(e) => set({ storageClass: e.target.value })}>
                      <option value="">Default{defaultStorageClass ? ` (${defaultStorageClass})` : ""}</option>
                      {catalog.storageClasses.map((sc) => <option key={sc.metadata.name} value={sc.metadata.name}>{sc.metadata.name}</option>)}
                    </NativeSelect>
                  </FieldRow>
                </div>
                <div className="space-y-2">
                  {state.dataDisks.map((size, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <span className="w-24 text-sm text-muted-foreground">Data disk {index + 1}</span>
                      <Input className="max-w-[160px]" value={size} onChange={(e) => set({ dataDisks: state.dataDisks.map((item, i) => i === index ? e.target.value : item) })} />
                      <Button size="icon" variant="ghost" aria-label="Remove data disk" onClick={() => set({ dataDisks: state.dataDisks.filter((_, i) => i !== index) })}><Trash2 className="size-4 text-muted-foreground" /></Button>
                    </div>
                  ))}
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => set({ dataDisks: [...state.dataDisks, "50Gi"] })}><Plus className="size-4" />Add data disk</Button>
                </div>
              </StepSection>
            </>
          )}

          {step === "network" && (
            <>
              <StepSection title="Network" description={profile.vpc ? "Kube-OVN" : "Pod network"}>
                {profile.vpc ? (
                  <>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <FieldRow label="VPC">
                        <NativeSelect value={state.vpc} onChange={(e) => set({ vpc: e.target.value, subnet: "", fixedIp: "" })}>
                          {catalog.vpcs.map((vpc) => (
                            <option key={vpc.metadata.name} value={vpc.metadata.name} disabled={!vpcAllowsNamespace(vpc)}>
                              {vpc.metadata.name}{vpcAllowsNamespace(vpc) ? "" : ` (not open to ${state.namespace})`}
                            </option>
                          ))}
                        </NativeSelect>
                      </FieldRow>
                      <FieldRow label="Private IP" hint={subnetCidr ? `Inside ${subnetCidr}. Leave empty to allocate automatically.` : "Leave empty to allocate automatically."}><Input value={state.fixedIp} onChange={(e) => set({ fixedIp: e.target.value })} placeholder="Auto" /></FieldRow>
                    </div>
                    <div className="space-y-2">
                      <div className="text-sm font-medium">Subnet</div>
                      {vpcSubnets.length === 0 && <p className="text-sm text-muted-foreground">No subnets in this VPC. <Link to="/vpc/subnets" className="text-primary hover:underline">Create a subnet</Link> first.</p>}
                      <div className="grid gap-2 sm:grid-cols-2">
                        {vpcSubnets.map((subnet) => {
                          const usage = subnetUsage(subnet)
                          const namespacesBound = (asRecord(subnet.spec).namespaces as string[] | undefined) || []
                          return (
                            <ChoiceCard
                              key={subnet.metadata.name}
                              selected={state.subnet === subnet.metadata.name}
                              onClick={() => set({ subnet: subnet.metadata.name, fixedIp: subnet.metadata.name === state.subnet ? state.fixedIp : "" })}
                              title={<span className="flex items-center gap-2">{subnet.metadata.name}<span className="font-mono text-xs font-normal text-muted-foreground">{str(asRecord(subnet.spec).cidrBlock)}</span></span>}
                              description={`${Math.max(0, usage.total - usage.used)} IPs available${namespacesBound.length ? ` / bound to ${namespacesBound.join(", ")}` : ""}`}
                            />
                          )
                        })}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">The instance gets an address from the pod CIDR. {profile.kubeOvnInstalled ? "Kube-OVN is installed: switch the network stack in Settings to choose VPCs and subnets." : "Install Kube-OVN to place instances in VPCs and subnets."}</div>
                )}
                <div className="space-y-2">
                  <div className="text-sm font-medium">Interface binding</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <ChoiceCard selected={state.binding === "bridge"} onClick={() => set({ binding: "bridge" })} title="Bridge" description="Guest owns the subnet IP. No live migration." />
                    <ChoiceCard selected={state.binding === "masquerade"} onClick={() => set({ binding: "masquerade" })} title="Masquerade" description="NAT in the pod. Supports live migration." />
                  </div>
                </div>
              </StepSection>
              <StepSection title="Security groups" description={aclProvider === "kube-ovn" ? "Enforced by Kube-OVN port ACLs." : aclProvider === "cilium" ? `Enforced by Cilium. Groups from namespace ${state.namespace}.` : "Security groups require Kube-OVN or Cilium."}>
                {aclProvider ? (
                  <>
                    {engines.length > 1 && (
                      <div className="space-y-2">
                        <div className="text-sm font-medium">Enforcement engine</div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {engines.map((engine) => (
                            <ChoiceCard
                              key={engine}
                              selected={aclProvider === engine}
                              onClick={() => set({ sgEngine: engine, securityGroups: [] })}
                              icon={ShieldCheck}
                              title={<span className="flex items-center gap-2">{engineLabel[engine]}{engine === defaultEngine && <Badge variant="outline">Default</Badge>}</span>}
                              description={engine === "cilium" ? "CiliumNetworkPolicy, per namespace" : "Kube-OVN SecurityGroup, cluster wide"}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                    {securityGroups.length === 0 && <p className="text-sm text-muted-foreground">No security groups yet. <Link to="/vpc/security-groups" className="text-primary hover:underline">Create one</Link>, or continue without.</p>}
                    <div className="grid gap-2 sm:grid-cols-2">
                      {securityGroups.map((sg) => (
                        <ChoiceCard
                          key={sg.name}
                          selected={state.securityGroups.includes(sg.name)}
                          onClick={() => set({ securityGroups: state.securityGroups.includes(sg.name) ? state.securityGroups.filter((item) => item !== sg.name) : [...state.securityGroups, sg.name] })}
                          title={sg.name}
                          description={sg.description || `${sg.rules.filter((rule) => rule.direction === "ingress").length} inbound / ${sg.rules.filter((rule) => rule.direction === "egress").length} outbound rules`}
                        />
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Use <Link to="/networks/kubernetes/network-policies" className="text-primary hover:underline">network policies</Link> to restrict traffic on this stack.</p>
                )}
              </StepSection>
            </>
          )}

          {step === "access" && (
            <StepSection title="Login" description="Applied by cloud-init on first boot">
              <div className="grid gap-4 sm:grid-cols-2">
                <FieldRow label="Username"><Input value={state.username} onChange={(e) => set({ username: e.target.value })} /></FieldRow>
                <FieldRow label="Password" hint="Stored in the VM spec as cloud-init user data."><Input type="password" value={state.password} onChange={(e) => set({ password: e.target.value })} autoComplete="new-password" /></FieldRow>
              </div>
              <FieldRow label="SSH public keys" hint="One key per line.">
                <textarea
                  value={state.sshKey}
                  onChange={(e) => set({ sshKey: e.target.value })}
                  placeholder="ssh-ed25519 AAAA... user@host"
                  className="min-h-28 rounded-lg border bg-background px-3 py-2 font-mono text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </FieldRow>
              <label className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div>
                  <div className="text-sm font-medium">Start after creation</div>
                  <div className="text-xs text-muted-foreground">Power on as soon as disks are ready.</div>
                </div>
                <Switch checked={state.startAfterCreate} onCheckedChange={(checked) => set({ startAfterCreate: checked })} />
              </label>
            </StepSection>
          )}

          {step === "review" && (
            <>
              <StepSection title="Review">
                <KeyValueGrid items={summary} />
              </StepSection>
              <StepSection title="Manifest">
                <pre className="max-h-[480px] overflow-auto rounded-lg bg-muted/30 p-4 font-mono text-xs text-foreground whitespace-pre">{YAML.dump(vm, { noRefs: true, lineWidth: 120 })}</pre>
              </StepSection>
            </>
          )}

          {(problems[step] || error) && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm break-all">{error || problems[step]}</div>
          )}

          <div className="flex items-center justify-between gap-2">
            <Button variant="outline" onClick={() => stepIndex > 0 ? setStep(steps[stepIndex - 1].id) : navigate(-1)}>{stepIndex > 0 ? "Previous" : "Cancel"}</Button>
            {step !== "review" ? (
              <Button onClick={() => setStep(steps[stepIndex + 1].id)}>Next: {steps[stepIndex + 1].label}</Button>
            ) : (
              <Button onClick={create} disabled={creating}>{creating ? "Creating..." : "Create instance"}</Button>
            )}
          </div>
        </div>

        <aside className="hidden lg:block">
          <Panel title="Summary" className="sticky top-20" bodyClassName="space-y-3 text-sm">
              {summary.slice(0, 8).map((item) => (
                <div key={item.label} className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground">{item.label}</span>
                  <span className="break-all font-medium">{item.value}</span>
                </div>
              ))}
              {firstProblem && <div className="rounded-lg bg-muted/50 p-2 text-xs text-muted-foreground">{problems[firstProblem.id]}</div>}
              <Button className="w-full" onClick={create} disabled={creating}>{creating ? "Creating..." : "Create instance"}</Button>
            </Panel>
        </aside>
      </div>
    </div>
  )
}
