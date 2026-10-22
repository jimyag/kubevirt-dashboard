import { useCallback, useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Link, useParams, useNavigate, Navigate } from "react-router-dom";
import {
  Terminal, FileCode, Info, ShieldCheck, Bell,
  Search, Check, Copy, MousePointer2, RefreshCw, Play, Square, RotateCcw, MonitorPlay, ChevronDown
} from "lucide-react";
import { cn } from "@/lib/utils";
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from "recharts";

import { VncConsole } from "./components/VncConsole";
import { SerialConsole } from "./components/SerialConsole";
import { AppSidebar } from "./components/app-sidebar";
import { RelatedPodsCard } from "./components/pod-access";
import { ResourceCreateDialog, ResourceDetail, ResourceList, ResourceManifest, type ResourceConfig } from "./components/resource-management";
import { SiteHeader } from "./components/site-header";
import { SidebarInset, SidebarProvider } from "./components/ui/sidebar";
import { Toaster } from "./components/ui/sonner";
import { toast } from "sonner";
import { Button } from "./components/ui/button";
import { dvCreateConfig, jsonPost, jsonPut, keyValueText, mergePatch, numberValue, parseKeyValueText, resourceConfigs, stringValue } from "./resources/configs";
import { DataTable, EmptyState, KeyValueGrid, LoadingState, NativeSelect, PageHeader, Panel, StatusDot, Toolbar } from "./components/console";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";
import { kubeOvnAnnotations, relativeTime, replaceMap, useNetworkProfile, type KubeObject } from "./lib/kube";
import { engineLabel, sgDetailPath, useSgProvider, vmSecurityGroupRefs } from "./lib/security-groups";
import { CreateInstancePage, InstanceListPage } from "./pages/instances";
import { OverviewPage } from "./pages/overview";
import { InstanceSecurityGroupsDialog, SecurityGroupDetailPage, SecurityGroupListPage } from "./pages/security-groups";
import { CatalogPage, SettingsPage } from "./pages/settings";
import { SubnetDetailPage, SubnetListPage, VpcDetailPage, VpcListPage } from "./pages/vpc";
import { KubernetesCategoryPage, KubernetesManagementPage, KubeVirtCategoryPage, KubeVirtManagementPage, NetworkCategoryPage, NetworkManagementPage, StorageCategoryPage, StorageManagementPage } from "./resources/group-pages";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./components/ui/dialog";
import { Input } from "./components/ui/input";

interface ResourceMetadata { name: string; namespace: string; uid: string; creationTimestamp: string; labels?: Record<string, string>; annotations?: Record<string, string>; }
type UnknownRecord = Record<string, unknown>;
interface VmDisk { name?: string; bootOrder?: number; disk?: UnknownRecord; cdrom?: UnknownRecord; lun?: UnknownRecord }
interface VmVolume { name: string; dataVolume?: { name: string }; persistentVolumeClaim?: { claimName?: string }; containerDisk?: { image?: string }; cloudInitNoCloud?: UnknownRecord }
interface VM { metadata: ResourceMetadata; spec: { running?: boolean; runStrategy?: string; instancetype?: { name?: string }; template?: { metadata?: { labels?: Record<string, string>; annotations?: Record<string, string>; }; spec?: { architecture?: string; priorityClassName?: string; domain?: { machine?: { type?: string }; cpu?: { cores?: number, sockets?: number, threads?: number }; resources?: { requests?: { cpu?: string, memory?: string } }; devices?: { interfaces?: Array<{ name: string, model?: string }>; disks?: VmDisk[] }; }; networks?: Array<{ name: string, pod?: unknown }>; volumes?: VmVolume[]; }; }; }; status?: { printableStatus?: string; conditions?: Array<{ type: string; status: string; message?: string; reason?: string }>; }; }
interface VMI { metadata: ResourceMetadata; status: { phase: string; interfaces?: Array<{ ipAddress?: string; name: string }>; nodeName?: string }; }
interface DVStorageSpec { storageClassName?: string; accessModes?: string[]; volumeMode?: string; resources?: { requests?: { storage?: string } } }
interface DV { metadata: ResourceMetadata; status?: { phase: string; progress?: string; claimName?: string; conditions?: Array<{ type: string; status: string; message?: string; reason?: string }>; }; spec: { storage?: DVStorageSpec; pvc?: DVStorageSpec; source?: Record<string, unknown>; }; }
interface K8sEvent { metadata: ResourceMetadata; involvedObject: { kind: string; name: string; namespace: string; uid: string; }; reason: string; message: string; type: string; lastTimestamp: string; count: number; }
interface MetricPoint { time: string; timestamp: number; cpuUsage: number; memoryUsage: number; }

// --- Utils ---
const getContext = () => localStorage.getItem("kube-context") || "";
const apiFetch = (url: string, options: RequestInit = {}) => {
  const ctx = getContext(); const headers = new Headers(options.headers || {});
  if (ctx) headers.set("X-Kube-Context", ctx);
  return fetch(url, { ...options, headers });
};
const asRecord = (value: unknown): UnknownRecord => value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
const namedApiGroup = (group: unknown): group is { name: string } => asRecord(group).name !== undefined;
const isVm = (value: unknown): value is VM => Boolean(asRecord(value).metadata && asRecord(value).spec);
const vmPodSelectors = (name: string): Array<Record<string, string>> => [
  { "vm.kubevirt.io/name": name },
  { "vmi.kubevirt.io/id": name },
  { "las.qiniu.io/vm-id": name },
  { "kubevirt.io/domain": name },
];
const findVmPod = async (namespace: string, name: string) => {
  for (const selector of vmPodSelectors(name)) {
    const labelSelector = Object.entries(selector).map(([key, value]) => `${key}=${value}`).join(",");
    const ps = await apiFetch(`/api/v1/namespaces/${namespace}/pods?labelSelector=${encodeURIComponent(labelSelector)}`);
    if (!ps.ok) continue;
    const pod = (await ps.json()).items?.[0];
    if (pod) return pod;
  }
  return null;
};

// --- Shared Components ---
function StatusBadge({ status }: { status?: string }) {
  return <StatusDot status={status} />;
}

function CopyableText({ text, label }: { text: string, label?: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = () => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return (
    <div className="group relative flex flex-col gap-1 w-full bg-muted/30 p-2.5 rounded-lg border hover:border-border transition-all">
      {label && <div className="text-[9px] font-medium text-muted-foreground">{label}</div>}
      <div className="flex items-start justify-between gap-4">
        <div className="text-[11px] font-mono text-foreground break-all leading-relaxed flex-1">{text}</div>
        <button onClick={onCopy} className="p-1 hover:bg-background rounded-lg border border-transparent hover:border-border transition-all text-muted-foreground hover:text-foreground shrink-0 mt-0.5">
          {copied ? <Check size={12} className="text-green-600" /> : <Copy size={12} />}
        </button>
      </div>
    </div>
  );
}

type VmDialogField = {
  name: string;
  label: string;
  type?: "text" | "number" | "select" | "textarea";
  defaultValue: string;
  options?: Array<{ label: string; value: string }>;
};

function VmActionDialog({
  label,
  description,
  fields,
  buildRequest,
  onDone,
  variant = "outline",
  open: controlledOpen,
  onOpenChange,
}: {
  label: string;
  description: string;
  fields: VmDialogField[];
  buildRequest: (values: Record<string, string>) => { url: string; options: RequestInit };
  onDone: () => void;
  variant?: "default" | "outline" | "destructive" | "secondary";
  /** When provided, the dialog is controlled and renders no trigger button. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const controlled = controlledOpen !== undefined;
  const open = controlled ? controlledOpen : uncontrolledOpen;
  const setOpen = (next: boolean) => (controlled ? onOpenChange?.(next) : setUncontrolledOpen(next));
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((field) => [field.name, field.defaultValue])));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) setValues(Object.fromEntries(fields.map((field) => [field.name, field.defaultValue])));
  }, [fields, open]);

  const submit = async () => {
    setSaving(true);
    setError("");
    try {
      const request = buildRequest(values);
      const res = await apiFetch(request.url, request.options);
      if (!res.ok) throw new Error(await res.text());
      setOpen(false);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${label.toLowerCase()}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!controlled && (
        <DialogTrigger asChild>
          <Button size="sm" variant={variant}>{label}</Button>
        </DialogTrigger>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {fields.map((field) => (
            <label key={field.name} className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-foreground">{field.label}</span>
              {field.type === "textarea" ? (
                <textarea
                  value={values[field.name] || ""}
                  onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
                  className="min-h-28 rounded-lg border bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              ) : field.type === "select" ? (
                <select
                  value={values[field.name] || ""}
                  onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                >
                  {(field.options || []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              ) : (
                <Input
                  type={field.type === "number" ? "number" : "text"}
                  value={values[field.name] || ""}
                  onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
                />
              )}
            </label>
          ))}
        </div>
        {error && <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground">{error}</div>}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant={variant === "destructive" ? "destructive" : "default"} onClick={submit} disabled={saving}>{saving ? "Applying..." : "Apply"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Main Views ---
const dvSize = (dv: DV) => dv.spec.storage?.resources?.requests?.storage || dv.spec.pvc?.resources?.requests?.storage || "N/A";
const dvStorageClass = (dv: DV) => dv.spec.storage?.storageClassName || dv.spec.pvc?.storageClassName || "default";
const dvSource = (dv: DV) => dv.spec.source ? Object.keys(dv.spec.source)[0] : "blank";
/** Instances whose volumes reference the DataVolume, keyed by namespace/name. */
const dvAttachments = (vms: VM[]) => {
  const index: Record<string, string> = {};
  vms.forEach((vm) => (vm.spec.template?.spec?.volumes || []).forEach((volume) => {
    if (volume.dataVolume?.name) index[`${vm.metadata.namespace}/${volume.dataVolume.name}`] = vm.metadata.name;
  }));
  return index;
};

function DVList() {
  const [dvs, setDvs] = useState<DV[]>([]); const [vms, setVms] = useState<VM[]>([]); const [loading, setLoading] = useState(true); const [searchTerm, setSearchTerm] = useState(""); const [nss, setNss] = useState<string[]>(["all"]); const [namespaceFilter, setNamespaceFilter] = useState("all");
  const loadDvs = useCallback(async () => {
    setLoading(true);
    try {
      const scope = namespaceFilter === "all" ? "" : `/namespaces/${namespaceFilter}`;
      const [dvData, vmData] = await Promise.all([
        apiFetch(`/apis/cdi.kubevirt.io/v1beta1${scope}/datavolumes`).then(r => r.ok ? r.json() : { items: [] }),
        apiFetch(`/apis/kubevirt.io/v1${scope}/virtualmachines`).then(r => r.ok ? r.json() : { items: [] }),
      ]);
      setDvs(dvData.items || []);
      setVms(vmData.items || []);
    } finally { setLoading(false); }
  }, [namespaceFilter]);
  useEffect(() => {
    apiFetch("/api/v1/namespaces-list").then(r => r.json()).then((data) => setNss(Array.from(new Set(["all", ...(data || []).filter(Boolean)]))));
  }, []);
  useEffect(() => { loadDvs(); }, [loadDvs]);
  const attachedTo = dvAttachments(vms);
  const needle = searchTerm.toLowerCase();
  const filtered = dvs.filter(dv => dv.metadata.name.toLowerCase().includes(needle) || dv.metadata.namespace.toLowerCase().includes(needle));
  return (
    <div className="space-y-4">
      <PageHeader
        title="Disks"
        badge={!loading && <span className="text-sm text-muted-foreground tabular-nums">{dvs.length}</span>}
        subtitle="CDI DataVolumes"
        actions={<ResourceCreateDialog config={dvCreateConfig} onCreated={loadDvs} defaultNamespace={namespaceFilter === "all" ? "default" : namespaceFilter} />}
      />
      <Toolbar
        right={
          <div className="relative w-full md:w-[280px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Filter by name or namespace" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
          </div>
        }
      >
        <Button size="sm" variant="outline" onClick={loadDvs} className="gap-2"><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />Refresh</Button>
        <NativeSelect className="min-w-[160px]" value={namespaceFilter} onChange={e => setNamespaceFilter(e.target.value)} aria-label="Namespace">
          {nss.map(ns => <option key={ns} value={ns}>{ns === "all" ? "All namespaces" : ns}</option>)}
        </NativeSelect>
      </Toolbar>
      <DataTable
        loading={loading}
        rows={filtered}
        rowKey={(dv) => dv.metadata.uid}
        empty={<EmptyState title={searchTerm ? "No matching disks" : "No disks"} />}
        columns={[
          {
            header: "Name",
            cell: (dv) => (
              <div>
                <Link to={`/kubevirt/cdi/data-volumes/${dv.metadata.namespace}/${dv.metadata.name}/overview`} className="font-medium hover:text-primary transition-colors">{dv.metadata.name}</Link>
                <div className="text-xs text-muted-foreground">{dv.metadata.namespace}</div>
              </div>
            ),
          },
          { header: "Status", cell: (dv) => <StatusDot status={dv.status?.phase} label={dv.status?.phase && dv.status.progress && dv.status.phase !== "Succeeded" ? `${dv.status.phase} ${dv.status.progress}` : undefined} /> },
          { header: "Size", cell: (dv) => <span className="font-mono text-xs">{dvSize(dv)}</span> },
          { header: "Storage class", cell: (dv) => <span className="text-sm text-muted-foreground">{dvStorageClass(dv)}</span> },
          { header: "Source", cell: (dv) => <span className="text-sm text-muted-foreground">{dvSource(dv)}</span> },
          {
            header: "Attached to",
            cell: (dv) => {
              const vm = attachedTo[`${dv.metadata.namespace}/${dv.metadata.name}`];
              return vm ? <Link to={`/kubevirt/virtualization/virtual-machines/${dv.metadata.namespace}/${vm}/overview`} className="text-sm hover:text-primary transition-colors">{vm}</Link> : <span className="text-sm text-muted-foreground">-</span>;
            },
          },
          { header: "Age", className: "text-right", cell: (dv) => <span className="text-sm text-muted-foreground tabular-nums" title={dv.metadata.creationTimestamp}>{relativeTime(dv.metadata.creationTimestamp)}</span> },
        ]}
      />
    </div>
  );
}

function VMDetailContent() {
  const { namespace, name, tab } = useParams(); const navigate = useNavigate(); const [vm, setVm] = useState<VM | null>(null); const [vmi, setVmi] = useState<VMI | null>(null); const [vmYaml, setVmYaml] = useState(""); const [associatedDVs, setAssociatedDVs] = useState<DV[]>([]); const [events, setEvents] = useState<K8sEvent[]>([]); const [metrics, setMetrics] = useState<MetricPoint[]>([]); const [loading, setLoading] = useState(true); const [mStrategy, setMStrategy] = useState<string | null>(null); const [dialog, setDialog] = useState<string | null>(null); const { provider: sgProvider, providers: sgProviders } = useSgProvider(); const profile = useNetworkProfile();
  const activeTab = tab === "yaml" ? "manifest" : tab || "overview";
  const fetchData = useCallback(async () => {
    try {
      const [vmRes, vmiRes, yamlRes, eventsRes] = await Promise.all([ apiFetch(`/apis/kubevirt.io/v1/namespaces/${namespace}/virtualmachines/${name}`), apiFetch(`/apis/kubevirt.io/v1/namespaces/${namespace}/virtualmachineinstances/${name}`), apiFetch(`/api/v1/yaml/virtualmachines/${namespace}/${name}`), apiFetch(`/api/v1/namespaces/${namespace}/events?fieldSelector=involvedObject.name=${name}`) ]);
      const rawVmData: unknown = vmRes.ok ? await vmRes.json() : null; const vmData = isVm(rawVmData) ? rawVmData : null; setVm(vmData); setVmi(vmiRes.ok ? await vmiRes.json() : null); if (yamlRes.ok) setVmYaml(await yamlRes.text()); if (eventsRes.ok) setEvents((await eventsRes.json()).items || []);
      let strat = mStrategy; if (strat === null) { const apisRes = await apiFetch("/apis"); if (apisRes.ok) { strat = (await apisRes.json()).groups?.some((g: unknown) => namedApiGroup(g) && g.name === "metrics.kubevirt.io") ? "vmi" : "pod"; setMStrategy(strat); } }
      if (strat === "vmi") { const m = await apiFetch(`/apis/metrics.kubevirt.io/v1beta1/namespaces/${namespace}/virtualmachineinstances/${name}`); if (m.ok) { const d = await m.json(); setMetrics(p => [...p.slice(-19), { timestamp: Date.now(), time: new Date().toISOString(), cpuUsage: d.status?.cpu?.usageCores || 0, memoryUsage: (d.status?.memory?.usageBytes || 0) / (1024 * 1024) }]); } }
      else if (strat === "pod") { const pod = await findVmPod(namespace!, name!); if (pod) { const pm = await apiFetch(`/apis/metrics.k8s.io/v1beta1/namespaces/${namespace}/pods/${pod.metadata.name}`); if (pm.ok) { const d = await pm.json(); const cpu = d.containers?.[0]?.usage?.cpu || "0n"; const mem = d.containers?.[0]?.usage?.memory || "0Ki"; const pCpu = (c:string) => c.endsWith("n") ? parseInt(c)/1e9 : c.endsWith("u") ? parseInt(c)/1e6 : c.endsWith("m") ? parseInt(c)/1e3 : parseInt(c); const pMem = (m:string) => m.endsWith("Ki") ? parseInt(m)/1024 : m.endsWith("Mi") ? parseInt(m) : m.endsWith("Gi") ? parseInt(m)*1024 : parseInt(m)/(1024*1024); setMetrics(p => [...p.slice(-19), { timestamp: Date.now(), time: new Date().toISOString(), cpuUsage: pCpu(cpu), memoryUsage: pMem(mem) }]); } } }
      if (vmData?.spec.template?.spec?.volumes) { const dns = vmData.spec.template.spec.volumes.filter((v) => v.dataVolume).map((v) => v.dataVolume!.name); if (dns.length > 0) { const ds = await Promise.all(dns.map((dn:string) => apiFetch(`/apis/cdi.kubevirt.io/v1beta1/namespaces/${namespace}/datavolumes/${dn}`).then(r => r.ok ? r.json() : null))); setAssociatedDVs(ds.filter(d => d !== null)); } }
    } finally { setLoading(false); }
  }, [mStrategy, name, namespace]);
  useEffect(() => { fetchData(); const t = setInterval(fetchData, 5000); return () => clearInterval(t); }, [fetchData]);
  const handleAction = async (a:string) => {
    let res: Response;
    if (a === "pause" || a === "unpause") {
      res = await apiFetch(`/apis/subresources.kubevirt.io/v1/namespaces/${namespace}/virtualmachineinstances/${name}/${a}`, jsonPut());
    } else if (a === "poweroff") {
      // Deleting the VMI would be undone immediately for runStrategy Always; stop with no grace period instead.
      res = await apiFetch(`/apis/subresources.kubevirt.io/v1/namespaces/${namespace}/virtualmachines/${name}/stop`, jsonPut({ gracePeriod: 0 }));
    } else if (a === "migrate") {
      res = await apiFetch(`/apis/kubevirt.io/v1/namespaces/${namespace}/virtualmachineinstancemigrations`, jsonPost({
        apiVersion: "kubevirt.io/v1",
        kind: "VirtualMachineInstanceMigration",
        metadata: { generateName: `${name}-migration-`, namespace },
        spec: { vmiName: name },
      }));
    } else {
      res = await apiFetch(`/apis/subresources.kubevirt.io/v1/namespaces/${namespace}/virtualmachines/${name}/${a}`, jsonPut());
    }
    if (!res.ok) {
      const text = await res.text();
      let message = text;
      try { message = (JSON.parse(text) as { message?: string }).message || text; } catch { /* plain text error */ }
      toast.error(`${a} failed`, { description: message || res.statusText });
    }
    fetchData();
  };
  const vmPatchUrl = `/apis/kubevirt.io/v1/namespaces/${namespace}/virtualmachines/${name}`;

  if (loading && !vm) return (
    <div className="flex items-center justify-center h-64 gap-2">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-primary" />
      <span className="text-sm text-muted-foreground">Loading...</span>
    </div>
  );
  if (!vm) return (
    <div className="p-12 text-center text-muted-foreground border-2 border-dashed rounded-lg mt-8">
      Virtual machine not found
    </div>
  );
  const currentCpu = vm.spec.template?.spec?.domain?.cpu || {};
  const currentMemory = vm.spec.template?.spec?.domain?.resources?.requests?.memory || "1Gi";
  const isRunning = vmi?.status.phase === "Running";
  const templateAnnotations = vm.spec.template?.metadata?.annotations || {};
  const securityGroups = vmSecurityGroupRefs(vm as unknown as KubeObject, sgProviders);

  const tabs = [
    { id: "overview", name: "Overview", icon: Info },
    { id: "network", name: "Network & Security", icon: ShieldCheck },
    { id: "events", name: "Events", icon: Bell },
    { id: "console", name: "Console", icon: Terminal },
    { id: "vnc", name: "VNC", icon: MousePointer2 },
    { id: "manifest", name: "Manifest", icon: FileCode },
  ];

  return (
    <div className={cn("space-y-6", activeTab === "console" || activeTab === "vnc" ? "max-w-full" : "")}>
      <PageHeader
        breadcrumbs={[{ label: "Instances", to: "/kubevirt/virtualization/virtual-machines" }, { label: vm.metadata.namespace }, { label: vm.metadata.name }]}
        title={vm.metadata.name}
        badge={<StatusDot status={vm.status?.printableStatus} />}
        subtitle={[vm.metadata.namespace, vmi?.status.interfaces?.[0]?.ipAddress, vmi?.status.nodeName].filter(Boolean).join(" / ")}
        actions={
          <>
            {isRunning ? (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => handleAction("stop")}><Square className="size-3.5" />Stop</Button>
            ) : (
              <Button size="sm" className="gap-1.5" onClick={() => handleAction("start")}><Play className="size-3.5" />Start</Button>
            )}
            <Button size="sm" variant="outline" className="gap-1.5" disabled={!isRunning} onClick={() => handleAction("restart")}><RotateCcw className="size-3.5" />Restart</Button>
            <Button size="sm" variant="outline" className="gap-1.5" disabled={!isRunning} onClick={() => navigate(`/kubevirt/virtualization/virtual-machines/${namespace}/${name}/vnc`)}><MonitorPlay className="size-3.5" />Connect</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="gap-1.5">More<ChevronDown className="size-3.5" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel>Power</DropdownMenuLabel>
                <DropdownMenuItem disabled={!isRunning} onClick={() => handleAction("pause")}>Pause</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleAction("unpause")}>Resume</DropdownMenuItem>
                <DropdownMenuItem disabled={!isRunning} onClick={() => handleAction("poweroff")}>Force power off</DropdownMenuItem>
                <DropdownMenuItem disabled={!isRunning} onClick={() => handleAction("migrate")}>Live migrate</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Configuration</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => setDialog("Resize")}>Change spec</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setDialog("Instance Type")}>Change instance type</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setDialog("Run Strategy")}>Run strategy</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setDialog("Priority Class")}>Priority class</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setDialog("Metadata")}>Labels and annotations</DropdownMenuItem>
                {sgProvider && <DropdownMenuItem onClick={() => setDialog("Security Groups")}>Security groups</DropdownMenuItem>}
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Disks</DropdownMenuLabel>
                <DropdownMenuItem disabled={!isRunning} onClick={() => setDialog("Hotplug Volume")}>Attach disk</DropdownMenuItem>
                <DropdownMenuItem disabled={!isRunning} onClick={() => setDialog("Unplug Volume")}>Detach disk</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => setDialog("Delete")}>Delete instance</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />
          <VmActionDialog
            label="Resize"
            open={dialog === "Resize"}
            onOpenChange={(next) => setDialog(next ? "Resize" : null)}
            description={vm.spec.instancetype?.name ? `CPU and memory come from instance type ${vm.spec.instancetype.name}. Change the instance type instead.` : "Set CPU topology and memory. Takes effect on the next restart unless CPU/memory hotplug is enabled."}
            fields={[
              { name: "sockets", label: "Sockets", type: "number", defaultValue: String(currentCpu.sockets || 1) },
              { name: "cores", label: "Cores", type: "number", defaultValue: String(currentCpu.cores || 1) },
              { name: "threads", label: "Threads", type: "number", defaultValue: String(currentCpu.threads || 1) },
              { name: "memory", label: "Memory", defaultValue: currentMemory },
            ]}
            buildRequest={(values) => {
              if (vm.spec.instancetype?.name) throw new Error("This VM uses an instance type; change the instance type to resize it.");
              return {
              url: vmPatchUrl,
              options: mergePatch({
                spec: {
                  template: {
                    spec: {
                      domain: {
                        cpu: {
                          sockets: numberValue(values.sockets, 1),
                          cores: numberValue(values.cores, 1),
                          threads: numberValue(values.threads, 1),
                        },
                        resources: { requests: { memory: stringValue(values.memory, "1Gi") } },
                      },
                    },
                  },
                },
              }),
            };
            }}
            onDone={fetchData}
          />
          <VmActionDialog
            label="Run Strategy"
            open={dialog === "Run Strategy"}
            onOpenChange={(next) => setDialog(next ? "Run Strategy" : null)}
            description="How KubeVirt keeps this VM running."
            fields={[{ name: "runStrategy", label: "Run Strategy", type: "select", defaultValue: vm.spec.runStrategy || (vm.spec.running ? "Always" : "Halted"), options: [{ label: "Always", value: "Always" }, { label: "RerunOnFailure", value: "RerunOnFailure" }, { label: "Halted", value: "Halted" }, { label: "Manual", value: "Manual" }] }]}
            // runStrategy and the legacy spec.running field are mutually exclusive.
            buildRequest={(values) => ({ url: vmPatchUrl, options: mergePatch({ spec: { runStrategy: stringValue(values.runStrategy, "Halted"), running: null } }) })}
            onDone={fetchData}
          />
          <VmActionDialog
            label="Instance Type"
            open={dialog === "Instance Type"}
            onOpenChange={(next) => setDialog(next ? "Instance Type" : null)}
            description="CPU and memory come from the instance type, replacing the template's own sizing. Leave empty to remove it, then set CPU and memory with Change spec."
            fields={[{ name: "instanceType", label: "Cluster Instance Type", defaultValue: String(vm.spec.instancetype?.name || "") }]}
            buildRequest={(values) => {
              const instanceType = stringValue(values.instanceType);
              // KubeVirt rejects template CPU/memory alongside an instance type, so clear them when setting one.
              const spec = instanceType
                ? { instancetype: { kind: "VirtualMachineClusterInstancetype", name: instanceType }, template: { spec: { domain: { cpu: null, memory: null, resources: { requests: { memory: null } } } } } }
                : { instancetype: null, template: { spec: { domain: { cpu: { sockets: 1, cores: 1, threads: 1 }, resources: { requests: { memory: "1Gi" } } } } } };
              return { url: vmPatchUrl, options: mergePatch({ spec }) };
            }}
            onDone={fetchData}
          />
          <VmActionDialog
            label="Priority Class"
            open={dialog === "Priority Class"}
            onOpenChange={(next) => setDialog(next ? "Priority Class" : null)}
            description="Patch template priorityClassName on this VirtualMachine."
            fields={[{ name: "priorityClassName", label: "Priority Class Name", defaultValue: String(vm.spec.template?.spec?.priorityClassName || "") }]}
            buildRequest={(values) => ({ url: vmPatchUrl, options: mergePatch({ spec: { template: { spec: { priorityClassName: stringValue(values.priorityClassName) || null } } } }) })}
            onDone={fetchData}
          />
          <VmActionDialog
            label="Metadata"
            open={dialog === "Metadata"}
            onOpenChange={(next) => setDialog(next ? "Metadata" : null)}
            description="Labels and annotations on the VirtualMachine object. One key=value per line; removed lines are deleted."
            fields={[
              { name: "labels", label: "Labels", type: "textarea", defaultValue: keyValueText(vm.metadata.labels) },
              { name: "annotations", label: "Annotations", type: "textarea", defaultValue: keyValueText(vm.metadata.annotations) },
            ]}
            buildRequest={(values) => {
              // Only the VM object: template labels drive the launcher pod (domain, security groups) and must not be overwritten here.
              return {
                url: vmPatchUrl,
                options: mergePatch({
                  metadata: {
                    labels: replaceMap(vm.metadata.labels, parseKeyValueText(values.labels || "")),
                    annotations: replaceMap(vm.metadata.annotations, parseKeyValueText(values.annotations || "")),
                  },
                }),
              };
            }}
            onDone={fetchData}
          />
          <VmActionDialog
            label="Hotplug Volume"
            open={dialog === "Hotplug Volume"}
            onOpenChange={(next) => setDialog(next ? "Hotplug Volume" : null)}
            description="Attach an existing DataVolume to the running VMI."
            fields={[
              { name: "volume", label: "DataVolume Name", defaultValue: "" },
              { name: "type", label: "Device Type", type: "select", defaultValue: "disk", options: [{ label: "Disk", value: "disk" }, { label: "CD-ROM", value: "cdrom" }, { label: "LUN", value: "lun" }] },
              { name: "cache", label: "Cache Mode", type: "select", defaultValue: "none", options: [{ label: "none", value: "none" }, { label: "writeback", value: "writeback" }, { label: "writethrough", value: "writethrough" }] },
              { name: "readonly", label: "Read Only", type: "select", defaultValue: "false", options: [{ label: "No", value: "false" }, { label: "Yes", value: "true" }] },
            ]}
            buildRequest={(values) => {
              const volume = stringValue(values.volume);
              const readonly = values.readonly === "true";
              const disk: Record<string, unknown> = { name: volume, serial: volume, cache: stringValue(values.cache, "none") };
              if (values.type === "cdrom") disk.cdrom = { readonly };
              else if (values.type === "lun") disk.lun = { readonly, bus: "scsi" };
              else disk.disk = { readonly, bus: "scsi" };
              return {
                url: `/apis/subresources.kubevirt.io/v1/namespaces/${namespace}/virtualmachineinstances/${name}/addvolume`,
                options: jsonPut({ name: volume, disk, volumeSource: { dataVolume: { name: volume, hotpluggable: true } } }),
              };
            }}
            onDone={fetchData}
          />
          <VmActionDialog
            label="Unplug Volume"
            open={dialog === "Unplug Volume"}
            onOpenChange={(next) => setDialog(next ? "Unplug Volume" : null)}
            description="Detach a hotplugged volume from the running VMI."
            fields={[{ name: "volume", label: "Volume Name", defaultValue: "" }]}
            buildRequest={(values) => ({
              url: `/apis/subresources.kubevirt.io/v1/namespaces/${namespace}/virtualmachineinstances/${name}/removevolume`,
              options: jsonPut({ name: stringValue(values.volume) }),
            })}
            onDone={fetchData}
          />
          <VmActionDialog
            label="Delete"
            open={dialog === "Delete"}
            onOpenChange={(next) => setDialog(next ? "Delete" : null)}
            description="Delete this VirtualMachine resource."
            fields={[]}
            variant="destructive"
            buildRequest={() => ({
              url: `/apis/kubevirt.io/v1/namespaces/${namespace}/virtualmachines/${name}`,
              options: { method: "DELETE", headers: { Accept: "application/json" } },
            })}
            onDone={() => navigate("/kubevirt/virtualization/virtual-machines")}
          />
      <InstanceSecurityGroupsDialog
        open={dialog === "Security Groups"}
        onOpenChange={(next) => setDialog(next ? "Security Groups" : null)}
        vm={vm as unknown as KubeObject}
        onDone={fetchData}
      />

      {/* Tab Navigation */}
      <div className="flex gap-1 border-b">
        {tabs.map(t => (
          <Link
            key={t.id}
            to={`/kubevirt/virtualization/virtual-machines/${namespace}/${name}/${t.id}`}
            className={cn(
              "flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              activeTab === t.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
            )}
          >
            <t.icon className="h-4 w-4" />
            {t.name}
          </Link>
        ))}
      </div>

      {/* Tab Content */}
      <div className="mt-4">
        {activeTab === "overview" && (
          <div className="space-y-6">
            <div className="rounded-lg border bg-card">
              <div className="grid divide-y md:grid-cols-3 md:divide-x md:divide-y-0">
                {[
                  {
                    title: "Instance",
                    items: [
                      { label: "Status", value: <StatusDot status={vm.status?.printableStatus} /> },
                      { label: "Run strategy", value: vm.spec.runStrategy || (vm.spec.running ? "Always" : "Halted") },
                      { label: "Namespace", value: vm.metadata.namespace },
                      { label: "Created", value: relativeTime(vm.metadata.creationTimestamp) },
                    ],
                  },
                  {
                    title: "Compute",
                    items: [
                      { label: "vCPU", value: `${(currentCpu.sockets || 1) * (currentCpu.cores || 1) * (currentCpu.threads || 1)} (${currentCpu.sockets || 1} x ${currentCpu.cores || 1} x ${currentCpu.threads || 1})` },
                      { label: "Memory", value: vm.spec.template?.spec?.domain?.resources?.requests?.memory || "From instance type" },
                      { label: "Instance type", value: vm.spec.instancetype?.name || "Custom" },
                      { label: "Machine / arch", value: `${vm.spec.template?.spec?.domain?.machine?.type || "default"} / ${vm.spec.template?.spec?.architecture || "default"}` },
                    ],
                  },
                  {
                    title: "Runtime",
                    items: [
                      { label: "Private IP", value: <span className="font-mono">{vmi?.status.interfaces?.[0]?.ipAddress || "-"}</span> },
                      { label: "Host", value: vmi?.status.nodeName || "Not running" },
                      { label: "Subnet", value: templateAnnotations[kubeOvnAnnotations.logicalSwitch] || (profile.vpc ? "Namespace default" : "Pod network") },
                      { label: "Priority class", value: vm.spec.template?.spec?.priorityClassName || "None" },
                    ],
                  },
                ].map((group) => (
                  <div key={group.title} className="space-y-3 px-4 py-3.5">
                    <div className="text-sm font-semibold">{group.title}</div>
                    <dl className="space-y-2 text-sm">
                      {group.items.map((item) => (
                        <div key={item.label} className="flex items-center justify-between gap-4">
                          <dt className="text-muted-foreground">{item.label}</dt>
                          <dd className="min-w-0 truncate text-right">{item.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))}
              </div>
            </div>

            {/* Metrics charts */}
            {vmi && metrics.length > 0 && (
              <div className="grid gap-4 md:grid-cols-2">
                <Panel title="CPU Usage">
                    <div className="h-[160px] w-full">
                      <ResponsiveContainer>
                        <AreaChart data={metrics}>
                          <defs>
                            <linearGradient id="colorCpu" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.1} />
                              <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-muted" />
                          <XAxis dataKey="time" hide />
                          <YAxis fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => `${v.toFixed(2)}`} />
                          <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid var(--border)', fontSize: '11px' }} />
                          <Area type="monotone" dataKey="cpuUsage" stroke="var(--primary)" fill="url(#colorCpu)" animationDuration={300} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </Panel>

                <Panel title="Memory Usage (MB)">
                    <div className="h-[160px] w-full">
                      <ResponsiveContainer>
                        <AreaChart data={metrics}>
                          <defs>
                            <linearGradient id="colorMem" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.1} />
                              <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-muted" />
                          <XAxis dataKey="time" hide />
                          <YAxis fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => `${Math.round(v)}`} />
                          <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid var(--border)', fontSize: '11px' }} />
                          <Area type="monotone" dataKey="memoryUsage" stroke="var(--primary)" fill="url(#colorMem)" animationDuration={300} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </Panel>
              </div>
            )}

            {/* Metadata, Storage, Networking */}
            <div className="grid gap-4 lg:grid-cols-3">
              <RelatedPodsCard
                className="lg:col-span-3"
                title="Virtual Machine Pods"
                description="Pods created for this VM runtime. Use these for logs and shell access."
                namespace={namespace!}
                selectors={vmPodSelectors(name!)}
              />

              <Panel title="Metadata" className="lg:col-span-3">
                  <div className="grid md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <div className="mb-2 text-xs font-medium text-muted-foreground">Labels</div>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(vm.spec.template?.metadata?.labels || {}).map(([k, v]) => (
                          <span key={k} className="px-2 py-1 bg-muted text-foreground rounded-md text-xs border">{k}: {v}</span>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="mb-2 text-xs font-medium text-muted-foreground">Annotations</div>
                      <div className="grid grid-cols-1 gap-2">
                        {Object.entries(vm.spec.template?.metadata?.annotations || {}).slice(0, 8).map(([k, v]) => (
                          <CopyableText key={k} label={k} text={String(v)} />
                        ))}
                      </div>
                    </div>
                  </div>
                </Panel>

              <Panel title="Storage">
                  <div className="space-y-2">
                    {associatedDVs.map(d => (
                      <div key={d.metadata.uid} className="flex items-center justify-between text-sm p-2 bg-muted/30 rounded-lg border gap-4">
                        <Link to={`/kubevirt/cdi/data-volumes/${d.metadata.namespace}/${d.metadata.name}/overview`} className="font-medium hover:text-primary transition-colors flex-1">{d.metadata.name}</Link>
                        <StatusBadge status={d.status?.phase} />
                      </div>
                    ))}
                    {associatedDVs.length === 0 && <p className="text-sm text-muted-foreground">No storage volumes</p>}
                  </div>
                </Panel>

              <Panel title="Disks">
                  <div className="space-y-2">
                    {(vm.spec.template?.spec?.domain?.devices?.disks || []).map((disk) => (
                      <div key={disk.name} className="grid gap-1 rounded-lg border bg-muted/30 p-3 text-sm">
                        <div className="font-medium">{disk.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {disk.disk ? `disk ${disk.disk.bus || ""}` : disk.cdrom ? `cdrom ${disk.cdrom.bus || ""}` : disk.lun ? `lun ${disk.lun.bus || ""}` : "device"}
                          {disk.bootOrder ? ` / boot ${disk.bootOrder}` : ""}
                        </div>
                      </div>
                    ))}
                    {((vm.spec.template?.spec?.domain?.devices?.disks || []).length === 0) && <p className="text-sm text-muted-foreground">No disks declared</p>}
                  </div>
                </Panel>

              <Panel title="Volumes">
                  <div className="space-y-2">
                    {(vm.spec.template?.spec?.volumes || []).map((volume) => (
                      <div key={volume.name} className="grid gap-1 rounded-lg border bg-muted/30 p-3 text-sm">
                        <div className="font-medium">{volume.name}</div>
                        <div className="text-xs text-muted-foreground">{Object.keys(volume).filter((key) => key !== "name").join(", ") || "volume"}</div>
                      </div>
                    ))}
                    {(vm.spec.template?.spec?.volumes || []).length === 0 && <p className="text-sm text-muted-foreground">No volumes declared</p>}
                  </div>
                </Panel>

              <Panel title="Networking">
                  <div className="space-y-2">
                    {(vm.spec.template?.spec?.domain?.devices?.interfaces || []).map((i) => (
                      <div key={i.name} className="grid gap-1 text-sm p-3 bg-muted/30 rounded-lg border">
                        <div className="flex items-center justify-between gap-4">
                          <span className="font-medium">{i.name}</span>
                          <span className="font-mono text-xs text-muted-foreground">{vmi?.status.interfaces?.find((runtime) => runtime.name === i.name)?.ipAddress || "disconnected"}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">{Object.keys(i).filter((key) => key !== "name").join(", ")}</div>
                      </div>
                    ))}
                  </div>
                </Panel>

              <Panel title="Conditions" className="lg:col-span-3">
                  <div className="grid gap-2 md:grid-cols-2">
                    {(vm.status?.conditions || []).map((condition) => (
                      <div key={condition.type} className="rounded-lg border bg-muted/30 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-medium text-sm">{condition.type}</span>
                          <StatusBadge status={condition.status} />
                        </div>
                        {(condition.reason || condition.message) && <p className="mt-2 text-xs text-muted-foreground">{condition.reason} {condition.message}</p>}
                      </div>
                    ))}
                    {(vm.status?.conditions || []).length === 0 && <p className="text-sm text-muted-foreground">No conditions reported</p>}
                  </div>
                </Panel>
            </div>
          </div>
        )}

        {activeTab === "network" && (
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Network interfaces" className="lg:col-span-2">
                <DataTable
                  minWidth={640}
                  rows={vm.spec.template?.spec?.domain?.devices?.interfaces || []}
                  rowKey={(iface) => iface.name}
                  empty={<EmptyState title="No interfaces declared" />}
                  columns={[
                    { header: "Interface", cell: (iface) => <span className="font-medium">{iface.name}</span> },
                    { header: "Binding", cell: (iface) => <span className="text-sm">{Object.keys(iface).filter((key) => !["name", "model", "macAddress"].includes(key)).join(", ") || "N/A"}</span> },
                    {
                      header: "Network",
                      cell: (iface) => {
                        const network = vm.spec.template?.spec?.networks?.find((item) => item.name === iface.name) as Record<string, unknown> | undefined;
                        if (!network) return <span className="text-sm text-muted-foreground">N/A</span>;
                        if (network.multus) return <span className="text-sm">Multus {String((network.multus as Record<string, unknown>).networkName)}</span>;
                        const subnet = templateAnnotations[kubeOvnAnnotations.logicalSwitch];
                        return subnet ? <Link to={`/vpc/subnets/${subnet}`} className="text-sm hover:text-primary transition-colors">Subnet {subnet}</Link> : <span className="text-sm">Pod network</span>;
                      },
                    },
                    { header: "IP addresses", cell: (iface) => <span className="font-mono text-xs">{(vmi?.status.interfaces?.find((item) => item.name === iface.name) as { ipAddresses?: string[]; ipAddress?: string } | undefined)?.ipAddresses?.join(", ") || vmi?.status.interfaces?.find((item) => item.name === iface.name)?.ipAddress || "-"}</span> },
                    { header: "MAC", cell: (iface) => <span className="font-mono text-xs text-muted-foreground">{(vmi?.status.interfaces?.find((item) => item.name === iface.name) as { mac?: string } | undefined)?.mac || "-"}</span> },
                  ]}
                />
              </Panel>
            <Panel title="Placement">
                <KeyValueGrid items={[
                  { label: "Subnet", value: templateAnnotations[kubeOvnAnnotations.logicalSwitch] || (profile.vpc ? "Namespace default" : "Pod network") },
                  { label: "Fixed IP", value: templateAnnotations[kubeOvnAnnotations.ipAddress] || "Dynamic" },
                  { label: "Port security", value: templateAnnotations[kubeOvnAnnotations.portSecurity] === "true" ? "Enabled" : "Disabled" },
                  { label: "Host", value: vmi?.status.nodeName || "Not running" },
                ]} />
              </Panel>
            <Panel
              title="Security groups"
              description={sgProviders.length ? sgProviders.map((engine) => engineLabel[engine]).join(" / ") : "Not available on this network stack"}
              actions={sgProvider && <Button size="sm" variant="outline" onClick={() => setDialog("Security Groups")}>Change</Button>}
              bodyClassName="space-y-1.5"
            >
              {securityGroups.map((group) => (
                <Link key={`${group.provider}:${group.name}`} to={sgDetailPath({ ...group, namespace })} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-muted/50 hover:text-primary">
                  <ShieldCheck className="size-4 text-muted-foreground" />{group.name}
                  {sgProviders.length > 1 && <span className="ml-auto text-xs text-muted-foreground">{engineLabel[group.provider]}</span>}
                </Link>
              ))}
              {sgProvider && securityGroups.length === 0 && <p className="text-sm text-muted-foreground">None attached.</p>}
              {!sgProvider && <p className="text-sm text-muted-foreground">Use <Link to="/networks/kubernetes/network-policies" className="text-primary hover:underline">network policies</Link> instead.</p>}
            </Panel>
          </div>
        )}

        {activeTab === "events" && (
          <DataTable
            minWidth={680}
            rows={[...events].sort((a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime())}
            rowKey={(e) => e.metadata.uid}
            empty={<EmptyState title="No events" />}
            columns={[
              { header: "Type", cell: (e) => <StatusDot status={e.type === "Normal" ? "Ready" : "Error"} label={e.type} /> },
              { header: "Reason", cell: (e) => <span className="text-sm font-medium">{e.reason}</span> },
              { header: "Message", cell: (e) => <span className="text-sm text-muted-foreground">{e.message}</span> },
              { header: "Age", className: "text-right", cell: (e) => <span className="text-sm text-muted-foreground tabular-nums" title={e.lastTimestamp}>{relativeTime(e.lastTimestamp)}</span> },
            ]}
          />
        )}

        {activeTab === "console" && <SerialConsole namespace={namespace!} name={name!} />}
        {activeTab === "vnc" && <VncConsole namespace={namespace!} name={name!} />}

        {activeTab === "manifest" && (
          <pre className="min-h-[400px] overflow-x-auto rounded-lg border bg-card p-4 font-mono text-[13px] leading-relaxed text-foreground whitespace-pre">{vmYaml || "Loading..."}</pre>
        )}
      </div>
    </div>
  );
}

function DVDetailContent() {
  const { namespace, name, tab } = useParams(); const navigate = useNavigate(); const [dv, setDv] = useState<DV | null>(null); const [dvYaml, setDvYaml] = useState(""); const [loading, setLoading] = useState(true); const activeTab = tab === "yaml" ? "manifest" : tab || "overview";
  const loadDv = useCallback(async () => {
    setLoading(true);
    try {
      const [r, y] = await Promise.all([apiFetch(`/apis/cdi.kubevirt.io/v1beta1/namespaces/${namespace}/datavolumes/${name}`), apiFetch(`/api/v1/yaml/datavolumes/${namespace}/${name}`)]);
      if (r.ok) setDv(await r.json()); if (y.ok) setDvYaml(await y.text());
    } finally { setLoading(false); }
  }, [name, namespace]);
  useEffect(() => { loadDv(); }, [loadDv]);

  if (loading && !dv) return <LoadingState />;
  if (!dv) return (
    <div className="p-12 text-center text-muted-foreground border-2 border-dashed rounded-lg mt-8">
      DataVolume not found
    </div>
  );

  const tabs = [
    { id: "overview", name: "Overview", icon: Info },
    { id: "manifest", name: "Manifest", icon: FileCode },
  ];
  const conditions = dv.status?.conditions || [];
  const labels = Object.entries(dv.metadata.labels || {});

  return (
    <div className="space-y-5">
      <PageHeader
        breadcrumbs={[{ label: "Disks", to: "/kubevirt/cdi/data-volumes" }, { label: dv.metadata.namespace }, { label: dv.metadata.name }]}
        title={dv.metadata.name}
        badge={<StatusDot status={dv.status?.phase} />}
        subtitle={`${dvSize(dv)} · ${dvStorageClass(dv)}`}
        actions={
          <>
            <VmActionDialog
              label="Resize"
              description="Expand the PVC bound to this disk. Shrinking is not supported."
              fields={[{ name: "storage", label: "New size", defaultValue: dvSize(dv) === "N/A" ? "10Gi" : dvSize(dv) }]}
              buildRequest={(values) => ({
                url: `/api/v1/namespaces/${namespace}/persistentvolumeclaims/${dv.status?.claimName || name}`,
                options: mergePatch({ spec: { resources: { requests: { storage: stringValue(values.storage, "10Gi") } } } }),
              })}
              onDone={loadDv}
            />
            <VmActionDialog
              label="Labels"
              description="One key=value per line."
              fields={[
                { name: "labels", label: "Labels", type: "textarea", defaultValue: keyValueText(dv.metadata.labels) },
                { name: "annotations", label: "Annotations", type: "textarea", defaultValue: keyValueText(dv.metadata.annotations) },
              ]}
              buildRequest={(values) => ({
                url: `/apis/cdi.kubevirt.io/v1beta1/namespaces/${namespace}/datavolumes/${name}`,
                options: mergePatch({ metadata: { labels: replaceMap(dv.metadata.labels, parseKeyValueText(values.labels || "")), annotations: replaceMap(dv.metadata.annotations, parseKeyValueText(values.annotations || "")) } }),
              })}
              onDone={loadDv}
            />
            <VmActionDialog
              label="Delete"
              description={`Delete disk ${dv.metadata.namespace}/${dv.metadata.name} and its PVC.`}
              fields={[]}
              variant="destructive"
              buildRequest={() => ({
                url: `/apis/cdi.kubevirt.io/v1beta1/namespaces/${namespace}/datavolumes/${name}`,
                options: { method: "DELETE", headers: { Accept: "application/json" } },
              })}
              onDone={() => navigate("/kubevirt/cdi/data-volumes")}
            />
          </>
        }
      />

      <div className="flex gap-1 border-b">
        {tabs.map(t => (
          <Link
            key={t.id}
            to={`/kubevirt/cdi/data-volumes/${namespace}/${name}/${t.id}`}
            className={cn(
              "-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm transition-colors",
              activeTab === t.id ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <t.icon className="h-4 w-4" />
            {t.name}
          </Link>
        ))}
      </div>

      {activeTab === "overview" ? (
        <div className="space-y-4">
          <Panel title="Details">
            <KeyValueGrid items={[
              { label: "Size", value: <span className="font-mono">{dvSize(dv)}</span> },
              { label: "Storage class", value: dvStorageClass(dv) },
              { label: "Access modes", value: dv.spec.storage?.accessModes?.join(", ") || dv.spec.pvc?.accessModes?.join(", ") || "default" },
              { label: "Volume mode", value: dv.spec.storage?.volumeMode || dv.spec.pvc?.volumeMode || "default" },
              { label: "PVC", value: <Link to={`/storage/kubernetes/persistent-volume-claims/${dv.metadata.namespace}/${dv.status?.claimName || dv.metadata.name}`} className="hover:text-primary transition-colors">{dv.status?.claimName || dv.metadata.name}</Link> },
              { label: "Progress", value: dv.status?.progress || "N/A" },
              { label: "Source", value: dvSource(dv) },
              { label: "Created", value: relativeTime(dv.metadata.creationTimestamp) },
            ]} />
          </Panel>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Source">
              {dv.spec.source ? (
                <pre className="overflow-x-auto font-mono text-xs text-foreground whitespace-pre-wrap">{JSON.stringify(dv.spec.source, null, 2)}</pre>
              ) : <p className="text-sm text-muted-foreground">Blank disk</p>}
            </Panel>
            <Panel title="Conditions" bodyClassName="p-0">
              {conditions.length === 0 ? <p className="p-4 text-sm text-muted-foreground">None reported</p> : (
                <div className="divide-y">
                  {conditions.map((condition) => (
                    <div key={condition.type} className="flex items-start justify-between gap-4 px-4 py-2.5">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{condition.type}</div>
                        {(condition.reason || condition.message) && <p className="text-xs text-muted-foreground">{[condition.reason, condition.message].filter(Boolean).join(": ")}</p>}
                      </div>
                      <StatusDot status={condition.status} />
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>
          {labels.length > 0 && (
            <Panel title="Labels" bodyClassName="flex flex-wrap gap-1.5">
              {labels.map(([k, v]) => <span key={k} className="rounded border bg-muted/60 px-1.5 py-0.5 font-mono text-xs">{k}={v}</span>)}
            </Panel>
          )}
        </div>
      ) : (
        <pre className="min-h-[400px] overflow-x-auto rounded-lg border bg-card p-4 font-mono text-[13px] leading-relaxed text-foreground whitespace-pre">{dvYaml || "Loading..."}</pre>
      )}
    </div>
  );
}

function resourceRoutes(config: ResourceConfig) {
  return [
    <Route key={`${config.path}-list`} path={config.path} element={<ResourceList config={config} />} />,
    <Route key={`${config.path}-detail`} path={`${config.path}/:namespace/:name`} element={<ResourceDetail config={config} />} />,
    <Route key={`${config.path}-manifest`} path={`${config.path}/:namespace/:name/manifest`} element={<ResourceManifest config={config} />} />,
  ];
}

function App() {
  return (
    <BrowserRouter>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="min-h-0 overflow-y-auto">
          <SiteHeader />
          <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col px-4 py-6 lg:px-8 lg:py-8">
            <Routes>
              <Route path="/" element={<OverviewPage />} />
              <Route path="/catalog" element={<CatalogPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/vpc/vpcs" element={<VpcListPage />} />
              <Route path="/vpc/vpcs/:name" element={<VpcDetailPage />} />
              <Route path="/vpc/subnets" element={<SubnetListPage />} />
              <Route path="/vpc/subnets/:name" element={<SubnetDetailPage />} />
              <Route path="/vpc/security-groups" element={<SecurityGroupListPage />} />
              <Route path="/vpc/security-groups/:provider/:name" element={<SecurityGroupDetailPage />} />
              <Route path="/vpc/security-groups/:provider/:namespace/:name" element={<SecurityGroupDetailPage />} />
              <Route path="/kubernetes" element={<KubernetesManagementPage />} />
              <Route path="/kubernetes/:category" element={<KubernetesCategoryPage />} />
              <Route path="/kubevirt" element={<KubeVirtManagementPage />} />
              <Route path="/kubevirt/:category" element={<KubeVirtCategoryPage />} />
              <Route path="/kubevirt/virtualization/virtual-machines" element={<InstanceListPage />} />
              <Route path="/kubevirt/virtualization/virtual-machines/create" element={<CreateInstancePage />} />
              <Route path="/kubevirt/virtualization/virtual-machines/:namespace/:name" element={<Navigate to="overview" replace />} />
              <Route path="/kubevirt/virtualization/virtual-machines/:namespace/:name/:tab" element={<VMDetailContent />} />
              <Route path="/kubevirt/cdi/data-volumes" element={<DVList />} />
              <Route path="/kubevirt/cdi/data-volumes/:namespace/:name" element={<Navigate to="overview" replace />} />
              <Route path="/kubevirt/cdi/data-volumes/:namespace/:name/:tab" element={<DVDetailContent />} />
              <Route path="/storage" element={<StorageManagementPage />} />
              <Route path="/storage/:category" element={<StorageCategoryPage />} />
              <Route path="/networks" element={<NetworkManagementPage />} />
              <Route path="/networks/:category" element={<NetworkCategoryPage />} />
              {Object.values(resourceConfigs).flatMap(resourceRoutes)}
              <Route path="*" element={<div className="p-20 text-center text-muted-foreground border-2 border-dashed rounded-lg mt-12">Page not found</div>} />
            </Routes>
          </div>
        </SidebarInset>
        <Toaster />
      </SidebarProvider>
    </BrowserRouter>
  );
}

export default App;
