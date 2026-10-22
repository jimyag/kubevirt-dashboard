import { useCallback, useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import {
  Terminal,
  FileCode,
  Info,
  ShieldCheck,
  Bell,
  Activity,
  MousePointer2,
  Play,
  Square,
  RotateCcw,
  MonitorPlay,
  ChevronDown,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { VncConsole } from "@/components/VncConsole";
import { SerialConsole } from "@/components/SerialConsole";
import { RelatedPodsCard } from "@/components/pod-access";
import { Button } from "@/components/ui/button";
import { jsonPost, jsonPut, keyValueText, mergePatch, numberValue, parseKeyValueText, stringValue } from "@/resources/configs";
import { ConfirmDialog, DataTable, EmptyState, KeyValueGrid, PageHeader, Panel, StatusDot } from "@/components/console";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { kubeOvnAnnotations, relativeTime, replaceMap, useNetworkProfile, type KubeObject } from "@/lib/kube";
import { engineLabel, sgDetailPath, useSgProvider, vmSecurityGroupRefs } from "@/lib/security-groups";
import { EventList } from "@/components/events";
import { VmMonitoring } from "@/components/monitoring";
import { eventsUrl } from "@/lib/events";
import { ManifestPanel } from "@/components/manifest";
import { InstanceSecurityGroupsDialog } from "@/pages/security-groups";
import { t } from "@/lib/i18n";
import { usePolling } from "@/lib/polling";
import { CopyableText, StatusBadge, VmActionDialog } from "@/components/vm-dialogs";
import { apiFetch, isVm, vmPodSelectors, type DV, type VM, type VMI } from "@/lib/vm-pages";
import { InstanceElasticIps } from "@/components/instance-eip";

type VmPowerAction = "start" | "stop" | "restart" | "pause" | "unpause" | "poweroff" | "migrate";

// Titles and labels stay English here and are translated where they render.
const vmPowerText: Record<VmPowerAction, { title: string; label: string; description?: string }> = {
  start: { title: "Start instance {name}?", label: "Start" },
  stop: { title: "Stop instance {name}?", label: "Stop", description: "The guest OS is asked to shut down." },
  restart: { title: "Restart instance {name}?", label: "Restart", description: "The guest OS is restarted." },
  pause: { title: "Pause instance {name}?", label: "Pause", description: "The guest is frozen in memory until resumed." },
  unpause: { title: "Resume instance {name}?", label: "Resume" },
  poweroff: { title: "Force power off {name}?", label: "Force power off", description: "Like pulling the power cord: the guest stops immediately and unsaved data is lost." },
  migrate: { title: "Live migrate {name}?", label: "Live migrate", description: "The instance moves to another host while it keeps running." },
};

export function VMDetailContent() {
  const { namespace, name, tab } = useParams(); const navigate = useNavigate(); const [vm, setVm] = useState<VM | null>(null); const [vmi, setVmi] = useState<VMI | null>(null); const [associatedDVs, setAssociatedDVs] = useState<DV[]>([]); const [loading, setLoading] = useState(true); const [dialog, setDialog] = useState<string | null>(null); const [powerAction, setPowerAction] = useState<VmPowerAction | null>(null); const { provider: sgProvider, providers: sgProviders } = useSgProvider(); const profile = useNetworkProfile();
  const activeTab = tab === "yaml" ? "manifest" : tab || "overview";
  const fetchData = useCallback(async () => {
    try {
      const [vmRes, vmiRes] = await Promise.all([ apiFetch(`/apis/kubevirt.io/v1/namespaces/${namespace}/virtualmachines/${name}`), apiFetch(`/apis/kubevirt.io/v1/namespaces/${namespace}/virtualmachineinstances/${name}`) ]);
      const rawVmData: unknown = vmRes.ok ? await vmRes.json() : null; const vmData = isVm(rawVmData) ? rawVmData : null; setVm(vmData); setVmi(vmiRes.ok ? await vmiRes.json() : null);
      if (vmData?.spec.template?.spec?.volumes) { const dns = vmData.spec.template.spec.volumes.filter((v) => v.dataVolume).map((v) => v.dataVolume!.name); if (dns.length > 0) { const ds = await Promise.all(dns.map((dn:string) => apiFetch(`/apis/cdi.kubevirt.io/v1beta1/namespaces/${namespace}/datavolumes/${dn}`).then(r => r.ok ? r.json() : null))); setAssociatedDVs(ds.filter(d => d !== null)); } }
    } finally { setLoading(false); }
  }, [name, namespace]);
  useEffect(() => { fetchData(); }, [fetchData]);
  usePolling(fetchData, 5000);
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
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setPowerAction("stop")}><Square className="size-3.5" />{t("Stop")}</Button>
            ) : (
              <Button size="sm" className="gap-1.5" onClick={() => setPowerAction("start")}><Play className="size-3.5" />{t("Start")}</Button>
            )}
            <Button size="sm" variant="outline" className="gap-1.5" disabled={!isRunning} onClick={() => setPowerAction("restart")}><RotateCcw className="size-3.5" />{t("Restart")}</Button>
            <Button size="sm" variant="outline" className="gap-1.5" disabled={!isRunning} onClick={() => navigate(`/kubevirt/virtualization/virtual-machines/${namespace}/${name}/vnc`)}><MonitorPlay className="size-3.5" />{t("Connect")}</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="gap-1.5">{t("More")}<ChevronDown className="size-3.5" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel>{t("Power")}</DropdownMenuLabel>
                <DropdownMenuItem disabled={!isRunning} onClick={() => setPowerAction("pause")}>{t("Pause")}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setPowerAction("unpause")}>{t("Resume")}</DropdownMenuItem>
                <DropdownMenuItem disabled={!isRunning} onClick={() => setPowerAction("poweroff")}>{t("Force power off")}</DropdownMenuItem>
                <DropdownMenuItem disabled={!isRunning} onClick={() => setPowerAction("migrate")}>{t("Live migrate")}</DropdownMenuItem>
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
                  { label: t("Subnet"), value: templateAnnotations[kubeOvnAnnotations.logicalSwitch] || (profile.vpc ? t("Namespace default") : t("Pod network")) },
                  { label: t("Fixed IP"), value: templateAnnotations[kubeOvnAnnotations.ipAddress] || t("Dynamic") },
                  { label: t("Port security"), value: templateAnnotations[kubeOvnAnnotations.portSecurity] === "true" ? t("Enabled") : t("Disabled") },
                  { label: t("Host"), value: vmi?.status.nodeName || t("Not running") },
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
            {profile.vpc && (
              <InstanceElasticIps
                namespace={namespace!}
                name={name!}
                ips={(vmi?.status.interfaces || []).flatMap((iface) => (iface as { ipAddresses?: string[] }).ipAddresses || (iface.ipAddress ? [iface.ipAddress] : [])).filter((ip) => ip.includes("."))}
                subnet={templateAnnotations[kubeOvnAnnotations.logicalSwitch]}
              />
            )}
          </div>
        )}

        {activeTab === "monitoring" && <VmMonitoring namespace={namespace!} name={name!} running={vmi?.status.phase === "Running"} />}

        {/* VM, VMI and migration events share the VM name; launcher pod events appear under the pod. */}
        {activeTab === "events" && <EventList url={eventsUrl({ namespace, name })} />}

        {activeTab === "console" && <SerialConsole namespace={namespace!} name={name!} />}
        {activeTab === "vnc" && <VncConsole namespace={namespace!} name={name!} />}

        {activeTab === "manifest" && (
          <ManifestPanel object={vm} url={vmPatchUrl} onSaved={fetchData} />
        )}
      </div>
      <ConfirmDialog
        open={powerAction !== null}
        onOpenChange={(open) => !open && setPowerAction(null)}
        title={powerAction ? t(vmPowerText[powerAction].title, { name: vm.metadata.name }) : ""}
        description={powerAction && vmPowerText[powerAction].description ? t(vmPowerText[powerAction].description!) : undefined}
        confirmLabel={powerAction ? t(vmPowerText[powerAction].label) : ""}
        destructive={powerAction === "poweroff"}
        onConfirm={async () => {
          if (powerAction) await handleAction(powerAction)
        }}
      />
    </div>
  );
}
