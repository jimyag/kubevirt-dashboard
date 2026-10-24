import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { Bookmark, Plus, RefreshCw, Trash2 } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Combobox, ConfirmDialog, DataTable, EmptyState, FieldRow, FilterInput, NativeSelect, PageHeader, StatusDot, Toolbar } from "@/components/console"
import { useFilteredRows, type FilterField } from "@/lib/filter"
import { asList, asRecord, kubeOvnAnnotations, listItems, relativeTime, requestJson, str, useAsync, useNamespaces, useNetworkProfile, type KubeObject } from "@/lib/kube"
import { cidrContains, ipv4Cidr, isDnsLabel } from "@/lib/validate"
import { KubeOvnMissing } from "@/pages/vpc"
import { t } from "@/lib/i18n"
import { reservedIpNamespace, reservedIpNamespaceAnnotation } from "@/lib/vm-network"

const OVN = "/apis/kubeovn.io/v1"

type Row = { vip: KubeObject; address: string; subnet: string; namespace: string; usedBy: KubeObject | undefined; binding: string; status: string }

const vipStatus = (vip: KubeObject) => {
  const ready = asList(asRecord(vip.status).conditions).find((condition) => condition.type === "Ready")
  if (ready) return ready.status === "True" ? "Ready" : "NotReady"
  return str(asRecord(vip.status).v4ip) ? "Ready" : "Pending"
}

const fields: FilterField<Row>[] = [
  { key: "name", label: "Name", value: (row) => row.vip.metadata.name },
  { key: "ip", label: "IP address", aliases: ["address"], value: (row) => row.address },
  { key: "subnet", label: "Subnet", value: (row) => row.subnet },
  { key: "namespace", label: "Namespace", aliases: ["ns"], value: (row) => row.namespace },
  { key: "instance", label: "Used by", aliases: ["vm"], value: (row) => row.usedBy?.metadata.name },
  { key: "status", label: "Status", value: (row) => row.status },
]

/**
 * Reserved private IPs: Kube-OVN Vip objects of the default type. An instance takes one through the
 * ovn.kubernetes.io/vip annotation, so its address survives deletion and re-creation.
 */
export function ReservedIpListPage() {
  const profile = useNetworkProfile()
  const [search, setSearch] = useState("")
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<Row | null>(null)
  const { data, loading, reload } = useAsync(async () => {
    const [vips, subnets, vms] = await Promise.all([listItems(`${OVN}/vips`), listItems(`${OVN}/subnets`), listItems("/apis/kubevirt.io/v1/virtualmachines")])
    return { vips, subnets, vms }
  }, { vips: [] as KubeObject[], subnets: [] as KubeObject[], vms: [] as KubeObject[] }, [])

  const rows = useMemo(() => data.vips
    // Load balancer VIPs (type switch_lb_vip) belong to SwitchLBRules, not to instances.
    .filter((vip) => !str(asRecord(vip.spec).type))
    .map((vip): Row => {
      const spec = asRecord(vip.spec)
      return {
        vip,
        address: str(asRecord(vip.status).v4ip) || str(spec.v4ip),
        subnet: str(spec.subnet),
        namespace: reservedIpNamespace(vip),
        usedBy: data.vms.find((vm) => str(asRecord(asRecord(asRecord(asRecord(vm.spec).template).metadata).annotations)[kubeOvnAnnotations.vip]) === vip.metadata.name),
        binding: vip.metadata.labels?.["ovn.kubernetes.io/ip_reserved"] || "",
        status: str(spec.namespace) ? "Needs recreation" : vipStatus(vip),
      }
    }), [data])
  const filtered = useFilteredRows(rows, fields, search)

  if (profile.loaded && !profile.vpc) return <div className="space-y-4"><PageHeader title={t("Reserved IPs")} /><KubeOvnMissing /></div>

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("Reserved IPs")}
        subtitle="kubeovn.io/v1 Vip"
        actions={<Button onClick={() => setCreating(true)} className="gap-1.5"><Plus className="size-4" />{t("Reserve IP")}</Button>}
      />
      <Toolbar right={<FilterInput value={search} onChange={setSearch} fields={fields} rows={rows} placeholder={t("Filter, e.g. subnet:subnet-web")} />}>
        <Button size="sm" variant="outline" onClick={reload} className="gap-2"><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />{t("Refresh")}</Button>
      </Toolbar>
      <DataTable
        loading={loading}
        rows={filtered}
        rowKey={(row) => row.vip.metadata.name}
        empty={<EmptyState icon={Bookmark} title={rows.length ? t("No matching reserved IPs") : t("No reserved IPs")} action={<Button size="sm" onClick={() => setCreating(true)}>{t("Reserve IP")}</Button>} />}
        columns={[
          {
            header: t("IP address"),
            cell: (row) => (
              <div className="flex flex-col">
                <span className="font-mono text-sm">{row.address || "-"}</span>
                <span className="text-xs text-muted-foreground">{row.vip.metadata.name}</span>
              </div>
            ),
          },
          { header: t("Subnet"), cell: (row) => <Link to={`/vpc/subnets/${row.subnet}`} className="text-sm hover:text-primary transition-colors">{row.subnet}</Link> },
          { header: t("Namespace"), cell: (row) => <span className="text-sm text-muted-foreground">{row.namespace || t("Any")}</span> },
          {
            header: t("Used by"),
            cell: (row) => row.usedBy
              ? <Link to={`/kubevirt/virtualization/virtual-machines/${row.usedBy.metadata.namespace}/${row.usedBy.metadata.name}/network`} className="text-sm font-medium hover:text-primary transition-colors">{row.usedBy.metadata.name}</Link>
              : <span className="text-sm text-muted-foreground">{row.binding || t("Free")}</span>,
          },
          { header: t("Status"), cell: (row) => <StatusDot status={row.status} /> },
          { header: t("Created"), className: "text-right", cell: (row) => <span className="text-sm text-muted-foreground tabular-nums" title={row.vip.metadata.creationTimestamp}>{relativeTime(row.vip.metadata.creationTimestamp)}</span> },
          { header: "", className: "w-12 text-right", cell: (row) => <Button size="icon" variant="ghost" disabled={!!row.usedBy || !!row.binding} title={row.usedBy || row.binding ? t("Stop using this address before releasing it.") : undefined} aria-label={t("Delete {v0}", { v0: row.vip.metadata.name })} onClick={() => setDeleting(row)}><Trash2 className="size-4 text-muted-foreground" /></Button> },
        ]}
      />
      <ReserveIpDialog open={creating} onOpenChange={setCreating} subnets={data.subnets} vips={data.vips} onCreated={reload} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t("Release reserved IP {address}?", { address: deleting?.address || deleting?.vip.metadata.name })}
        description={t("The address returns to the subnet pool.")}
        destructive
        confirmLabel={t("Release")}
        onConfirm={async () => {
          const current = await requestJson(`${OVN}/vips/${deleting?.vip.metadata.name}`, { method: "GET" }) as KubeObject
          if (deleting?.usedBy || current.metadata.labels?.["ovn.kubernetes.io/ip_reserved"]) throw new Error(t("Stop using this address before releasing it."))
          await requestJson(`${OVN}/vips/${current.metadata.name}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiVersion: "v1", kind: "DeleteOptions", preconditions: { resourceVersion: current.metadata.resourceVersion } }) })
          reload()
        }}
      />
    </div>
  )
}

function ReserveIpDialog({ open, onOpenChange, subnets, vips, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; subnets: KubeObject[]; vips: KubeObject[]; onCreated: () => void }) {
  const namespaces = useNamespaces()
  const usable = subnets.filter((subnet) => !["join"].includes(subnet.metadata.name) && str(asRecord(subnet.spec).provider, "ovn") === "ovn")
  const [values, setValues] = useState({ name: "", subnet: "", namespace: "", address: "" })
  const set = (patch: Partial<typeof values>) => setValues((current) => ({ ...current, ...patch }))
  const subnet = usable.find((item) => item.metadata.name === values.subnet)
  const cidr = ipv4Cidr(str(asRecord(subnet?.spec).cidrBlock))

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setValues({ name: "", subnet: "", namespace: "", address: "" })
        onOpenChange(next)
      }}
      title={t("Reserve IP")}
      description={t("Holds a private IP in a subnet for an instance to use.")}
      confirmLabel={t("Reserve")}
      onConfirm={async () => {
        const name = values.name.trim()
        const address = values.address.trim()
        if (!isDnsLabel(name)) throw new Error(t("Name must be at most 63 lowercase letters, digits and dashes."))
        if (vips.some((vip) => vip.metadata.name === name)) throw new Error(t("{name} already exists.", { name }))
        if (!subnet) throw new Error(t("Choose a subnet."))
        if (address && cidr && !cidrContains(cidr, address)) throw new Error(t("{ip} is not inside {cidr}.", { ip: address, cidr }))
        if (address && address === str(asRecord(subnet.spec).gateway)) throw new Error(t("The private IP cannot be the subnet gateway."))
        await requestJson(`${OVN}/vips`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiVersion: "kubeovn.io/v1",
            kind: "Vip",
            metadata: { name, annotations: { [reservedIpNamespaceAnnotation]: values.namespace.trim() } },
            spec: { subnet: subnet.metadata.name, ...(address ? { v4ip: address } : {}) },
          }),
        })
        onCreated()
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FieldRow label={t("Name")}><Input value={values.name} onChange={(e) => set({ name: e.target.value })} placeholder="vip-web-01" /></FieldRow>
        <FieldRow label={t("Subnet")}>
          <NativeSelect value={values.subnet} onChange={(e) => set({ subnet: e.target.value, address: "" })}>
            <option value="">{t("Choose a subnet")}</option>
            {usable.map((item) => <option key={item.metadata.name} value={item.metadata.name}>{item.metadata.name} ({str(asRecord(item.spec).cidrBlock)})</option>)}
          </NativeSelect>
        </FieldRow>
        <FieldRow label={t("IP address")} hint={cidr ? t("Inside {cidr}. Leave empty to allocate automatically.", { cidr }) : t("Leave empty to allocate automatically.")}>
          <Input className="font-mono" value={values.address} onChange={(e) => set({ address: e.target.value })} placeholder={t("Auto")} />
        </FieldRow>
        <FieldRow label={t("Namespace")} hint={t("Only instances in this namespace can use it. Empty allows any.")}>
          <Combobox value={values.namespace} onChange={(namespace) => set({ namespace })} options={namespaces} placeholder={t("Any namespace")} aria-label={t("Namespace")} />
        </FieldRow>
      </div>
    </ConfirmDialog>
  )
}
