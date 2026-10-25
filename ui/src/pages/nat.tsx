import { useMemo, useState } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom"
import * as YAML from "js-yaml"
import { Plus, RefreshCw, Trash2, Waypoints } from "lucide-react"

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
  KeyValueGrid,
  LoadingState,
  PageHeader,
  Panel,
  StatusDot,
  TabBar,
  Toolbar,
  type Column,
} from "@/components/console"
import { apiFetch, asRecord, listItems, relativeTime, requestJson, str, useAsync, useDiscovery, useNetworkProfile, type KubeObject } from "@/lib/kube"
import { ManifestPanel } from "@/components/manifest"
import { useFilteredRows, type FilterField } from "@/lib/filter"
import { isDnsLabel } from "@/lib/validate"
import { OVN_API, natEngineLabel, natKinds, natManifest, natReady, type NatEngine, type NatKind, type NatRefs, type NatTab } from "@/lib/nat"
import { resourceLabel, t } from "@/lib/i18n"

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

/** Narrows suggestions and presets fields, e.g. to one NAT gateway on its detail page. */
type NatScope = { defaults?: Record<string, string>; refs?: (refs: NatRefs) => NatRefs }

function CreateNatDialog({ kind, scope, open, onOpenChange, onCreated }: { kind: NatKind; scope?: NatScope; open: boolean; onOpenChange: (open: boolean) => void; onCreated: () => void }) {
  const initial = { ...kind.defaults, ...scope?.defaults }
  const [name, setName] = useState("")
  const [values, setValues] = useState<Record<string, string>>(initial)
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  // References for suggestions are only fetched while the dialog is open.
  const { data: loaded } = useAsync(() => (open ? loadRefs() : Promise.resolve(emptyRefs)), emptyRefs, [open])
  const refs = scope?.refs ? scope.refs(loaded) : loaded

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
      setValues(initial)
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

/** Detail route of a NAT object: NAT gateways have their own page, the rest use the Resource Catalog. */
const natDetailPath = (kind: NatKind, name: string) => (kind.plural === "vpc-nat-gateways" ? `/vpc/nat-gateways/${name}` : `${kind.catalogPath}/_cluster/${name}`)

/** List, filter, create and delete one NAT kind; `only` limits it to the objects of one gateway. */
function NatTable({ kind, only, scope, onChanged }: { kind: NatKind; only?: (item: KubeObject) => boolean; scope?: NatScope; onChanged?: () => void }) {
  const [search, setSearch] = useState("")
  const [createOpen, setCreateOpen] = useState(false)
  const [deleting, setDeleting] = useState<KubeObject | null>(null)
  const { data, loading, error, reload } = useAsync(async () => {
    const res = await requestJson(`${OVN_API}/${kind.plural}`, { method: "GET" })
    return ((asRecord(res).items as KubeObject[] | undefined) || []).sort((a, b) => a.metadata.name.localeCompare(b.metadata.name))
  }, [] as KubeObject[], [kind.plural])
  const items = useMemo(() => (only ? data.filter(only) : data), [data, only])
  const changed = () => {
    reload()
    onChanged?.()
  }

  const fields = useMemo<FilterField<KubeObject>[]>(() => [
    { key: "name", label: t("Name"), value: (item) => item.metadata.name },
    ...(kind.hasReady ? [{ key: "status", label: t("Status"), value: natReady }] : []),
    ...kind.columns.map((column) => ({ key: column.key, label: column.header, value: column.value })),
  ], [kind])
  const rows = useFilteredRows(items, fields, search)

  const columns: Column<KubeObject>[] = [
    {
      header: t("Name"),
      cell: (item) => <Link to={natDetailPath(kind, item.metadata.name)} className="font-medium hover:text-primary transition-colors">{item.metadata.name}</Link>,
    },
    ...(kind.hasReady ? [{ header: t("Status"), cell: (item: KubeObject) => <StatusDot status={natReady(item)} label={natReady(item) === "NotReady" ? t("Not ready") : undefined} /> }] : []),
    ...kind.columns.map((column): Column<KubeObject> => ({
      header: t(column.header),
      cell: (item) => {
        const value = column.value(item)
        if (!value) return <span className="text-sm text-muted-foreground">-</span>
        const text = <span className={cn("text-sm", column.mono && "font-mono text-xs")}>{value}</span>
        return column.link ? <Link to={column.link(value)} className="hover:text-primary transition-colors">{text}</Link> : text
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
      <Toolbar right={<FilterInput value={search} onChange={setSearch} fields={fields} rows={items} />}>
        <Button size="sm" variant="outline" onClick={reload} className="gap-2"><RefreshCw className={cn("size-4", loading && "animate-spin")} />{t("Refresh")}</Button>
        <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5"><Plus className="size-4" />{t("Create {noun}", { noun: t(kind.label) })}</Button>
      </Toolbar>
      {error && <ErrorNote>{error}</ErrorNote>}
      <DataTable
        loading={loading && data.length === 0}
        rows={rows}
        rowKey={(item) => item.metadata.name}
        minWidth={900}
        empty={<EmptyState title={items.length ? t("No matching {noun}s", { noun: t(kind.label) }) : t("No {noun}s", { noun: t(kind.label) })} />}
        columns={columns}
      />
      <CreateNatDialog key={kind.plural} kind={kind} scope={scope} open={createOpen} onOpenChange={setCreateOpen} onCreated={changed} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t("Delete {noun} {name}?", { noun: t(kind.label), name: deleting?.metadata.name })}
        description={kind.plural.endsWith("eips") ? t("Delete the NAT rules that use this address first. This cannot be undone.") : t("This cannot be undone.")}
        destructive
        confirmLabel={t("Delete")}
        onConfirm={async () => {
          await requestJson(`${OVN_API}/${kind.plural}/${deleting?.metadata.name}`, { method: "DELETE" })
          changed()
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

/** Shared layout of the NAT pages: header with the kind and, when both are served, the engine switch. */
function NatKindPage({ title, tab, engines: allowed }: { title: string; tab: NatTab; engines?: NatEngine[] }) {
  const profile = useNetworkProfile()
  const served = useNatEngines()
  const engines = served.filter((engine) => natKinds[engine][tab] && (!allowed || allowed.includes(engine)))
  const { engine, setEngine } = useEngine(engines)
  if ((profile.loaded && !profile.vpc) || !engine) return <KubeOvnRequired title={title} />
  const kind = natKinds[engine][tab]!
  return (
    <div className="space-y-4">
      <PageHeader
        title={title}
        subtitle={<span className="font-mono text-xs">{kind.kind} · kubeovn.io/v1</span>}
        actions={<EngineSwitch engines={engines} value={engine} onChange={setEngine} />}
      />
      <NatTable key={kind.plural} kind={kind} />
    </div>
  )
}

export const ElasticIpPage = () => <NatKindPage title={resourceLabel("Elastic IPs")} tab="eips" />
export const NatGatewayPage = () => <NatKindPage title={resourceLabel("NAT Gateways")} tab="gateways" engines={["iptables"]} />
export const SnatRulePage = () => <NatKindPage title={resourceLabel("SNAT Rules")} tab="snat" />
export const DnatRulePage = () => <NatKindPage title={resourceLabel("DNAT Rules")} tab="dnat" />
export const FloatingIpPage = () => <NatKindPage title={resourceLabel("Floating IPs")} tab="fip" />

type GatewayTab = "eips" | "snat" | "dnat" | "fip" | "manifest"

const gatewayTabLabels: Record<GatewayTab, string> = {
  eips: "Elastic IPs",
  snat: "SNAT rules",
  dnat: "DNAT rules",
  fip: "Floating IPs",
  manifest: "Manifest",
}

/**
 * One VPC NAT gateway with the objects that hang off it: its elastic IPs (spec.natGwDp) and the
 * SNAT, DNAT and floating IP rules on those addresses.
 */
export function NatGatewayDetailPage() {
  const { name = "" } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const kinds = natKinds.iptables
  const { data, loading, reload } = useAsync(async () => {
    const [res, eips, snat, dnat, fip] = await Promise.all([
      apiFetch(`${OVN_API}/vpc-nat-gateways/${name}`),
      ...(["iptables-eips", "iptables-snat-rules", "iptables-dnat-rules", "iptables-fip-rules"].map((plural) => listItems(`${OVN_API}/${plural}`).catch(() => [] as KubeObject[]))),
    ])
    const gateway = res.ok ? await res.json() as KubeObject : null
    return { gateway, eips, snat, dnat, fip }
  }, { gateway: null as KubeObject | null, eips: [] as KubeObject[], snat: [] as KubeObject[], dnat: [] as KubeObject[], fip: [] as KubeObject[] }, [name])

  const eipNames = useMemo(() => new Set(data.eips.filter((eip) => str(asRecord(eip.spec).natGwDp) === name).map((eip) => eip.metadata.name)), [data.eips, name])
  const onGateway = useMemo(() => ({
    eips: (item: KubeObject) => str(asRecord(item.spec).natGwDp) === name,
    rule: (item: KubeObject) => eipNames.has(str(asRecord(item.spec).eip)) || str(asRecord(item.status).natGwDp) === name,
  }), [eipNames, name])
  // New EIPs land on this gateway; new rules can only pick its EIPs.
  const scopes = useMemo<Record<"eips" | "rule", NatScope>>(() => ({
    eips: { defaults: { natGwDp: name }, refs: (refs) => ({ ...refs, gateways: refs.gateways.filter((gw) => gw.metadata.name === name) }) },
    rule: { refs: (refs) => ({ ...refs, iptablesEips: refs.iptablesEips.filter((eip) => str(asRecord(eip.spec).natGwDp) === name) }) },
  }), [name])

  if (loading && !data.gateway) return <LoadingState />
  if (!data.gateway) return <EmptyState icon={Waypoints} title={t("NAT gateway not found")} action={<Button asChild variant="outline" size="sm"><Link to="/vpc/nat-gateways">{t("Back")}</Link></Button>} />

  const gateway = data.gateway
  const spec = asRecord(gateway.spec)
  const counts: Record<GatewayTab, number | null> = {
    eips: data.eips.filter(onGateway.eips).length,
    snat: data.snat.filter(onGateway.rule).length,
    dnat: data.dnat.filter(onGateway.rule).length,
    fip: data.fip.filter(onGateway.rule).length,
    manifest: null,
  }
  const tabs = Object.keys(gatewayTabLabels) as GatewayTab[]
  const requested = params.get("tab") as GatewayTab | null
  const tab = requested && tabs.includes(requested) ? requested : "eips"
  const setTab = (next: GatewayTab) => setParams(next === "eips" ? {} : { tab: next }, { replace: true })

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: resourceLabel("NAT Gateways"), to: "/vpc/nat-gateways" }, { label: name }]}
        title={name}
        subtitle={<span className="font-mono text-xs">VpcNatGateway · kubeovn.io/v1</span>}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={reload} className="gap-2"><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />{t("Refresh")}</Button>
            <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>{t("Delete")}</Button>
          </>
        }
      />
      <Panel title={t("Basic information")}>
        <KeyValueGrid items={[
          { label: t("VPC"), value: <Link to={`/vpc/vpcs/${str(spec.vpc)}`} className="hover:text-primary transition-colors">{str(spec.vpc, "-")}</Link> },
          { label: t("Subnet"), value: <Link to={`/vpc/subnets/${str(spec.subnet)}`} className="hover:text-primary transition-colors">{str(spec.subnet, "-")}</Link> },
          { label: t("LAN IP"), value: <span className="font-mono">{str(spec.lanIp, "-")}</span> },
          { label: t("External subnets"), value: ((spec.externalSubnets as string[] | undefined) || []).join(", ") || t("Default") },
          { label: t("QoS policy"), value: str(spec.qosPolicy, "-") },
          { label: t("Created"), value: <span title={gateway.metadata.creationTimestamp}>{relativeTime(gateway.metadata.creationTimestamp)}</span> },
        ]} />
      </Panel>
      <TabBar<GatewayTab> tabs={tabs.map((id) => ({ id, label: counts[id] === null ? t(gatewayTabLabels[id]) : `${t(gatewayTabLabels[id])} (${counts[id]})` }))} value={tab} onChange={setTab} />
      {tab === "eips" && <NatTable key="eips" kind={kinds.eips!} only={onGateway.eips} scope={scopes.eips} onChanged={reload} />}
      {tab === "snat" && <NatTable key="snat" kind={kinds.snat!} only={onGateway.rule} scope={scopes.rule} onChanged={reload} />}
      {tab === "dnat" && <NatTable key="dnat" kind={kinds.dnat!} only={onGateway.rule} scope={scopes.rule} onChanged={reload} />}
      {tab === "fip" && <NatTable key="fip" kind={kinds.fip!} only={onGateway.rule} scope={scopes.rule} onChanged={reload} />}
      {tab === "manifest" && <ManifestPanel object={gateway} url={`${OVN_API}/vpc-nat-gateways/${name}`} onSaved={reload} />}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("Delete NAT gateway {name}?", { name })}
        description={t("Its elastic IPs and NAT rules stop working. This cannot be undone.")}
        destructive
        confirmLabel={t("Delete")}
        onConfirm={async () => {
          await requestJson(`${OVN_API}/vpc-nat-gateways/${name}`, { method: "DELETE" })
          navigate("/vpc/nat-gateways")
        }}
      />
    </div>
  )
}
