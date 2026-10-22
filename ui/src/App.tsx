import { useCallback, useEffect, useMemo, useState } from "react";
import { BrowserRouter, Routes, Route, Link, useParams, useNavigate, Navigate } from "react-router-dom";
import {
  Terminal, FileCode, Info, ShieldCheck, Bell, Activity,
  Check, Copy, MousePointer2, RefreshCw, Play, Square, RotateCcw, MonitorPlay, ChevronDown
} from "lucide-react";
import { cn } from "@/lib/utils";

import { VncConsole } from "./components/VncConsole";
import { SerialConsole } from "./components/SerialConsole";
import { AppSidebar } from "./components/app-sidebar";
import { RelatedPodsCard } from "./components/pod-access";
import { ResourceCreateDialog, ResourceDetail, ResourceEvents, ResourceList, ResourceManifest, type ResourceConfig } from "./components/resource-management";
import { SiteHeader } from "./components/site-header";
import { SidebarInset, SidebarProvider } from "./components/ui/sidebar";
import { Toaster } from "./components/ui/sonner";
import { toast } from "sonner";
import { Button } from "./components/ui/button";
import { dvCreateConfig, jsonPost, jsonPut, keyValueText, mergePatch, numberValue, parseKeyValueText, resourceConfigs, stringValue } from "./resources/configs";
import { Combobox, DataTable, EmptyState, FilterInput, KeyValueGrid, LoadingState, PageHeader, Panel, StatusDot, Toolbar } from "./components/console";
import { namespaceScope, useFilteredRows, type FilterField } from "./lib/filter";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";
import { kubeOvnAnnotations, relativeTime, replaceMap, useNamespaces, useNetworkProfile, type KubeObject } from "./lib/kube";
import { engineLabel, sgDetailPath, useSgProvider, vmSecurityGroupRefs } from "./lib/security-groups";
import { CreateInstancePage, InstanceListPage } from "./pages/instances";
import { OverviewPage } from "./pages/overview";
import { EventsPage } from "./pages/events";
import { EventList } from "./components/events";
import { VmMonitoring } from "./components/monitoring";
import { eventsUrl } from "./lib/events";
import { InstanceSecurityGroupsDialog, SecurityGroupDetailPage, SecurityGroupListPage } from "./pages/security-groups";
import { CatalogPage, SettingsPage } from "./pages/settings";
import { SubnetDetailPage, SubnetListPage, VpcDetailPage, VpcListPage } from "./pages/vpc";
import { ElasticIpPage, NatGatewayPage } from "./pages/nat";
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
import { t, useLocale } from "@/lib/i18n";

interface ResourceMetadata { name: string; namespace: string; uid: string; creationTimestamp: string; labels?: Record<string, string>; annotations?: Record<string, string>; }
type UnknownRecord = Record<string, unknown>;
interface VmDisk { name?: string; bootOrder?: number; disk?: UnknownRecord; cdrom?: UnknownRecord; lun?: UnknownRecord }
interface VmVolume { name: string; dataVolume?: { name: string }; persistentVolumeClaim?: { claimName?: string }; containerDisk?: { image?: string }; cloudInitNoCloud?: UnknownRecord }
interface VM { metadata: ResourceMetadata; spec: { running?: boolean; runStrategy?: string; instancetype?: { name?: string }; template?: { metadata?: { labels?: Record<string, string>; annotations?: Record<string, string>; }; spec?: { architecture?: string; priorityClassName?: string; domain?: { machine?: { type?: string }; cpu?: { cores?: number, sockets?: number, threads?: number }; resources?: { requests?: { cpu?: string, memory?: string } }; devices?: { interfaces?: Array<{ name: string, model?: string }>; disks?: VmDisk[] }; }; networks?: Array<{ name: string, pod?: unknown }>; volumes?: VmVolume[]; }; }; }; status?: { printableStatus?: string; conditions?: Array<{ type: string; status: string; message?: string; reason?: string }>; }; }
interface VMI { metadata: ResourceMetadata; status: { phase: string; interfaces?: Array<{ ipAddress?: string; name: string }>; nodeName?: string }; }
interface DVStorageSpec { storageClassName?: string; accessModes?: string[]; volumeMode?: string; resources?: { requests?: { storage?: string } } }
interface DV { metadata: ResourceMetadata; status?: { phase: string; progress?: string; claimName?: string; conditions?: Array<{ type: string; status: string; message?: string; reason?: string }>; }; spec: { storage?: DVStorageSpec; pvc?: DVStorageSpec; source?: Record<string, unknown>; }; }

// --- Utils ---
const getContext = () => localStorage.getItem("kube-context") || "";
const apiFetch = (url: string, options: RequestInit = {}) => {
  const ctx = getContext(); const headers = new Headers(options.headers || {});
  if (ctx) headers.set("X-Kube-Context", ctx);
  return fetch(url, { ...options, headers });
};
const asRecord = (value: unknown): UnknownRecord => value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
const isVm = (value: unknown): value is VM => Boolean(asRecord(value).metadata && asRecord(value).spec);
const vmPodSelectors = (name: string): Array<Record<string, string>> => [
  { "vm.kubevirt.io/name": name },
  { "vmi.kubevirt.io/id": name },
  { "las.qiniu.io/vm-id": name },
  { "kubevirt.io/domain": name },
];

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
              <span className="text-sm font-medium text-foreground">{t(field.label)}</span>
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
                  {(field.options || []).map((option) => <option key={option.value} value={option.value}>{t(option.label)}</option>)}
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
          <Button variant="outline" onClick={() => setOpen(false)}>{t("Cancel")}</Button>
          <Button variant={variant === "destructive" ? "destructive" : "default"} onClick={submit} disabled={saving}>{saving ? t("Applying...") : t("Apply")}</Button>
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

type DiskRow = { dv: DV; attachedTo: string }

const diskFields: FilterField<DiskRow>[] = [
  { key: "name", label: "Name", value: (row) => row.dv.metadata.name },
  { key: "namespace", label: "Namespace", aliases: ["ns"], value: (row) => row.dv.metadata.namespace },
  { key: "status", label: "Status", value: (row) => row.dv.status?.phase },
  { key: "size", label: "Size", value: (row) => dvSize(row.dv) },
  { key: "storageclass", label: "Storage class", aliases: ["sc"], value: (row) => dvStorageClass(row.dv) },
  { key: "source", label: "Source", value: (row) => dvSource(row.dv) },
  { key: "vm", label: "Attached to", aliases: ["attached"], value: (row) => row.attachedTo },
]

function DVList() {
  const [dvs, setDvs] = useState<DV[]>([]); const [vms, setVms] = useState<VM[]>([]); const [loading, setLoading] = useState(true); const [searchTerm, setSearchTerm] = useState(""); const namespaces = useNamespaces(); const [namespaceFilter, setNamespaceFilter] = useState("");
  const ns = useMemo(() => namespaceScope(namespaceFilter, namespaces), [namespaceFilter, namespaces]);
  const scope = ns.scope;
  const loadDvs = useCallback(async () => {
    setLoading(true);
    try {
      const prefix = scope === "all" ? "" : `/namespaces/${scope}`;
      const [dvData, vmData] = await Promise.all([
        apiFetch(`/apis/cdi.kubevirt.io/v1beta1${prefix}/datavolumes`).then(r => r.ok ? r.json() : { items: [] }),
        apiFetch(`/apis/kubevirt.io/v1${prefix}/virtualmachines`).then(r => r.ok ? r.json() : { items: [] }),
      ]);
      setDvs(dvData.items || []);
      setVms(vmData.items || []);
    } finally { setLoading(false); }
  }, [scope]);
  useEffect(() => { loadDvs(); }, [loadDvs]);
  const rows = useMemo(() => {
    const attachedTo = dvAttachments(vms);
    return dvs.filter((dv) => ns.match(dv.metadata.namespace)).map((dv): DiskRow => ({ dv, attachedTo: attachedTo[`${dv.metadata.namespace}/${dv.metadata.name}`] || "" }));
  }, [dvs, vms, ns]);
  const filtered = useFilteredRows(rows, diskFields, searchTerm);
  return (
    <div className="space-y-4">
      <PageHeader
        title={t("Disks")}
        badge={!loading && <span className="text-sm text-muted-foreground tabular-nums">{dvs.length}</span>}
        subtitle={t("CDI DataVolumes")}
        actions={<ResourceCreateDialog config={dvCreateConfig} onCreated={loadDvs} defaultNamespace={scope === "all" ? "default" : scope} />}
      />
      <Toolbar right={<FilterInput value={searchTerm} onChange={setSearchTerm} fields={diskFields} rows={rows} placeholder={t("Filter, e.g. status:succeeded sc:ceph")} />}>
        <Button size="sm" variant="outline" onClick={loadDvs} className="gap-2"><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />{t("Refresh")}</Button>
        <Combobox value={namespaceFilter} onChange={setNamespaceFilter} options={namespaces} placeholder={t("All namespaces")} aria-label={t("Namespace")} />
      </Toolbar>
      <DataTable<DiskRow>
        loading={loading}
        rows={filtered}
        rowKey={({ dv }) => dv.metadata.uid}
        empty={<EmptyState title={searchTerm || namespaceFilter ? t("No matching disks") : t("No disks")} />}
        columns={[
          {
            header: t("Name"),
            cell: ({ dv }) => (
              <div>
                <Link to={`/kubevirt/cdi/data-volumes/${dv.metadata.namespace}/${dv.metadata.name}/overview`} className="font-medium hover:text-primary transition-colors">{dv.metadata.name}</Link>
                <div className="text-xs text-muted-foreground">{dv.metadata.namespace}</div>
              </div>
            ),
          },
          { header: t("Status"), cell: ({ dv }) => <StatusDot status={dv.status?.phase} label={dv.status?.phase && dv.status.progress && dv.status.phase !== "Succeeded" ? `${dv.status.phase} ${dv.status.progress}` : undefined} /> },
          { header: t("Size"), cell: ({ dv }) => <span className="font-mono text-xs">{dvSize(dv)}</span> },
          { header: t("Storage class"), cell: ({ dv }) => <span className="text-sm text-muted-foreground">{dvStorageClass(dv)}</span> },
          { header: t("Source"), cell: ({ dv }) => <span className="text-sm text-muted-foreground">{dvSource(dv)}</span> },
          {
            header: t("Attached to"),
            cell: ({ dv, attachedTo: vm }) => {
              return vm ? <Link to={`/kubevirt/virtualization/virtual-machines/${dv.metadata.namespace}/${vm}/overview`} className="text-sm hover:text-primary transition-colors">{vm}</Link> : <span className="text-sm text-muted-foreground">-</span>;
            },
          },
          { header: t("Age"), className: "text-right", cell: ({ dv }) => <span className="text-sm text-muted-foreground tabular-nums" title={dv.metadata.creationTimestamp}>{relativeTime(dv.metadata.creationTimestamp)}</span> },
        ]}
      />
    </div>
  );
}

function VMDetailContent() {
  const { namespace, name, tab } = useParams(); const navigate = useNavigate(); const [vm, setVm] = useState<VM | null>(null); const [vmi, setVmi] = useState<VMI | null>(null); const [vmYaml, setVmYaml] = useState(""); const [associatedDVs, setAssociatedDVs] = useState<DV[]>([]); const [loading, setLoading] = useState(true); const [dialog, setDialog] = useState<string | null>(null); const { provider: sgProvider, providers: sgProviders } = useSgProvider(); const profile = useNetworkProfile();
  const activeTab = tab === "yaml" ? "manifest" : tab || "overview";
  const fetchData = useCallback(async () => {
    try {
      const [vmRes, vmiRes, yamlRes] = await Promise.all([ apiFetch(`/apis/kubevirt.io/v1/namespaces/${namespace}/virtualmachines/${name}`), apiFetch(`/apis/kubevirt.io/v1/namespaces/${namespace}/virtualmachineinstances/${name}`), apiFetch(`/api/v1/yaml/virtualmachines/${namespace}/${name}`) ]);
      const rawVmData: unknown = vmRes.ok ? await vmRes.json() : null; const vmData = isVm(rawVmData) ? rawVmData : null; setVm(vmData); setVmi(vmiRes.ok ? await vmiRes.json() : null); if (yamlRes.ok) setVmYaml(await yamlRes.text());
      if (vmData?.spec.template?.spec?.volumes) { const dns = vmData.spec.template.spec.volumes.filter((v) => v.dataVolume).map((v) => v.dataVolume!.name); if (dns.length > 0) { const ds = await Promise.all(dns.map((dn:string) => apiFetch(`/apis/cdi.kubevirt.io/v1beta1/namespaces/${namespace}/datavolumes/${dn}`).then(r => r.ok ? r.json() : null))); setAssociatedDVs(ds.filter(d => d !== null)); } }
    } finally { setLoading(false); }
  }, [name, namespace]);
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
      <span className="text-sm text-muted-foreground">{t("Loading...")}</span>
    </div>
  );
  if (!vm) return (
    <div className="p-12 text-center text-muted-foreground border-2 border-dashed rounded-lg mt-8">{t("Virtual machine not found")}
    </div>
  );
  const currentCpu = vm.spec.template?.spec?.domain?.cpu || {};
  const currentMemory = vm.spec.template?.spec?.domain?.resources?.requests?.memory || "1Gi";
  const isRunning = vmi?.status.phase === "Running";
  const templateAnnotations = vm.spec.template?.metadata?.annotations || {};
  const securityGroups = vmSecurityGroupRefs(vm as unknown as KubeObject, sgProviders);

  const tabs = [
    { id: "overview", name: t("Overview"), icon: Info },
    { id: "network", name: t("Network & Security"), icon: ShieldCheck },
    { id: "monitoring", name: t("Monitoring"), icon: Activity },
    { id: "events", name: t("Events"), icon: Bell },
    { id: "console", name: t("Console"), icon: Terminal },
    { id: "vnc", name: "VNC", icon: MousePointer2 },
    { id: "manifest", name: t("Manifest"), icon: FileCode },
  ];

  return (
    <div className={cn("space-y-6", activeTab === "console" || activeTab === "vnc" ? "max-w-full" : "")}>
      <PageHeader
        breadcrumbs={[{ label: t("Instances"), to: "/kubevirt/virtualization/virtual-machines" }, { label: vm.metadata.namespace }, { label: vm.metadata.name }]}
        title={vm.metadata.name}
        badge={<StatusDot status={vm.status?.printableStatus} />}
        subtitle={[vm.metadata.namespace, vmi?.status.interfaces?.[0]?.ipAddress, vmi?.status.nodeName].filter(Boolean).join(" / ")}
        actions={
          <>
            {isRunning ? (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => handleAction("stop")}><Square className="size-3.5" />{t("Stop")}</Button>
            ) : (
              <Button size="sm" className="gap-1.5" onClick={() => handleAction("start")}><Play className="size-3.5" />{t("Start")}</Button>
            )}
            <Button size="sm" variant="outline" className="gap-1.5" disabled={!isRunning} onClick={() => handleAction("restart")}><RotateCcw className="size-3.5" />{t("Restart")}</Button>
            <Button size="sm" variant="outline" className="gap-1.5" disabled={!isRunning} onClick={() => navigate(`/kubevirt/virtualization/virtual-machines/${namespace}/${name}/vnc`)}><MonitorPlay className="size-3.5" />{t("Connect")}</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="gap-1.5">{t("More")}<ChevronDown className="size-3.5" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel>{t("Power")}</DropdownMenuLabel>
                <DropdownMenuItem disabled={!isRunning} onClick={() => handleAction("pause")}>{t("Pause")}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleAction("unpause")}>{t("Resume")}</DropdownMenuItem>
                <DropdownMenuItem disabled={!isRunning} onClick={() => handleAction("poweroff")}>{t("Force power off")}</DropdownMenuItem>
                <DropdownMenuItem disabled={!isRunning} onClick={() => handleAction("migrate")}>{t("Live migrate")}</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>{t("Configuration")}</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => setDialog("Resize")}>{t("Change spec")}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setDialog("Instance Type")}>{t("Change instance type")}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setDialog("Run Strategy")}>{t("Run strategy")}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setDialog("Priority Class")}>{t("Priority class")}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setDialog("Metadata")}>{t("Labels and annotations")}</DropdownMenuItem>
                {sgProvider && <DropdownMenuItem onClick={() => setDialog("Security Groups")}>{t("Security groups")}</DropdownMenuItem>}
                <DropdownMenuSeparator />
                <DropdownMenuLabel>{t("Disks")}</DropdownMenuLabel>
                <DropdownMenuItem disabled={!isRunning} onClick={() => setDialog("Hotplug Volume")}>{t("Attach disk")}</DropdownMenuItem>
                <DropdownMenuItem disabled={!isRunning} onClick={() => setDialog("Unplug Volume")}>{t("Detach disk")}</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => setDialog("Delete")}>{t("Delete instance")}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />
          <VmActionDialog
            label={t("Resize")}
            open={dialog === "Resize"}
            onOpenChange={(next) => setDialog(next ? "Resize" : null)}
            description={vm.spec.instancetype?.name ? `CPU and memory come from instance type ${vm.spec.instancetype.name}. Change the instance type instead.` : t("Set CPU topology and memory. Takes effect on the next restart unless CPU/memory hotplug is enabled.")}
            fields={[
              { name: "sockets", label: t("Sockets"), type: "number", defaultValue: String(currentCpu.sockets || 1) },
              { name: "cores", label: t("Cores"), type: "number", defaultValue: String(currentCpu.cores || 1) },
              { name: "threads", label: t("Threads"), type: "number", defaultValue: String(currentCpu.threads || 1) },
              { name: "memory", label: t("Memory"), defaultValue: currentMemory },
            ]}
            buildRequest={(values) => {
              if (vm.spec.instancetype?.name) throw new Error(t("This VM uses an instance type; change the instance type to resize it."));
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
            label={t("Run Strategy")}
            open={dialog === "Run Strategy"}
            onOpenChange={(next) => setDialog(next ? "Run Strategy" : null)}
            description={t("How KubeVirt keeps this VM running.")}
            fields={[{ name: "runStrategy", label: t("Run Strategy"), type: "select", defaultValue: vm.spec.runStrategy || (vm.spec.running ? "Always" : "Halted"), options: [{ label: t("Always"), value: "Always" }, { label: t("RerunOnFailure"), value: "RerunOnFailure" }, { label: t("Halted"), value: "Halted" }, { label: t("Manual"), value: "Manual" }] }]}
            // runStrategy and the legacy spec.running field are mutually exclusive.
            buildRequest={(values) => ({ url: vmPatchUrl, options: mergePatch({ spec: { runStrategy: stringValue(values.runStrategy, "Halted"), running: null } }) })}
            onDone={fetchData}
          />
          <VmActionDialog
            label={t("Instance Type")}
            open={dialog === "Instance Type"}
            onOpenChange={(next) => setDialog(next ? "Instance Type" : null)}
            description={t("CPU and memory come from the instance type, replacing the template's own sizing. Leave empty to remove it, then set CPU and memory with Change spec.")}
            fields={[{ name: "instanceType", label: t("Cluster Instance Type"), defaultValue: String(vm.spec.instancetype?.name || "") }]}
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
            label={t("Priority Class")}
            open={dialog === "Priority Class"}
            onOpenChange={(next) => setDialog(next ? "Priority Class" : null)}
            description={t("Patch template priorityClassName on this VirtualMachine.")}
            fields={[{ name: "priorityClassName", label: t("Priority Class Name"), defaultValue: String(vm.spec.template?.spec?.priorityClassName || "") }]}
            buildRequest={(values) => ({ url: vmPatchUrl, options: mergePatch({ spec: { template: { spec: { priorityClassName: stringValue(values.priorityClassName) || null } } } }) })}
            onDone={fetchData}
          />
          <VmActionDialog
            label={t("Metadata")}
            open={dialog === "Metadata"}
            onOpenChange={(next) => setDialog(next ? "Metadata" : null)}
            description={t("Labels and annotations on the VirtualMachine object. One key=value per line; removed lines are deleted.")}
            fields={[
              { name: "labels", label: t("Labels"), type: "textarea", defaultValue: keyValueText(vm.metadata.labels) },
              { name: "annotations", label: t("Annotations"), type: "textarea", defaultValue: keyValueText(vm.metadata.annotations) },
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
            label={t("Hotplug Volume")}
            open={dialog === "Hotplug Volume"}
            onOpenChange={(next) => setDialog(next ? "Hotplug Volume" : null)}
            description={t("Attach an existing DataVolume to the running VMI.")}
            fields={[
              { name: "volume", label: t("DataVolume Name"), defaultValue: "" },
              { name: "type", label: t("Device Type"), type: "select", defaultValue: "disk", options: [{ label: t("Disk"), value: "disk" }, { label: t("CD-ROM"), value: "cdrom" }, { label: t("LUN"), value: "lun" }] },
              { name: "cache", label: t("Cache Mode"), type: "select", defaultValue: "none", options: [{ label: "none", value: "none" }, { label: "writeback", value: "writeback" }, { label: "writethrough", value: "writethrough" }] },
              { name: "readonly", label: t("Read Only"), type: "select", defaultValue: "false", options: [{ label: t("No"), value: "false" }, { label: t("Yes"), value: "true" }] },
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
            label={t("Unplug Volume")}
            open={dialog === "Unplug Volume"}
            onOpenChange={(next) => setDialog(next ? "Unplug Volume" : null)}
            description={t("Detach a hotplugged volume from the running VMI.")}
            fields={[{ name: "volume", label: t("Volume Name"), defaultValue: "" }]}
            buildRequest={(values) => ({
              url: `/apis/subresources.kubevirt.io/v1/namespaces/${namespace}/virtualmachineinstances/${name}/removevolume`,
              options: jsonPut({ name: stringValue(values.volume) }),
            })}
            onDone={fetchData}
          />
          <VmActionDialog
            label={t("Delete")}
            open={dialog === "Delete"}
            onOpenChange={(next) => setDialog(next ? "Delete" : null)}
            description={t("Delete this VirtualMachine resource.")}
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
                    title: t("Instance"),
                    items: [
                      { label: t("Status"), value: <StatusDot status={vm.status?.printableStatus} /> },
                      { label: t("Run strategy"), value: vm.spec.runStrategy || (vm.spec.running ? "Always" : "Halted") },
                      { label: t("Namespace"), value: vm.metadata.namespace },
                      { label: t("Created"), value: relativeTime(vm.metadata.creationTimestamp) },
                    ],
                  },
                  {
                    title: t("Compute"),
                    items: [
                      { label: "vCPU", value: `${(currentCpu.sockets || 1) * (currentCpu.cores || 1) * (currentCpu.threads || 1)} (${currentCpu.sockets || 1} x ${currentCpu.cores || 1} x ${currentCpu.threads || 1})` },
                      { label: t("Memory"), value: vm.spec.template?.spec?.domain?.resources?.requests?.memory || "From instance type" },
                      { label: t("Instance type"), value: vm.spec.instancetype?.name || t("Custom") },
                      { label: t("Machine / arch"), value: `${vm.spec.template?.spec?.domain?.machine?.type || "default"} / ${vm.spec.template?.spec?.architecture || "default"}` },
                    ],
                  },
                  {
                    title: t("Runtime"),
                    items: [
                      { label: t("Private IP"), value: <span className="font-mono">{vmi?.status.interfaces?.[0]?.ipAddress || "-"}</span> },
                      { label: t("Host"), value: vmi?.status.nodeName || "Not running" },
                      { label: t("Subnet"), value: templateAnnotations[kubeOvnAnnotations.logicalSwitch] || (profile.vpc ? "Namespace default" : "Pod network") },
                      { label: t("Priority class"), value: vm.spec.template?.spec?.priorityClassName || t("None") },
                    ],
                  },
                ].map((group) => (
                  <div key={group.title} className="space-y-3 px-4 py-3.5">
                    <div className="text-sm font-semibold">{t(group.title)}</div>
                    <dl className="space-y-2 text-sm">
                      {group.items.map((item) => (
                        <div key={item.label} className="flex items-center justify-between gap-4">
                          <dt className="text-muted-foreground">{t(item.label)}</dt>
                          <dd className="min-w-0 truncate text-right">{item.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))}
              </div>
            </div>

            {/* Metadata, Storage, Networking */}
            <div className="grid gap-4 lg:grid-cols-3">
              <RelatedPodsCard
                className="lg:col-span-3"
                title={t("Virtual Machine Pods")}
                description={t("Pods created for this VM runtime. Use these for logs and shell access.")}
                namespace={namespace!}
                selectors={vmPodSelectors(name!)}
              />

              <Panel title={t("Metadata")} className="lg:col-span-3">
                  <div className="grid md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <div className="mb-2 text-xs font-medium text-muted-foreground">{t("Labels")}</div>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(vm.spec.template?.metadata?.labels || {}).map(([k, v]) => (
                          <span key={k} className="px-2 py-1 bg-muted text-foreground rounded-md text-xs border">{k}: {v}</span>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="mb-2 text-xs font-medium text-muted-foreground">{t("Annotations")}</div>
                      <div className="grid grid-cols-1 gap-2">
                        {Object.entries(vm.spec.template?.metadata?.annotations || {}).slice(0, 8).map(([k, v]) => (
                          <CopyableText key={k} label={k} text={String(v)} />
                        ))}
                      </div>
                    </div>
                  </div>
                </Panel>

              <Panel title={t("Storage")}>
                  <div className="space-y-2">
                    {associatedDVs.map(d => (
                      <div key={d.metadata.uid} className="flex items-center justify-between text-sm p-2 bg-muted/30 rounded-lg border gap-4">
                        <Link to={`/kubevirt/cdi/data-volumes/${d.metadata.namespace}/${d.metadata.name}/overview`} className="font-medium hover:text-primary transition-colors flex-1">{d.metadata.name}</Link>
                        <StatusBadge status={d.status?.phase} />
                      </div>
                    ))}
                    {associatedDVs.length === 0 && <p className="text-sm text-muted-foreground">{t("No storage volumes")}</p>}
                  </div>
                </Panel>

              <Panel title={t("Disks")}>
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
                    {((vm.spec.template?.spec?.domain?.devices?.disks || []).length === 0) && <p className="text-sm text-muted-foreground">{t("No disks declared")}</p>}
                  </div>
                </Panel>

              <Panel title={t("Volumes")}>
                  <div className="space-y-2">
                    {(vm.spec.template?.spec?.volumes || []).map((volume) => (
                      <div key={volume.name} className="grid gap-1 rounded-lg border bg-muted/30 p-3 text-sm">
                        <div className="font-medium">{volume.name}</div>
                        <div className="text-xs text-muted-foreground">{Object.keys(volume).filter((key) => key !== "name").join(", ") || "volume"}</div>
                      </div>
                    ))}
                    {(vm.spec.template?.spec?.volumes || []).length === 0 && <p className="text-sm text-muted-foreground">{t("No volumes declared")}</p>}
                  </div>
                </Panel>

              <Panel title={t("Networking")}>
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

              <Panel title={t("Conditions")} className="lg:col-span-3">
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
                    {(vm.status?.conditions || []).length === 0 && <p className="text-sm text-muted-foreground">{t("No conditions reported")}</p>}
                  </div>
                </Panel>
            </div>
          </div>
        )}

        {activeTab === "network" && (
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title={t("Network interfaces")} className="lg:col-span-2">
                <DataTable
                  minWidth={640}
                  rows={vm.spec.template?.spec?.domain?.devices?.interfaces || []}
                  rowKey={(iface) => iface.name}
                  empty={<EmptyState title={t("No interfaces declared")} />}
                  columns={[
                    { header: t("Interface"), cell: (iface) => <span className="font-medium">{iface.name}</span> },
                    { header: t("Binding"), cell: (iface) => <span className="text-sm">{Object.keys(iface).filter((key) => !["name", "model", "macAddress"].includes(key)).join(", ") || "N/A"}</span> },
                    {
                      header: t("Network"),
                      cell: (iface) => {
                        const network = vm.spec.template?.spec?.networks?.find((item) => item.name === iface.name) as Record<string, unknown> | undefined;
                        if (!network) return <span className="text-sm text-muted-foreground">N/A</span>;
                        if (network.multus) return <span className="text-sm">{t("Multus")} {String((network.multus as Record<string, unknown>).networkName)}</span>;
                        const subnet = templateAnnotations[kubeOvnAnnotations.logicalSwitch];
                        return subnet ? <Link to={`/vpc/subnets/${subnet}`} className="text-sm hover:text-primary transition-colors">{t("Subnet")} {subnet}</Link> : <span className="text-sm">{t("Pod network")}</span>;
                      },
                    },
                    { header: t("IP addresses"), cell: (iface) => <span className="font-mono text-xs">{(vmi?.status.interfaces?.find((item) => item.name === iface.name) as { ipAddresses?: string[]; ipAddress?: string } | undefined)?.ipAddresses?.join(", ") || vmi?.status.interfaces?.find((item) => item.name === iface.name)?.ipAddress || "-"}</span> },
                    { header: t("MAC"), cell: (iface) => <span className="font-mono text-xs text-muted-foreground">{(vmi?.status.interfaces?.find((item) => item.name === iface.name) as { mac?: string } | undefined)?.mac || "-"}</span> },
                  ]}
                />
              </Panel>
            <Panel title={t("Placement")}>
                <KeyValueGrid items={[
                  { label: t("Subnet"), value: templateAnnotations[kubeOvnAnnotations.logicalSwitch] || (profile.vpc ? "Namespace default" : "Pod network") },
                  { label: t("Fixed IP"), value: templateAnnotations[kubeOvnAnnotations.ipAddress] || "Dynamic" },
                  { label: t("Port security"), value: templateAnnotations[kubeOvnAnnotations.portSecurity] === "true" ? "Enabled" : "Disabled" },
                  { label: t("Host"), value: vmi?.status.nodeName || "Not running" },
                ]} />
              </Panel>
            <Panel
              title={t("Security groups")}
              description={sgProviders.length ? sgProviders.map((engine) => engineLabel[engine]).join(" / ") : t("Not available on this network stack")}
              actions={sgProvider && <Button size="sm" variant="outline" onClick={() => setDialog("Security Groups")}>{t("Change")}</Button>}
              bodyClassName="space-y-1.5"
            >
              {securityGroups.map((group) => (
                <Link key={`${group.provider}:${group.name}`} to={sgDetailPath({ ...group, namespace })} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-muted/50 hover:text-primary">
                  <ShieldCheck className="size-4 text-muted-foreground" />{group.name}
                  {sgProviders.length > 1 && <span className="ml-auto text-xs text-muted-foreground">{engineLabel[group.provider]}</span>}
                </Link>
              ))}
              {sgProvider && securityGroups.length === 0 && <p className="text-sm text-muted-foreground">{t("None attached.")}</p>}
              {!sgProvider && <p className="text-sm text-muted-foreground">{t("Use")} <Link to="/networks/kubernetes/network-policies" className="text-primary hover:underline">{t("network policies")}</Link> {t("instead.")}</p>}
            </Panel>
          </div>
        )}

        {activeTab === "monitoring" && <VmMonitoring namespace={namespace!} name={name!} running={vmi?.status.phase === "Running"} />}

        {/* VM, VMI and migration events share the VM name; launcher pod events appear under the pod. */}
        {activeTab === "events" && <EventList url={eventsUrl({ namespace, name })} />}

        {activeTab === "console" && <SerialConsole namespace={namespace!} name={name!} />}
        {activeTab === "vnc" && <VncConsole namespace={namespace!} name={name!} />}

        {activeTab === "manifest" && (
          <pre className="min-h-[400px] overflow-x-auto rounded-lg border bg-card p-4 font-mono text-[13px] leading-relaxed text-foreground whitespace-pre">{vmYaml || t("Loading...")}</pre>
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
    <div className="p-12 text-center text-muted-foreground border-2 border-dashed rounded-lg mt-8">{t("DataVolume not found")}
    </div>
  );

  const tabs = [
    { id: "overview", name: t("Overview"), icon: Info },
    { id: "events", name: t("Events"), icon: Bell },
    { id: "manifest", name: t("Manifest"), icon: FileCode },
  ];
  const conditions = dv.status?.conditions || [];
  const labels = Object.entries(dv.metadata.labels || {});

  return (
    <div className="space-y-5">
      <PageHeader
        breadcrumbs={[{ label: t("Disks"), to: "/kubevirt/cdi/data-volumes" }, { label: dv.metadata.namespace }, { label: dv.metadata.name }]}
        title={dv.metadata.name}
        badge={<StatusDot status={dv.status?.phase} />}
        subtitle={`${dvSize(dv)} · ${dvStorageClass(dv)}`}
        actions={
          <>
            <VmActionDialog
              label={t("Resize")}
              description={t("Expand the PVC bound to this disk. Shrinking is not supported.")}
              fields={[{ name: "storage", label: t("New size"), defaultValue: dvSize(dv) === "N/A" ? "10Gi" : dvSize(dv) }]}
              buildRequest={(values) => ({
                url: `/api/v1/namespaces/${namespace}/persistentvolumeclaims/${dv.status?.claimName || name}`,
                options: mergePatch({ spec: { resources: { requests: { storage: stringValue(values.storage, "10Gi") } } } }),
              })}
              onDone={loadDv}
            />
            <VmActionDialog
              label={t("Labels")}
              description={t("One key=value per line.")}
              fields={[
                { name: "labels", label: t("Labels"), type: "textarea", defaultValue: keyValueText(dv.metadata.labels) },
                { name: "annotations", label: t("Annotations"), type: "textarea", defaultValue: keyValueText(dv.metadata.annotations) },
              ]}
              buildRequest={(values) => ({
                url: `/apis/cdi.kubevirt.io/v1beta1/namespaces/${namespace}/datavolumes/${name}`,
                options: mergePatch({ metadata: { labels: replaceMap(dv.metadata.labels, parseKeyValueText(values.labels || "")), annotations: replaceMap(dv.metadata.annotations, parseKeyValueText(values.annotations || "")) } }),
              })}
              onDone={loadDv}
            />
            <VmActionDialog
              label={t("Delete")}
              description={t("Delete disk {v0}/{v1} and its PVC.", { v0: dv.metadata.namespace, v1: dv.metadata.name })}
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
          <Panel title={t("Details")}>
            <KeyValueGrid items={[
              { label: t("Size"), value: <span className="font-mono">{dvSize(dv)}</span> },
              { label: t("Storage class"), value: dvStorageClass(dv) },
              { label: t("Access modes"), value: dv.spec.storage?.accessModes?.join(", ") || dv.spec.pvc?.accessModes?.join(", ") || "default" },
              { label: t("Volume mode"), value: dv.spec.storage?.volumeMode || dv.spec.pvc?.volumeMode || "default" },
              { label: t("PVC"), value: <Link to={`/storage/kubernetes/persistent-volume-claims/${dv.metadata.namespace}/${dv.status?.claimName || dv.metadata.name}`} className="hover:text-primary transition-colors">{dv.status?.claimName || dv.metadata.name}</Link> },
              { label: t("Progress"), value: dv.status?.progress || "N/A" },
              { label: t("Source"), value: dvSource(dv) },
              { label: t("Created"), value: relativeTime(dv.metadata.creationTimestamp) },
            ]} />
          </Panel>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title={t("Source")}>
              {dv.spec.source ? (
                <pre className="overflow-x-auto font-mono text-xs text-foreground whitespace-pre-wrap">{JSON.stringify(dv.spec.source, null, 2)}</pre>
              ) : <p className="text-sm text-muted-foreground">{t("Blank disk")}</p>}
            </Panel>
            <Panel title={t("Conditions")} bodyClassName="p-0">
              {conditions.length === 0 ? <p className="p-4 text-sm text-muted-foreground">{t("None reported")}</p> : (
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
            <Panel title={t("Labels")} bodyClassName="flex flex-wrap gap-1.5">
              {labels.map(([k, v]) => <span key={k} className="rounded border bg-muted/60 px-1.5 py-0.5 font-mono text-xs">{k}={v}</span>)}
            </Panel>
          )}
        </div>
      ) : activeTab === "events" ? (
        // Import, upload and clone progress is reported on both the DataVolume and its PVC, which share the name.
        <EventList url={eventsUrl({ namespace, name })} />
      ) : (
        <pre className="min-h-[400px] overflow-x-auto rounded-lg border bg-card p-4 font-mono text-[13px] leading-relaxed text-foreground whitespace-pre">{dvYaml || t("Loading...")}</pre>
      )}
    </div>
  );
}

function resourceRoutes(config: ResourceConfig) {
  return [
    <Route key={`${config.path}-list`} path={config.path} element={<ResourceList config={config} />} />,
    <Route key={`${config.path}-detail`} path={`${config.path}/:namespace/:name`} element={<ResourceDetail config={config} />} />,
    <Route key={`${config.path}-manifest`} path={`${config.path}/:namespace/:name/manifest`} element={<ResourceManifest config={config} />} />,
    <Route key={`${config.path}-events`} path={`${config.path}/:namespace/:name/events`} element={<ResourceEvents config={config} />} />,
  ];
}

function App() {
  // Changing the language remounts the console so every t() call renders again.
  const locale = useLocale();
  return (
    <BrowserRouter>
      <SidebarProvider key={locale}>
        <AppSidebar />
        <SidebarInset className="min-h-0 overflow-y-auto">
          <SiteHeader />
          <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col px-4 py-6 lg:px-8 lg:py-8">
            <Routes>
              <Route path="/" element={<OverviewPage />} />
              <Route path="/catalog" element={<CatalogPage />} />
              <Route path="/events" element={<EventsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/vpc/vpcs" element={<VpcListPage />} />
              <Route path="/vpc/vpcs/:name" element={<VpcDetailPage />} />
              <Route path="/vpc/subnets" element={<SubnetListPage />} />
              <Route path="/vpc/subnets/:name" element={<SubnetDetailPage />} />
              <Route path="/vpc/elastic-ips" element={<ElasticIpPage />} />
              <Route path="/vpc/nat-gateways" element={<NatGatewayPage />} />
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
              <Route path="*" element={<div className="p-20 text-center text-muted-foreground border-2 border-dashed rounded-lg mt-12">{t("Page not found")}</div>} />
            </Routes>
          </div>
        </SidebarInset>
        <Toaster />
      </SidebarProvider>
    </BrowserRouter>
  );
}

export default App;
