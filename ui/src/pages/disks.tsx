import { useMemo, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import {
  FileCode,
  Info,
  Bell,
  RefreshCw,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { ResourceCreateDialog } from "@/components/resource-management";
import { Button } from "@/components/ui/button";
import { dvCreateConfig, keyValueText, mergePatch, parseKeyValueText, stringValue } from "@/resources/configs";
import { Combobox, DataTable, EmptyState, FilterInput, KeyValueGrid, LoadingState, PageHeader, Panel, StatusDot, Toolbar } from "@/components/console";
import { namespaceScope, useFilteredRows, type FilterField } from "@/lib/filter";
import { relativeTime, replaceMap, useAsync, useNamespaces } from "@/lib/kube";
import { EventList } from "@/components/events";
import { eventsUrl } from "@/lib/events";
import { ManifestPanel } from "@/components/manifest";
import { t } from "@/lib/i18n";
import { usePolling } from "@/lib/polling";
import { VmActionDialog } from "@/components/vm-dialogs";
import { apiFetch, type DV, type VM } from "@/lib/vm-pages";

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

export function DVList() {
  const [searchTerm, setSearchTerm] = useState(""); const namespaces = useNamespaces(); const [namespaceFilter, setNamespaceFilter] = useState("");
  const ns = useMemo(() => namespaceScope(namespaceFilter, namespaces), [namespaceFilter, namespaces]);
  const scope = ns.scope;
  const { data: { dvs, vms }, loading, reload: loadDvs } = useAsync(async () => {
    const prefix = scope === "all" ? "" : `/namespaces/${scope}`;
    const [dvData, vmData] = await Promise.all([
      apiFetch(`/apis/cdi.kubevirt.io/v1beta1${prefix}/datavolumes`).then(r => r.ok ? r.json() : { items: [] }),
      apiFetch(`/apis/kubevirt.io/v1${prefix}/virtualmachines`).then(r => r.ok ? r.json() : { items: [] }),
    ]);
    return { dvs: (dvData.items || []) as DV[], vms: (vmData.items || []) as VM[] };
  }, { dvs: [] as DV[], vms: [] as VM[] }, [scope]);
  // Import and clone progress changes on its own.
  usePolling(loadDvs, 15000);
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
        loading={loading && dvs.length === 0}
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

export function DVDetailContent() {
  const { namespace, name, tab } = useParams(); const navigate = useNavigate(); const activeTab = tab === "yaml" ? "manifest" : tab || "overview";
  const { data: dv, loading, reload: loadDv } = useAsync<DV | null>(async () => {
    const r = await apiFetch(`/apis/cdi.kubevirt.io/v1beta1/namespaces/${namespace}/datavolumes/${name}`);
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }, null, [name, namespace]);
  usePolling(loadDv, 10000);

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
        <ManifestPanel object={dv} url={`/apis/cdi.kubevirt.io/v1beta1/namespaces/${namespace}/datavolumes/${name}`} onSaved={loadDv} />
      )}
    </div>
  );
}
