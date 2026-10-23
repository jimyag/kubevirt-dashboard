import { useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ConfirmDialog, DataTable, EmptyState, FieldRow, NativeSelect, Panel, StatusDot, UsageBar } from "@/components/console"
import { asRecord, requestJson, str, type KubeObject } from "@/lib/kube"
import { cidrContains, cidrsOverlap, ipv4Cidr, isDnsLabel, parseIPv4Cidr } from "@/lib/validate"
import { t } from "@/lib/i18n"
import { poolStatus } from "@/lib/vpc"

const OVN = "/apis/kubeovn.io/v1"

const list = (text: string) => text.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean)

/** An IPPool entry is an address, a range "a..b" or a CIDR; returns why it is not usable in the subnet. */
const entryProblem = (entry: string, subnetCidr: string) => {
  const inside = (ip: string) => !subnetCidr || cidrContains(subnetCidr, ip)
  if (entry.includes(":")) return ""
  if (entry.includes("..")) {
    const [start, end] = entry.split("..")
    return inside(start) && inside(end) ? "" : t("{entry} is not inside {cidr}.", { entry, cidr: subnetCidr })
  }
  if (entry.includes("/")) {
    if (!parseIPv4Cidr(entry)) return t("{cidr} is not a valid CIDR.", { cidr: entry })
    return !subnetCidr || cidrsOverlap(subnetCidr, entry) ? "" : t("{entry} is not inside {cidr}.", { entry, cidr: subnetCidr })
  }
  return inside(entry) ? "" : t("{entry} is not inside {cidr}.", { entry, cidr: subnetCidr })
}

/** IP pools with usage; `showSubnet` adds the subnet column for the cluster-wide list. */
export function IpPoolTable({ pools, loading, showSubnet, onDelete, empty }: { pools: KubeObject[]; loading?: boolean; showSubnet?: boolean; onDelete: (pool: KubeObject) => void; empty?: ReactNode }) {
  return (
    <DataTable
      loading={loading}
      rows={pools}
      rowKey={(pool) => pool.metadata.name}
      minWidth={600}
      empty={empty ?? <EmptyState title={t("No IP pools")} />}
      columns={[
        { header: t("Name"), cell: (pool) => <span className="font-medium">{pool.metadata.name}</span> },
        ...(showSubnet ? [{ header: t("Subnet"), cell: (pool: KubeObject) => <Link to={`/vpc/subnets/${str(asRecord(pool.spec).subnet)}`} className="text-sm hover:text-primary transition-colors">{str(asRecord(pool.spec).subnet)}</Link> }] : []),
        { header: t("Addresses"), cell: (pool) => <span className="font-mono text-xs break-all">{((asRecord(pool.spec).ips as string[] | undefined) || []).join(", ")}</span> },
        { header: t("Namespaces"), cell: (pool) => <span className="text-sm text-muted-foreground">{((asRecord(pool.spec).namespaces as string[] | undefined) || []).join(", ") || "-"}</span> },
        {
          header: t("Usage"),
          cell: (pool) => {
            const status = asRecord(pool.status)
            const used = Number(status.v4UsingIPs ?? 0)
            return <UsageBar used={used} total={used + Number(status.v4AvailableIPs ?? 0)} />
          },
        },
        { header: t("Status"), cell: (pool) => <StatusDot status={poolStatus(pool)} /> },
        { header: "", className: "w-12 text-right", cell: (pool) => <Button size="icon" variant="ghost" aria-label={t("Delete {v0}", { v0: pool.metadata.name })} onClick={() => onDelete(pool)}><Trash2 className="size-4 text-muted-foreground" /></Button> },
      ]}
    />
  )
}

/** Creates an IP pool. With `subnet` the subnet is fixed; otherwise the dialog asks for one. */
export function CreateIpPoolDialog({ open, onOpenChange, subnet, subnets = [], onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; subnet?: KubeObject; subnets?: KubeObject[]; onCreated: () => void }) {
  const [values, setValues] = useState({ name: "", subnet: "", ips: "", namespaces: "" })
  const set = (patch: Partial<typeof values>) => setValues((current) => ({ ...current, ...patch }))
  const target = subnet ?? subnets.find((item) => item.metadata.name === values.subnet)
  const subnetCidr = ipv4Cidr(str(asRecord(target?.spec).cidrBlock))
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) setValues({ name: "", subnet: "", ips: "", namespaces: "" })
      }}
      title={subnet ? t("Create IP pool in {subnet}", { subnet: subnet.metadata.name }) : t("Create IP pool")}
      description={t("Instances in the bound namespaces get addresses from this pool only.")}
      confirmLabel={t("Create")}
      onConfirm={async () => {
        const name = values.name.trim()
        const ips = list(values.ips)
        const bound = list(values.namespaces)
        if (!isDnsLabel(name)) throw new Error(t("Name must be at most 63 lowercase letters, digits and dashes."))
        if (!target) throw new Error(t("Choose a subnet."))
        if (ips.length === 0) throw new Error(t("Add at least one address, range or CIDR."))
        const problem = ips.map((entry) => entryProblem(entry, subnetCidr)).find(Boolean)
        if (problem) throw new Error(problem)
        await requestJson(`${OVN}/ippools`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiVersion: "kubeovn.io/v1", kind: "IPPool", metadata: { name }, spec: { subnet: target.metadata.name, ips, ...(bound.length ? { namespaces: bound } : {}) } }),
        })
        onCreated()
      }}
    >
      <div className="grid gap-4">
        <FieldRow label={t("Name")}><Input value={values.name} onChange={(e) => set({ name: e.target.value })} placeholder="pool-prod" /></FieldRow>
        {!subnet && (
          <FieldRow label={t("Subnet")}>
            <NativeSelect value={values.subnet} onChange={(e) => set({ subnet: e.target.value })}>
              <option value="">{t("Choose a subnet")}</option>
              {subnets.map((item) => <option key={item.metadata.name} value={item.metadata.name}>{item.metadata.name} ({str(asRecord(item.spec).cidrBlock)})</option>)}
            </NativeSelect>
          </FieldRow>
        )}
        <FieldRow label={t("Addresses")} hint={t("Addresses, ranges (a..b) or CIDRs inside {cidr}, separated by commas.", { cidr: subnetCidr || t("the subnet") })}>
          <Input className="font-mono text-xs" value={values.ips} onChange={(e) => set({ ips: e.target.value })} placeholder={subnetCidr ? `${subnetCidr.split("/")[0].replace(/\.\d+$/, ".100")}..${subnetCidr.split("/")[0].replace(/\.\d+$/, ".150")}` : "10.0.0.100..10.0.0.150"} />
        </FieldRow>
        <FieldRow label={t("Namespaces")} hint={t("Separated by commas.")}>
          <Input value={values.namespaces} onChange={(e) => set({ namespaces: e.target.value })} placeholder={t("ns-a, ns-b")} />
        </FieldRow>
      </div>
    </ConfirmDialog>
  )
}

export function DeleteIpPoolDialog({ pool, onOpenChange, onDeleted }: { pool: KubeObject | null; onOpenChange: (open: boolean) => void; onDeleted: () => void }) {
  return (
    <ConfirmDialog
      open={pool !== null}
      onOpenChange={onOpenChange}
      title={t("Delete IP pool {name}?", { name: pool?.metadata.name })}
      description={t("Addresses already assigned stay with their instances. New instances in the bound namespaces use the whole subnet.")}
      destructive
      confirmLabel={t("Delete")}
      onConfirm={async () => {
        await requestJson(`${OVN}/ippools/${pool?.metadata.name}`, { method: "DELETE" })
        onDeleted()
      }}
    />
  )
}

/**
 * Kube-OVN IPPools of a subnet: address ranges reserved for the namespaces bound to the pool, so
 * instances in those namespaces get addresses only from them.
 */
export function SubnetIpPools({ subnet, pools, onChanged }: { subnet: KubeObject; pools: KubeObject[]; onChanged: () => void }) {
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<KubeObject | null>(null)
  return (
    <Panel
      title={t("IP pools")}
      actions={<Button size="sm" variant="outline" className="gap-1.5" onClick={() => setCreating(true)}><Plus className="size-4" />{t("Create IP pool")}</Button>}
    >
      <IpPoolTable pools={pools} onDelete={setDeleting} />
      <CreateIpPoolDialog open={creating} onOpenChange={setCreating} subnet={subnet} onCreated={onChanged} />
      <DeleteIpPoolDialog pool={deleting} onOpenChange={(open) => !open && setDeleting(null)} onDeleted={onChanged} />
    </Panel>
  )
}
