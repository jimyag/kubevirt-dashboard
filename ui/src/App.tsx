import { useCallback, useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Link, useParams, useNavigate, Navigate } from "react-router-dom";
import {
  Terminal, ChevronLeft, FileCode, Info, Network, HardDrive,
  Layers, ShieldCheck, Database, Bell, Clock, TrendingUp, BarChart3,
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
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card as ShadCard, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import { dvCreateConfig, jsonPost, jsonPut, keyValueText, mergePatch, numberValue, parseKeyValueText, resourceConfigs, stringValue } from "./resources/configs";
import { DataTable, EmptyState, KeyValueGrid, PageHeader, StatusDot } from "./components/console";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";
import { kubeOvnAnnotations, useNetworkProfile, type KubeObject } from "./lib/kube";
import { sgDetailPath, useSgProvider, vmSecurityGroups } from "./lib/security-groups";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./components/ui/table";

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
type StatusVariant = "outline" | "success" | "warning" | "danger";
function StatusBadge({ status }: { status?: string }) {
  if (!status) return <Badge variant="outline" className="text-muted-foreground">Unknown</Badge>;
  const lower = status.toLowerCase();
  let variant: StatusVariant = "outline";
  if (lower.includes("running") || lower.includes("succeeded") || lower.includes("ready") || lower.includes("true")) variant = "success";
  else if (lower.includes("error") || lower.includes("fail") || lower.includes("crash") || lower.includes("false")) variant = "danger";
  else if (lower.includes("start") || lower.includes("progress") || lower.includes("migrat") || lower.includes("import") || lower.includes("pending")) variant = "warning";
  return <Badge variant={variant}>{status}</Badge>;
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
function DVList() {
  const [dvs, setDvs] = useState<DV[]>([]); const [loading, setLoading] = useState(true); const [searchTerm, setSearchTerm] = useState(""); const [nss, setNss] = useState<string[]>(["all", "default"]); const [namespaceFilter, setNamespaceFilter] = useState("default");
  const loadDvs = useCallback(async () => {
    setLoading(true);
    try {
      const path = namespaceFilter === "all" ? "/apis/cdi.kubevirt.io/v1beta1/datavolumes" : `/apis/cdi.kubevirt.io/v1beta1/namespaces/${namespaceFilter}/datavolumes`;
      const data = await apiFetch(path).then(r => r.json());
      setDvs(data.items || []);
    } finally { setLoading(false); }
  }, [namespaceFilter]);
  useEffect(() => {
    apiFetch("/api/v1/namespaces-list").then(r => r.json()).then((data) => {
      const next = Array.from(new Set(["all", ...(data || []).filter(Boolean)]));
      setNss(next);
      setNamespaceFilter((current) => current && next.includes(current) ? current : next.includes("default") ? "default" : next.find((ns) => ns !== "all") || "all");
    });
  }, []);
  useEffect(() => { loadDvs(); }, [loadDvs]);
  const filtered = dvs.filter(dv => {
    const needle = searchTerm.toLowerCase();
    return dv.metadata.name.toLowerCase().includes(needle) || dv.metadata.namespace.toLowerCase().includes(needle);
  });
  return (
    <div className="space-y-4 animate-in fade-in duration-500">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold">Disks</h1>
          <p className="text-sm text-muted-foreground">Persistent disks for instances, backed by CDI DataVolumes</p>
        </div>
        <Badge variant="outline">{dvs.length} total</Badge>
      </div>
      <div className="flex flex-col gap-3 rounded-lg border bg-card p-2 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" className="gap-2 text-muted-foreground">
            <span className="size-2 rounded-full bg-muted-foreground/30" />
            Watch
          </Button>
          <Button size="sm" variant="outline" onClick={loadDvs} className="gap-2">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            Refresh
          </Button>
          <select className="h-9 min-w-[150px] rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring" value={namespaceFilter} onChange={e => setNamespaceFilter(e.target.value)} aria-label="Filter namespace">
            {nss.map(ns => <option key={ns} value={ns}>{ns}</option>)}
          </select>
        </div>
        <div className="flex w-full flex-col gap-2 md:w-auto md:flex-row md:items-center">
          <div className="relative w-full md:w-[320px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search storage..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
          </div>
          <ResourceCreateDialog config={dvCreateConfig} onCreated={loadDvs} defaultNamespace={namespaceFilter} />
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="max-h-[calc(100dvh-260px)] overflow-auto">
          <Table className="min-w-[760px]">
            <TableHeader className="bg-muted">
              <TableRow>
                <TableHead className="w-10"><input type="checkbox" className="size-4 rounded border-border accent-primary" aria-label="Select all storage resources" /></TableHead>
                <TableHead className="h-9 px-3 text-xs font-semibold">Name</TableHead>
                <TableHead className="h-9 px-3 text-xs font-semibold">Status</TableHead>
                <TableHead className="h-9 px-3 text-xs font-semibold">Capacity</TableHead>
                <TableHead className="h-9 px-3 text-right text-xs font-semibold">Source</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5}>
                    <div className="flex items-center justify-center h-32 gap-2">
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-primary" />
                      <span className="text-sm text-muted-foreground">Loading...</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="h-32 text-center text-muted-foreground">No storage resources found</TableCell></TableRow>
              ) : filtered.map(dv => (
                <TableRow key={dv.metadata.uid} className="hover:bg-muted/50">
                  <TableCell className="h-9 px-3 py-1.5"><input type="checkbox" className="size-4 rounded border-border accent-primary" aria-label={`Select ${dv.metadata.name}`} /></TableCell>
                  <TableCell className="h-9 px-3 py-1.5">
                    <Link to={`/kubevirt/cdi/data-volumes/${dv.metadata.namespace}/${dv.metadata.name}/overview`} className="font-semibold text-primary hover:underline">{dv.metadata.name}</Link>
                    <div className="text-xs text-muted-foreground">{dv.metadata.namespace}</div>
                  </TableCell>
                  <TableCell className="h-9 px-3 py-1.5"><StatusBadge status={dv.status?.phase} /></TableCell>
                  <TableCell className="h-9 px-3 py-1.5 font-mono text-sm">{dv.spec.storage?.resources?.requests?.storage || dv.spec.pvc?.resources?.requests?.storage || "N/A"}</TableCell>
                  <TableCell className="h-9 px-3 py-1.5 text-right text-muted-foreground text-sm">{dv.spec.source ? Object.keys(dv.spec.source)[0] : "manual"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

function VMDetailContent() {
  const { namespace, name, tab } = useParams(); const navigate = useNavigate(); const [vm, setVm] = useState<VM | null>(null); const [vmi, setVmi] = useState<VMI | null>(null); const [vmYaml, setVmYaml] = useState(""); const [associatedDVs, setAssociatedDVs] = useState<DV[]>([]); const [events, setEvents] = useState<K8sEvent[]>([]); const [metrics, setMetrics] = useState<MetricPoint[]>([]); const [loading, setLoading] = useState(true); const [mStrategy, setMStrategy] = useState<string | null>(null); const [dialog, setDialog] = useState<string | null>(null); const { provider: sgProvider } = useSgProvider(); const profile = useNetworkProfile();
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
    if (a === "pause" || a === "unpause") {
      await apiFetch(`/apis/subresources.kubevirt.io/v1/namespaces/${namespace}/virtualmachineinstances/${name}/${a}`, jsonPut());
    } else if (a === "poweroff") {
      await apiFetch(`/apis/kubevirt.io/v1/namespaces/${namespace}/virtualmachineinstances/${name}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ gracePeriodSeconds: 0 }),
      });
    } else if (a === "migrate") {
      await apiFetch(`/apis/kubevirt.io/v1/namespaces/${namespace}/virtualmachineinstancemigrations`, jsonPost({
        apiVersion: "kubevirt.io/v1",
        kind: "VirtualMachineInstanceMigration",
        metadata: { generateName: `${name}-migration-`, namespace },
        spec: { vmiName: name },
      }));
    } else {
      await apiFetch(`/apis/subresources.kubevirt.io/v1/namespaces/${namespace}/virtualmachines/${name}/${a}`, jsonPut());
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
  const securityGroups = sgProvider ? vmSecurityGroups(vm as unknown as KubeObject, sgProvider) : [];

  const tabs = [
    { id: "overview", name: "Overview", icon: Info },
    { id: "network", name: "Network & Security", icon: ShieldCheck },
    { id: "events", name: "Events", icon: Bell },
    { id: "console", name: "Console", icon: Terminal },
    { id: "vnc", name: "VNC", icon: MousePointer2 },
    { id: "manifest", name: "Manifest", icon: FileCode },
  ];

  return (
    <div className={cn("space-y-6 animate-in fade-in duration-500", activeTab === "console" || activeTab === "vnc" ? "max-w-full" : "")}>
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
            description="Patch CPU sockets, cores, threads, and requested memory on this VM template."
            fields={[
              { name: "sockets", label: "Sockets", type: "number", defaultValue: String(currentCpu.sockets || 1) },
              { name: "cores", label: "Cores", type: "number", defaultValue: String(currentCpu.cores || 1) },
              { name: "threads", label: "Threads", type: "number", defaultValue: String(currentCpu.threads || 1) },
              { name: "memory", label: "Memory", defaultValue: currentMemory },
            ]}
            buildRequest={(values) => ({
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
            })}
            onDone={fetchData}
          />
          <VmActionDialog
            label="Run Strategy"
            open={dialog === "Run Strategy"}
            onOpenChange={(next) => setDialog(next ? "Run Strategy" : null)}
            description="Patch spec.runStrategy on this VirtualMachine."
            fields={[{ name: "runStrategy", label: "Run Strategy", type: "select", defaultValue: vm.spec.runStrategy || "Halted", options: [{ label: "Always", value: "Always" }, { label: "Halted", value: "Halted" }, { label: "Manual", value: "Manual" }] }]}
            buildRequest={(values) => ({ url: vmPatchUrl, options: mergePatch({ spec: { runStrategy: stringValue(values.runStrategy, "Halted") } }) })}
            onDone={fetchData}
          />
          <VmActionDialog
            label="Instance Type"
            open={dialog === "Instance Type"}
            onOpenChange={(next) => setDialog(next ? "Instance Type" : null)}
            description="Patch spec.instancetype.name on this VirtualMachine."
            fields={[{ name: "instanceType", label: "Cluster Instance Type", defaultValue: String(vm.spec.instancetype?.name || "") }]}
            buildRequest={(values) => ({ url: vmPatchUrl, options: mergePatch({ spec: { instancetype: { name: stringValue(values.instanceType) } } }) })}
            onDone={fetchData}
          />
          <VmActionDialog
            label="Priority Class"
            open={dialog === "Priority Class"}
            onOpenChange={(next) => setDialog(next ? "Priority Class" : null)}
            description="Patch template priorityClassName on this VirtualMachine."
            fields={[{ name: "priorityClassName", label: "Priority Class Name", defaultValue: String(vm.spec.template?.spec?.priorityClassName || "") }]}
            buildRequest={(values) => ({ url: vmPatchUrl, options: mergePatch({ spec: { template: { spec: { priorityClassName: stringValue(values.priorityClassName) } } } }) })}
            onDone={fetchData}
          />
          <VmActionDialog
            label="Metadata"
            open={dialog === "Metadata"}
            onOpenChange={(next) => setDialog(next ? "Metadata" : null)}
            description="Patch VM and VM template labels/annotations from key=value lines."
            fields={[
              { name: "labels", label: "Labels", type: "textarea", defaultValue: keyValueText(vm.metadata.labels) },
              { name: "annotations", label: "Annotations", type: "textarea", defaultValue: keyValueText(vm.metadata.annotations) },
            ]}
            buildRequest={(values) => {
              const labels = parseKeyValueText(values.labels || "");
              const annotations = parseKeyValueText(values.annotations || "");
              return {
                url: vmPatchUrl,
                options: mergePatch({
                  metadata: { labels, annotations },
                  spec: { template: { metadata: { labels, annotations } } },
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
            {/* Info cards */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <ShadCard>
                <CardHeader className="pb-2">
                  <CardDescription>Run Strategy</CardDescription>
                  <CardTitle className="text-sm font-medium">{vm.spec.runStrategy || "Default"}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Desired State</span>
                    <span className="font-medium">{vm.spec.running ? "Active" : "Halted"}</span>
                  </div>
                </CardContent>
              </ShadCard>

              <ShadCard>
                <CardHeader className="pb-2">
                  <CardDescription>Compute</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-2xl font-semibold tabular-nums">{[vm.spec.template?.spec?.domain?.cpu?.sockets || 1, vm.spec.template?.spec?.domain?.cpu?.cores || 1, vm.spec.template?.spec?.domain?.cpu?.threads || 1].join("x")}</div>
                      <div className="text-xs text-muted-foreground">Sockets x Cores x Threads</div>
                    </div>
                    <div>
                      <div className="text-2xl font-semibold">{vm.spec.template?.spec?.domain?.resources?.requests?.memory || "1Gi"}</div>
                      <div className="text-xs text-muted-foreground">Memory</div>
                    </div>
                  </div>
                </CardContent>
              </ShadCard>

              <ShadCard>
                <CardHeader className="pb-2">
                  <CardDescription>Runtime Status</CardDescription>
                </CardHeader>
                <CardContent>
                  {vmi ? (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Phase</span>
                        <span className="font-medium">{vmi.status.phase}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Node</span>
                        <span className="font-mono text-xs">{vmi.status.nodeName}</span>
                      </div>
                      <div className="text-base font-mono mt-1">{vmi.status.interfaces?.[0]?.ipAddress || "Pending IP..."}</div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No active instance</p>
                  )}
                </CardContent>
              </ShadCard>

              <ShadCard>
                <CardHeader className="pb-2">
                  <CardDescription>Scheduling</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Priority Class</span>
                    <span className="font-medium">{vm.spec.template?.spec?.priorityClassName || "N/A"}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Architecture</span>
                    <span className="font-medium">{vm.spec.template?.spec?.architecture || "N/A"}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Machine</span>
                    <span className="font-medium">{vm.spec.template?.spec?.domain?.machine?.type || "N/A"}</span>
                  </div>
                </CardContent>
              </ShadCard>
            </div>

            {/* Metrics charts */}
            {vmi && metrics.length > 0 && (
              <div className="grid gap-4 md:grid-cols-2">
                <ShadCard>
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-muted-foreground" />
                      <CardTitle className="text-sm">CPU Usage</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent>
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
                  </CardContent>
                </ShadCard>

                <ShadCard>
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <BarChart3 className="h-4 w-4 text-muted-foreground" />
                      <CardTitle className="text-sm">Memory Usage (MB)</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent>
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
                  </CardContent>
                </ShadCard>
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

              <ShadCard className="lg:col-span-3">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Layers className="h-4 w-4 text-muted-foreground" />
                    <CardTitle className="text-sm">Metadata</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
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
                </CardContent>
              </ShadCard>

              <ShadCard>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <HardDrive className="h-4 w-4 text-muted-foreground" />
                    <CardTitle className="text-sm">Storage</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {associatedDVs.map(d => (
                      <div key={d.metadata.uid} className="flex items-center justify-between text-sm p-2 bg-muted/30 rounded-lg border gap-4">
                        <Link to={`/kubevirt/cdi/data-volumes/${d.metadata.namespace}/${d.metadata.name}/overview`} className="font-medium hover:text-primary transition-colors flex-1">{d.metadata.name}</Link>
                        <StatusBadge status={d.status?.phase} />
                      </div>
                    ))}
                    {associatedDVs.length === 0 && <p className="text-sm text-muted-foreground">No storage volumes</p>}
                  </div>
                </CardContent>
              </ShadCard>

              <ShadCard>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <HardDrive className="h-4 w-4 text-muted-foreground" />
                    <CardTitle className="text-sm">Disks</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
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
                </CardContent>
              </ShadCard>

              <ShadCard>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Database className="h-4 w-4 text-muted-foreground" />
                    <CardTitle className="text-sm">Volumes</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {(vm.spec.template?.spec?.volumes || []).map((volume) => (
                      <div key={volume.name} className="grid gap-1 rounded-lg border bg-muted/30 p-3 text-sm">
                        <div className="font-medium">{volume.name}</div>
                        <div className="text-xs text-muted-foreground">{Object.keys(volume).filter((key) => key !== "name").join(", ") || "volume"}</div>
                      </div>
                    ))}
                    {(vm.spec.template?.spec?.volumes || []).length === 0 && <p className="text-sm text-muted-foreground">No volumes declared</p>}
                  </div>
                </CardContent>
              </ShadCard>

              <ShadCard>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Network className="h-4 w-4 text-muted-foreground" />
                    <CardTitle className="text-sm">Networking</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
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
                </CardContent>
              </ShadCard>

              <ShadCard className="lg:col-span-3">
                <CardHeader>
                  <CardTitle className="text-sm">Conditions</CardTitle>
                </CardHeader>
                <CardContent>
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
                </CardContent>
              </ShadCard>
            </div>
          </div>
        )}

        {activeTab === "network" && (
          <div className="grid gap-4 lg:grid-cols-2">
            <ShadCard className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Network interfaces</CardTitle>
                <CardDescription>Interfaces declared on the instance and their runtime addresses.</CardDescription>
              </CardHeader>
              <CardContent>
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
              </CardContent>
            </ShadCard>
            <ShadCard>
              <CardHeader>
                <CardTitle className="text-base">Placement</CardTitle>
                <CardDescription>{profile.label}</CardDescription>
              </CardHeader>
              <CardContent>
                <KeyValueGrid items={[
                  { label: "Subnet", value: templateAnnotations[kubeOvnAnnotations.logicalSwitch] || (profile.vpc ? "Namespace default" : "Pod network") },
                  { label: "Fixed IP", value: templateAnnotations[kubeOvnAnnotations.ipAddress] || "Dynamic" },
                  { label: "Port security", value: templateAnnotations[kubeOvnAnnotations.portSecurity] === "true" ? "Enabled" : "Disabled" },
                  { label: "Host", value: vmi?.status.nodeName || "Not running" },
                ]} />
              </CardContent>
            </ShadCard>
            <ShadCard>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">Security groups</CardTitle>
                    <CardDescription>{sgProvider === "cilium" ? "Enforced by Cilium" : sgProvider === "kube-ovn" ? "Enforced by Kube-OVN" : "Not available on this network stack"}</CardDescription>
                  </div>
                  {sgProvider && <Button size="sm" variant="outline" onClick={() => setDialog("Security Groups")}>Change</Button>}
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {securityGroups.map((group) => (
                  <Link key={group} to={sgDetailPath({ provider: sgProvider!, name: group, namespace })} className="flex items-center gap-2 rounded-lg border p-2.5 text-sm font-medium transition-colors hover:bg-muted/50 hover:text-primary">
                    <ShieldCheck className="size-4 text-muted-foreground" />{group}
                  </Link>
                ))}
                {sgProvider && securityGroups.length === 0 && <p className="text-sm text-muted-foreground">No security groups attached. Traffic is not filtered by security groups.</p>}
                {!sgProvider && <p className="text-sm text-muted-foreground">Use <Link to="/networks/kubernetes/network-policies" className="text-primary hover:underline">network policies</Link> to restrict traffic.</p>}
              </CardContent>
            </ShadCard>
          </div>
        )}

        {activeTab === "events" && (
          <ShadCard className="p-0 gap-0">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Message</TableHead>
                    <TableHead className="text-right">Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.sort((a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime()).map(e => (
                    <TableRow key={e.metadata.uid} className="hover:bg-muted/50">
                      <TableCell><Badge variant={e.type === "Normal" ? "outline" : "danger"}>{e.type}</Badge></TableCell>
                      <TableCell className="font-medium text-sm">{e.reason}</TableCell>
                      <TableCell className="text-muted-foreground text-sm max-w-md">{e.message}</TableCell>
                      <TableCell className="text-right text-muted-foreground text-sm tabular-nums">
                        <span className="flex items-center justify-end gap-1"><Clock className="h-3 w-3" />{e.lastTimestamp || "N/A"}</span>
                      </TableCell>
                    </TableRow>
                  ))}
                  {events.length === 0 && (
                    <TableRow><TableCell colSpan={4} className="h-24 text-center text-muted-foreground">No events found</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </ShadCard>
        )}

        {activeTab === "console" && <SerialConsole namespace={namespace!} name={name!} />}
        {activeTab === "vnc" && <VncConsole namespace={namespace!} name={name!} />}

        {activeTab === "manifest" && (
          <ShadCard>
            <CardContent className="p-0">
              <pre className="p-6 text-sm font-mono text-foreground bg-muted/30 rounded-lg overflow-x-auto min-h-[400px] whitespace-pre">{vmYaml || "Fetching..."}</pre>
            </CardContent>
          </ShadCard>
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

  if (loading) return (
    <div className="flex items-center justify-center h-64 gap-2">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-primary" />
      <span className="text-sm text-muted-foreground">Loading...</span>
    </div>
  );
  if (!dv) return (
    <div className="p-12 text-center text-muted-foreground border-2 border-dashed rounded-lg mt-8">
      DataVolume not found
    </div>
  );

  const tabs = [
    { id: "overview", name: "Overview", icon: Info },
    { id: "manifest", name: "Manifest", icon: FileCode },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center gap-4 mb-2">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{dv.metadata.name}</h1>
            <StatusBadge status={dv.status?.phase} />
          </div>
          <p className="text-sm text-muted-foreground">{dv.metadata.namespace}</p>
        </div>
        <VmActionDialog
          label="Resize"
          description="Resize the bound PVC for this DataVolume."
          fields={[{
            name: "storage",
            label: "Storage Size",
            defaultValue: dv.spec.storage?.resources?.requests?.storage || dv.spec.pvc?.resources?.requests?.storage || "10Gi",
          }]}
          buildRequest={(values) => ({
            url: `/api/v1/namespaces/${namespace}/persistentvolumeclaims/${dv.status?.claimName || name}`,
            options: mergePatch({ spec: { resources: { requests: { storage: stringValue(values.storage, "10Gi") } } } }),
          })}
          onDone={loadDv}
        />
        <VmActionDialog
          label="Metadata"
          description="Patch DataVolume labels and annotations from key=value lines."
          fields={[
            { name: "labels", label: "Labels", type: "textarea", defaultValue: keyValueText(dv.metadata.labels) },
            { name: "annotations", label: "Annotations", type: "textarea", defaultValue: keyValueText(dv.metadata.annotations) },
          ]}
          buildRequest={(values) => ({
            url: `/apis/cdi.kubevirt.io/v1beta1/namespaces/${namespace}/datavolumes/${name}`,
            options: mergePatch({ metadata: { labels: parseKeyValueText(values.labels || ""), annotations: parseKeyValueText(values.annotations || "") } }),
          })}
          onDone={loadDv}
        />
        <VmActionDialog
          label="Delete"
          description="Delete this DataVolume resource."
          fields={[]}
          buildRequest={() => ({
            url: `/apis/cdi.kubevirt.io/v1beta1/namespaces/${namespace}/datavolumes/${name}`,
            options: { method: "DELETE", headers: { Accept: "application/json" } },
          })}
          onDone={() => navigate("/kubevirt/cdi/data-volumes")}
        />
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 border-b">
        {tabs.map(t => (
          <Link
            key={t.id}
            to={`/kubevirt/cdi/data-volumes/${namespace}/${name}/${t.id}`}
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
        {activeTab === "overview" ? (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-3">
              <ShadCard>
                <CardHeader className="pb-2">
                  <CardDescription>Capacity</CardDescription>
                  <CardTitle className="text-2xl font-semibold tabular-nums">
                    {dv.spec.storage?.resources?.requests?.storage || dv.spec.pvc?.resources?.requests?.storage || "N/A"}
                  </CardTitle>
                </CardHeader>
              </ShadCard>
              <ShadCard>
                <CardHeader className="pb-2">
                  <CardDescription>Transfer Progress</CardDescription>
                  <CardTitle className="text-2xl font-semibold tabular-nums">{dv.status?.progress || "100%"}</CardTitle>
                </CardHeader>
              </ShadCard>
              <ShadCard>
                <CardHeader className="pb-2">
                  <CardDescription>Source</CardDescription>
                  <CardTitle className="text-sm font-medium">{dv.spec.source ? Object.keys(dv.spec.source)[0] : "manual"}</CardTitle>
                </CardHeader>
              </ShadCard>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <ShadCard>
                <CardHeader>
                  <CardTitle className="text-sm">Storage Request</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Storage Class</span>
                    <span className="font-medium">{dv.spec.storage?.storageClassName || dv.spec.pvc?.storageClassName || "default"}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Access Modes</span>
                    <span className="font-medium">{dv.spec.storage?.accessModes?.join(", ") || dv.spec.pvc?.accessModes?.join(", ") || "N/A"}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Volume Mode</span>
                    <span className="font-medium">{dv.spec.storage?.volumeMode || dv.spec.pvc?.volumeMode || "N/A"}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Claim</span>
                    <span className="font-medium">{dv.status?.claimName || dv.metadata.name}</span>
                  </div>
                </CardContent>
              </ShadCard>

              <ShadCard>
                <CardHeader>
                  <CardTitle className="text-sm">Source</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {Object.entries(dv.spec.source || {}).map(([sourceType, value]) => (
                      <div key={sourceType} className="rounded-lg border bg-muted/30 p-3">
                        <div className="text-sm font-medium">{sourceType}</div>
                        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-xs text-muted-foreground">{JSON.stringify(value, null, 2)}</pre>
                      </div>
                    ))}
                    {!dv.spec.source && <p className="text-sm text-muted-foreground">No source declared</p>}
                  </div>
                </CardContent>
              </ShadCard>

              <ShadCard>
                <CardHeader>
                  <CardTitle className="text-sm">Conditions</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {(dv.status?.conditions || []).map((condition) => (
                      <div key={condition.type} className="rounded-lg border bg-muted/30 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-medium text-sm">{condition.type}</span>
                          <StatusBadge status={condition.status} />
                        </div>
                        {(condition.reason || condition.message) && <p className="mt-2 text-xs text-muted-foreground">{condition.reason} {condition.message}</p>}
                      </div>
                    ))}
                    {(dv.status?.conditions || []).length === 0 && <p className="text-sm text-muted-foreground">No conditions reported</p>}
                  </div>
                </CardContent>
              </ShadCard>
            </div>

            <ShadCard>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Layers className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="text-sm">Metadata</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <div className="mb-2 text-xs font-medium text-muted-foreground">Labels</div>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(dv.metadata.labels || {}).map(([k, v]) => (
                        <span key={k} className="px-2 py-1 bg-muted text-foreground rounded-md text-xs border">{k}: {v}</span>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="mb-2 text-xs font-medium text-muted-foreground">Annotations</div>
                    <div className="grid grid-cols-1 gap-2">
                      {Object.entries(dv.metadata.annotations || {}).slice(0, 12).map(([k, v]) => (
                        <CopyableText key={k} label={k} text={String(v)} />
                      ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </ShadCard>
          </div>
        ) : (
          <ShadCard>
            <CardContent className="p-0">
              <pre className="p-6 text-sm font-mono text-foreground bg-muted/30 rounded-lg overflow-x-auto min-h-[400px] whitespace-pre">{dvYaml || "Loading..."}</pre>
            </CardContent>
          </ShadCard>
        )}
      </div>
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
          <div className="flex flex-1 flex-col p-4 lg:p-8 max-w-[100rem] mx-auto w-full">
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
