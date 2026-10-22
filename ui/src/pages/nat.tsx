import { useMemo, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import * as YAML from "js-yaml"
import { Globe, Plus, RefreshCw, Trash2, Waypoints } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  ChoiceCard,
  Combobox,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorNote,
  FieldRow,
  FilterInput,
  PageHeader,
  StatusDot,
  TabBar,
  Toolbar,
  type Column,
} from "@/components/console"
import { asRecord, listItems, relativeTime, requestJson, useAsync, useDiscovery, useNetworkProfile, type KubeObject } from "@/lib/kube"
import { useFilteredRows, type FilterField } from "@/lib/filter"
import { isDnsLabel } from "@/lib/validate"
import { OVN_API, natEngineLabel, natKinds, natManifest, natReady, type NatEngine, type NatKind, type NatRefs, type NatTab } from "@/lib/nat"
import { t } from "@/lib/i18n"

const tabLabels: Record<NatTab, string> = {
  gateways: "NAT gateways",
  eips: "Elastic IPs",
  snat: "SNAT",
  dnat: "DNAT",
  fip: "Floating IPs",
}

/** Engines whose CRDs the cluster serves; iptables first since custom VPCs use it. */
function useNatEngines(): NatEngine[] {
  const discovery = useDiscovery()
  if (!discovery.loaded) return ["iptables", "ovn"]
  const engines: NatEngine[] = []
  if (discovery.hasResource("kubeovn.io/v1", "iptables-eips")) engines.push("iptables")
  if (discovery.hasResource("kubeovn.io/v1", "ovn-eips")) engines.push("ovn")
  return engines
}

function EngineSwitch({ engines, value, onChange }: { engines: NatEngine[]; value: NatEngine; onChange: (engine: NatEngine) => void }) {
  if (engines.length < 2) return null
  return (
    <div className="flex rounded-md border bg-card p-0.5" role="group" aria-label={t("NAT engine")}>
      {engines.map((engine) => (
        <button
          key={engine}
          type="button"
          aria-pressed={value === engine}
          onClick={() => onChange(engine)}
          className={cn("rounded px-3 py-1 text-sm transition-colors", value === engine ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:text-foreground")}
        >
          {t(natEngineLabel[engine])}
        </button>
      ))}
    </div>
  )
}

const loadRefs = async (): Promise<NatRefs> => {
  const [gateways, iptablesEips, ovnEips, vpcs, subnets, ips, qosPolicies] = await Promise.all(
    ["vpc-nat-gateways", "iptables-eips", "ovn-eips", "vpcs", "subnets", "ips", "qos-policies"].map((plural) => listItems(`${OVN_API}/${plural}`)),
  )
  return { gateways, iptablesEips, ovnEips, vpcs, subnets, ips, qosPolicies }
}

const emptyRefs: NatRefs = { gateways: [], iptablesEips: [], ovnEips: [], vpcs: [], subnets: [], ips: [], qosPolicies: [] }

function CreateNatDialog({ kind, open, onOpenChange, onCreated }: { kind: NatKind; open: boolean; onOpenChange: (open: boolean) => void; onCreated: () => void }) {
  const [name, setName] = useState("")
  const [values, setValues] = useState<Record<string, string>>(kind.defaults || {})
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  // References for suggestions are only fetched while the dialog is open.
  const { data: refs } = useAsync(() => (open ? loadRefs() : Promise.resolve(emptyRefs)), emptyRefs, [open])

  const set = (field: string, value: string) => setValues((current) => ({ ...current, [field]: value }))
  const manifest = natManifest(kind, name || "<name>", values)

  const submit = async () => {
    setError("")
    if (!isDnsLabel(name)) return setError(t("Name must be a lowercase DNS label"))
    const missing = kind.fields.find((field) => field.required && !values[field.name]?.trim())
    if (missing) return setError(t("{field} is required", { field: t(missing.label) }))
    const trimmed = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.trim()]))
    const invalid = kind.validate?.(trimmed)
    if (invalid) return setError(invalid)
    setSaving(true)
    try {
      await requestJson(`${OVN_API}/${kind.plural}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(natManifest(kind, name, trimmed)),
      })
      onOpenChange(false)
      setName("")
      setValues(kind.defaults || {})
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Create failed"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("Create {noun}", { noun: t(kind.label) })}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <FieldRow label={t("Name")}>
            <Input value={name} onChange={(e) => setName(e.target.value.trim())} placeholder={`${kind.plural.split("-")[0]}-1`} className="font-mono" />
          </FieldRow>
          {kind.fields.map((field) => (
            <FieldRow key={field.name} label={field.required ? field.label : t("{field} (optional)", { field: t(field.label) })} hint={t(field.hint)}>
              {field.choices ? (
                <div className="grid gap-2 sm:grid-cols-3">
                  {field.choices.map((choice) => (
                    <ChoiceCard key={choice.value} selected={values[field.name] === choice.value} onClick={() => set(field.name, choice.value)} title={choice.value} description={t(choice.hint)} />
                  ))}
                </div>
              ) : field.suggest ? (
                <Combobox
                  value={values[field.name] || ""}
                  onChange={(value) => set(field.name, value)}
                  options={field.suggest(refs, values)}
                  placeholder={field.placeholder}
                  aria-label={t(field.label)}
                  className={cn("w-full", field.mono && "font-mono")}
                />
              ) : (
                <Input value={values[field.name] || ""} onChange={(e) => set(field.name, e.target.value)} placeholder={field.placeholder} className={cn(field.mono && "font-mono")} />
              )}
            </FieldRow>
          ))}
          <details className="rounded-md border bg-muted/30">
            <summary className="cursor-pointer px-3 py-2 text-sm text-muted-foreground">{t("Manifest")}</summary>
            <pre className="overflow-x-auto border-t px-3 py-2 font-mono text-xs">{YAML.dump(manifest)}</pre>
          </details>
          {error && <ErrorNote>{error}</ErrorNote>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>{t("Cancel")}</Button>
          <Button onClick={submit} disabled={saving}>{saving ? t("Creating...") : t("Create")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** List, filter, create and delete one NAT kind. */
function NatTable({ kind }: { kind: NatKind }) {
  const [search, setSearch] = useState("")
  const [createOpen, setCreateOpen] = useState(false)
  const [deleting, setDeleting] = useState<KubeObject | null>(null)
  const { data, loading, error, reload } = useAsync(async () => {
    const res = await requestJson(`${OVN_API}/${kind.plural}`, { method: "GET" })
    return ((asRecord(res).items as KubeObject[] | undefined) || []).sort((a, b) => a.metadata.name.localeCompare(b.metadata.name))
  }, [] as KubeObject[], [kind.plural])

  const fields = useMemo<FilterField<KubeObject>[]>(() => [
    { key: "name", label: t("Name"), value: (item) => item.metadata.name },
    ...(kind.hasReady ? [{ key: "status", label: t("Status"), value: natReady }] : []),
    ...kind.columns.map((column) => ({ key: column.key, label: column.header, value: column.value })),
  ], [kind])
  const rows = useFilteredRows(data, fields, search)

  const columns: Column<KubeObject>[] = [
    {
      header: t("Name"),
      cell: (item) => <Link to={`${kind.catalogPath}/_cluster/${item.metadata.name}`} className="font-medium hover:text-primary transition-colors">{item.metadata.name}</Link>,
    },
    ...(kind.hasReady ? [{ header: t("Status"), cell: (item: KubeObject) => <StatusDot status={natReady(item)} label={natReady(item) === "NotReady" ? t("Not ready") : undefined} /> }] : []),
    ...kind.columns.map((column): Column<KubeObject> => ({
      header: t(column.header),
      cell: (item) => {
        const value = column.value(item)
        return value ? <span className={cn("text-sm", column.mono && "font-mono text-xs")}>{value}</span> : <span className="text-sm text-muted-foreground">-</span>
      },
    })),
    { header: t("Created"), className: "text-right", cell: (item) => <span className="text-sm text-muted-foreground tabular-nums" title={item.metadata.creationTimestamp}>{relativeTime(item.metadata.creationTimestamp)}</span> },
    {
      header: "",
      className: "w-12 text-right",
      cell: (item) => <Button size="icon" variant="ghost" aria-label={t("Delete {v0}", { v0: item.metadata.name })} onClick={() => setDeleting(item)}><Trash2 className="size-4 text-muted-foreground" /></Button>,
    },
  ]

  return (
    <div className="space-y-3">
      <Toolbar right={<FilterInput value={search} onChange={setSearch} fields={fields} rows={data} />}>
        <Button size="sm" variant="outline" onClick={reload} className="gap-2"><RefreshCw className={cn("size-4", loading && "animate-spin")} />{t("Refresh")}</Button>
        <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5"><Plus className="size-4" />{t("Create {noun}", { noun: t(kind.label) })}</Button>
      </Toolbar>
      {error && <ErrorNote>{error}</ErrorNote>}
      <DataTable
        loading={loading && data.length === 0}
        rows={rows}
        rowKey={(item) => item.metadata.name}
        minWidth={900}
        empty={<EmptyState title={data.length ? t("No matching {noun}s", { noun: t(kind.label) }) : t("No {noun}s", { noun: t(kind.label) })} />}
        columns={columns}
      />
      <CreateNatDialog key={kind.plural} kind={kind} open={createOpen} onOpenChange={setCreateOpen} onCreated={reload} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t("Delete {noun} {name}?", { noun: t(kind.label), name: deleting?.metadata.name })}
        description={kind.plural.endsWith("eips") ? t("Delete the NAT rules that use this address first. This cannot be undone.") : t("This cannot be undone.")}
        destructive
        confirmLabel={t("Delete")}
        onConfirm={async () => {
          await requestJson(`${OVN_API}/${kind.plural}/${deleting?.metadata.name}`, { method: "DELETE" })
          reload()
        }}
      />
    </div>
  )
}

function KubeOvnRequired({ title }: { title: string }) {
  return (
    <div className="space-y-4">
      <PageHeader title={title} />
      <div className="rounded-lg border bg-card">
        <EmptyState icon={Waypoints} title={t("NAT needs Kube-OVN")} action={<Button asChild size="sm" variant="outline"><Link to="/settings">{t("Settings")}</Link></Button>} />
      </div>
    </div>
  )
}

/** Engine from ?engine=, falling back to the first served one. */
function useEngine(engines: NatEngine[]) {
  const [params, setParams] = useSearchParams()
  const requested = params.get("engine") as NatEngine | null
  const engine = requested && engines.includes(requested) ? requested : engines[0]
  const setEngine = (next: NatEngine) => {
    const updated = new URLSearchParams(params)
    if (next === engines[0]) updated.delete("engine")
    else updated.set("engine", next)
    updated.delete("tab")
    setParams(updated, { replace: true })
  }
  return { engine, setEngine, params, setParams }
}

export function ElasticIpPage() {
  const profile = useNetworkProfile()
  const engines = useNatEngines()
  const { engine, setEngine } = useEngine(engines)
  if ((profile.loaded && !profile.vpc) || !engine) return <KubeOvnRequired title={t("Elastic IPs")} />
  const kind = natKinds[engine].eips!
  return (
    <div className="space-y-4">
      <PageHeader
        title={t("Elastic IPs")}
        subtitle={<span className="font-mono text-xs">{kind.kind} · kubeovn.io/v1</span>}
        actions={<EngineSwitch engines={engines} value={engine} onChange={setEngine} />}
      />
      <NatTable key={kind.plural} kind={kind} />
    </div>
  )
}

export function NatGatewayPage() {
  const profile = useNetworkProfile()
  const engines = useNatEngines()
  const { engine, setEngine, params, setParams } = useEngine(engines)
  if ((profile.loaded && !profile.vpc) || !engine) return <KubeOvnRequired title={t("NAT Gateways")} />
  const tabs: NatTab[] = (Object.keys(natKinds[engine]) as NatTab[]).filter((tab) => tab !== "eips")
  const requestedTab = params.get("tab") as NatTab | null
  const tab = requestedTab && tabs.includes(requestedTab) ? requestedTab : tabs[0]
  const kind = natKinds[engine][tab]!
  const setTab = (next: NatTab) => {
    const updated = new URLSearchParams(params)
    if (next === tabs[0]) updated.delete("tab")
    else updated.set("tab", next)
    setParams(updated, { replace: true })
  }
  return (
    <div className="space-y-4">
      <PageHeader
        title={t("NAT Gateways")}
        subtitle={<span className="font-mono text-xs">{kind.kind} · kubeovn.io/v1</span>}
        actions={
          <>
            <Button asChild size="sm" variant="outline" className="gap-1.5"><Link to={engine === engines[0] ? "/vpc/elastic-ips" : `/vpc/elastic-ips?engine=${engine}`}><Globe className="size-4" />{t("Elastic IPs")}</Link></Button>
            <EngineSwitch engines={engines} value={engine} onChange={setEngine} />
          </>
        }
      />
      <TabBar<NatTab> tabs={tabs.map((id) => ({ id, label: t(tabLabels[id]) }))} value={tab} onChange={setTab} />
      <NatTable key={kind.plural} kind={kind} />
    </div>
  )
}
