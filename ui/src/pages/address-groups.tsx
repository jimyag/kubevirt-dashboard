import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { ListTree, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ConfirmDialog, DataTable, EmptyState, FieldRow, FilterInput, PageHeader, Toolbar } from "@/components/console"
import { useFilteredRows, type FilterField } from "@/lib/filter"
import { relativeTime, useAsync } from "@/lib/kube"
import {
  addressGroupUsers,
  deleteAddressGroup,
  listAddressGroups,
  listSecurityGroups,
  saveAddressGroup,
  sgDetailPath,
  type AddressGroup,
  type SecurityGroup,
} from "@/lib/security-groups"
import { isDnsLabel, parseIPv4Cidr } from "@/lib/validate"
import { resourceLabel, t } from "@/lib/i18n"

type Row = { group: AddressGroup; users: SecurityGroup[] }

const fields: FilterField<Row>[] = [
  { key: "name", label: "Name", value: (row) => row.group.name },
  { key: "description", label: "Description", aliases: ["desc"], value: (row) => row.group.description },
  { key: "cidr", label: "CIDRs", value: (row) => row.group.cidrs },
  { key: "sg", label: "Used by", value: (row) => row.users.map((sg) => sg.name) },
]

const parseCidrs = (text: string) => text.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean)

/**
 * Address groups: CiliumCIDRGroup objects, i.e. named lists of external CIDRs that Cilium security
 * group rules reference instead of repeating the addresses.
 */
export function AddressGroupListPage() {
  const [search, setSearch] = useState("")
  const [editing, setEditing] = useState<AddressGroup | "new" | null>(null)
  const [deleting, setDeleting] = useState<Row | null>(null)
  const { data, loading, reload } = useAsync(async () => {
    const [groups, securityGroups] = await Promise.all([listAddressGroups(), listSecurityGroups("cilium")])
    return { groups, securityGroups }
  }, { groups: [] as AddressGroup[], securityGroups: [] as SecurityGroup[] }, [])

  const rows = useMemo(() => data.groups.map((group): Row => ({ group, users: addressGroupUsers(data.securityGroups, group.name) })), [data])
  const filtered = useFilteredRows(rows, fields, search)

  return (
    <div className="space-y-4">
      <PageHeader
        title={resourceLabel("Address Groups")}
        subtitle="CiliumCIDRGroup"
        actions={<Button onClick={() => setEditing("new")} className="gap-1.5"><Plus className="size-4" />{t("Create address group")}</Button>}
      />
      <Toolbar right={<FilterInput value={search} onChange={setSearch} fields={fields} rows={rows} placeholder={t("Filter, e.g. cidr:10.0")} />}>
        <Button size="sm" variant="outline" onClick={reload} className="gap-2"><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />{t("Refresh")}</Button>
      </Toolbar>
      <DataTable
        loading={loading}
        rows={filtered}
        rowKey={(row) => row.group.name}
        empty={<EmptyState icon={ListTree} title={rows.length ? t("No matching address groups") : t("No address groups")} action={<Button size="sm" onClick={() => setEditing("new")}>{t("Create address group")}</Button>} />}
        columns={[
          {
            header: t("Name"),
            cell: (row) => (
              <div className="flex flex-col">
                <span className="font-medium">{row.group.name}</span>
                {row.group.description && <span className="text-xs text-muted-foreground">{row.group.description}</span>}
              </div>
            ),
          },
          {
            header: t("CIDRs"),
            cell: (row) => <span className="font-mono text-xs">{row.group.cidrs.slice(0, 4).join(", ") || "-"}{row.group.cidrs.length > 4 ? ` +${row.group.cidrs.length - 4}` : ""}</span>,
          },
          {
            header: t("Used by"),
            cell: (row) => row.users.length ? (
              <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                {row.users.map((sg) => <Link key={`${sg.namespace || ""}/${sg.name}`} to={sgDetailPath(sg)} className="text-sm hover:text-primary transition-colors">{sg.name}</Link>)}
              </div>
            ) : <span className="text-sm text-muted-foreground">-</span>,
          },
          { header: t("Created"), className: "text-right", cell: (row) => <span className="text-sm text-muted-foreground tabular-nums" title={row.group.raw.metadata.creationTimestamp}>{relativeTime(row.group.raw.metadata.creationTimestamp)}</span> },
          {
            header: "",
            className: "w-24 text-right",
            cell: (row) => (
              <div className="flex justify-end">
                <Button size="icon" variant="ghost" aria-label={t("Edit {name}", { name: row.group.name })} onClick={() => setEditing(row.group)}><Pencil className="size-4 text-muted-foreground" /></Button>
                <Button size="icon" variant="ghost" aria-label={t("Delete {v0}", { v0: row.group.name })} onClick={() => setDeleting(row)}><Trash2 className="size-4 text-muted-foreground" /></Button>
              </div>
            ),
          },
        ]}
      />
      <AddressGroupDialog
        key={editing === null ? "closed" : editing === "new" ? "new" : editing.name}
        group={editing}
        users={editing && editing !== "new" ? addressGroupUsers(data.securityGroups, editing.name).length : 0}
        onOpenChange={(open) => !open && setEditing(null)}
        onSaved={reload}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t("Delete address group {name}?", { name: deleting?.group.name })}
        description={deleting?.users.length
          ? t("{count} security groups reference it; their rules stop matching these addresses.", { count: deleting.users.length })
          : t("No security group references it.")}
        destructive
        confirmLabel={t("Delete")}
        onConfirm={async () => {
          if (deleting) await deleteAddressGroup(deleting.group.name)
          reload()
        }}
      />
    </div>
  )
}

function AddressGroupDialog({ group, users, onOpenChange, onSaved }: { group: AddressGroup | "new" | null; users: number; onOpenChange: (open: boolean) => void; onSaved: () => void }) {
  const existing = group && group !== "new" ? group : undefined
  const [name, setName] = useState(existing?.name || "")
  const [description, setDescription] = useState(existing?.description || "")
  const [cidrs, setCidrs] = useState(existing?.cidrs.join("\n") || "")

  return (
    <ConfirmDialog
      open={group !== null}
      onOpenChange={onOpenChange}
      title={existing ? t("Edit address group {name}", { name: existing.name }) : t("Create address group")}
      description={existing && users ? t("{count} security groups use it; changes apply to their rules immediately.", { count: users }) : t("A named list of CIDRs outside the cluster, for security group rules.")}
      confirmLabel={existing ? t("Save") : t("Create")}
      onConfirm={async () => {
        const list = parseCidrs(cidrs)
        if (!existing && !isDnsLabel(name.trim())) throw new Error(t("Name must be at most 63 lowercase letters, digits and dashes."))
        if (list.length === 0) throw new Error(t("Add at least one CIDR."))
        const invalid = list.find((cidr) => (cidr.includes(":") ? !cidr.includes("/") : !parseIPv4Cidr(cidr)))
        if (invalid) throw new Error(t("{cidr} is not a valid CIDR.", { cidr: invalid }))
        await saveAddressGroup({ name: existing?.name || name.trim(), description: description.trim(), cidrs: list }, existing)
        onSaved()
      }}
    >
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldRow label={t("Name")}><Input value={name} disabled={Boolean(existing)} onChange={(e) => setName(e.target.value)} placeholder="office-networks" /></FieldRow>
          <FieldRow label={t("Description")}><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("Optional")} /></FieldRow>
        </div>
        <FieldRow label={t("CIDRs")} hint={t("One per line.")}>
          <textarea
            value={cidrs}
            onChange={(e) => setCidrs(e.target.value)}
            placeholder={"203.0.113.0/24\n198.51.100.10/32"}
            className="min-h-32 rounded-md border bg-background px-3 py-2 font-mono text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </FieldRow>
      </div>
    </ConfirmDialog>
  )
}
