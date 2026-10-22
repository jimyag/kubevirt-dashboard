import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { Network, Plus, RefreshCw, Split, Trash2 } from "lucide-react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Combobox,
  ConfirmDialog,
  DataTable,
  FilterInput,
  EmptyState,
  FieldRow,
  KeyValueGrid,
  LoadingState,
  NativeSelect,
  PageHeader,
  StatusDot,
  Toolbar,
  UsageBar,
  Panel,
} from "@/components/console"
import { useFilteredRows, type FilterField } from "@/lib/filter"
import {
  apiFetch,
  asList,
  asRecord,
  kubeOvnAnnotations,
  listItems,
  relativeTime,
  requestJson,
  str,
  subnetUsage,
  useAsync,
  useNetworkProfile,
  type KubeObject,
} from "@/lib/kube"
import { cidrContains, cidrsOverlap, ipv4Cidr, isDnsLabel, parseIPv4Cidr } from "@/lib/validate"
import { t } from "@/lib/i18n"
import { PeeringPanel, RouteTablePanel } from "@/components/vpc-routing"
import { SubnetIpPools } from "@/components/ip-pools"

const OVN = "/apis/kubeovn.io/v1"
const VM_API = "/apis/kubevirt.io/v1"

const jsonBody = (method: string, body: unknown, contentType = "application/json"): RequestInit => ({
  method,
  headers: { "Content-Type": contentType },
  body: JSON.stringify(body),
})

const subnetReady = (subnet: KubeObject) => {
  const conditions = asList(asRecord(subnet.status).conditions)
  const ready = conditions.find((condition) => condition.type === "Ready")
  if (!ready) return "Pending"
  return ready.status === "True" ? "Available" : "NotReady"
}

const vmSubnet = (vm: KubeObject) =>
  asRecord(asRecord(asRecord(vm.spec).template).metadata).annotations
    ? str(asRecord(asRecord(asRecord(asRecord(vm.spec).template).metadata).annotations)[kubeOvnAnnotations.logicalSwitch])
    : ""

export function KubeOvnMissing() {
  const profile = useNetworkProfile()
  return (
    <div className="rounded-lg border bg-card">
        <EmptyState
          icon={Network}
          title={t("VPC networking is not enabled")}
          description={profile.kubeOvnInstalled ? t("VPC networking is turned off in Settings.") : t("Requires Kube-OVN.")}
          action={<Button asChild variant="outline" size="sm"><Link to="/settings">{t("Open settings")}</Link></Button>}
        />
    </div>
  )
}

// --- Create dialogs ---

export function CreateSubnetDialog({
  open,
  onOpenChange,
  vpcs,
  defaultVpc,
  existingSubnets = [],
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  vpcs: string[]
  defaultVpc?: string
  /** Used to reject CIDRs that overlap another subnet of the same VPC, which Kube-OVN refuses. */
  existingSubnets?: KubeObject[]
  onCreated: () => void
}) {
  const [values, setValues] = useState({ name: "", vpc: defaultVpc || "ovn-cluster", cidrBlock: "10.100.0.0/24", gateway: "", namespaces: "", excludeIps: "", natOutgoing: true, isPrivate: false })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const set = (patch: Partial<typeof values>) => setValues((current) => ({ ...current, ...patch }))
  useEffect(() => {
    if (open) setValues((current) => ({ ...current, vpc: defaultVpc || current.vpc || "ovn-cluster" }))
  }, [defaultVpc, open])
  // natOutgoing only applies to subnets of the default VPC; custom VPCs egress through NAT gateways.
  const defaultVpcSelected = values.vpc === "ovn-cluster"
  const validate = () => {
    const v4 = ipv4Cidr(values.cidrBlock)
    if (!isDnsLabel(values.name.trim())) return t("Name must be at most 63 lowercase letters, digits and dashes.")
    if (values.cidrBlock.split(",").some((part) => part.includes(".") && !parseIPv4Cidr(part))) return t("Invalid IPv4 CIDR: {v0}", { v0: values.cidrBlock })
    if (v4 && values.gateway.trim() && !cidrContains(v4, values.gateway)) return t("Gateway {gateway} is not inside {cidr}.", { gateway: values.gateway.trim(), cidr: v4 })
    const clash = existingSubnets.find((subnet) => str(asRecord(subnet.spec).vpc, "ovn-cluster") === values.vpc && v4 && cidrsOverlap(v4, ipv4Cidr(str(asRecord(subnet.spec).cidrBlock))))
    if (clash) return t("{cidr} overlaps subnet {subnet} ({subnetCidr}) in VPC {vpc}.", { cidr: v4, subnet: clash.metadata.name, subnetCidr: str(asRecord(clash.spec).cidrBlock), vpc: values.vpc })
    return ""
  }
  const submit = async () => {
    const problem = validate()
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    setError("")
    try {
      const spec: Record<string, unknown> = {
        vpc: values.vpc,
        cidrBlock: values.cidrBlock.split(",").map((part) => part.trim()).filter(Boolean).join(","),
        protocol: values.cidrBlock.includes(":") ? (values.cidrBlock.includes(".") ? "Dual" : "IPv6") : "IPv4",
        private: values.isPrivate,
        ...(defaultVpcSelected ? { natOutgoing: values.natOutgoing } : {}),
      }
      if (values.gateway.trim()) spec.gateway = values.gateway.trim()
      const namespaces = values.namespaces.split(",").map((item) => item.trim()).filter(Boolean)
      if (namespaces.length) spec.namespaces = namespaces
      const excludeIps = values.excludeIps.split(",").map((item) => item.trim()).filter(Boolean)
      if (excludeIps.length) spec.excludeIps = excludeIps
      await requestJson(`${OVN}/subnets`, jsonBody("POST", { apiVersion: "kubeovn.io/v1", kind: "Subnet", metadata: { name: values.name.trim() }, spec }))
      onOpenChange(false)
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Failed to create subnet"))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("Create subnet")}</DialogTitle>
          <DialogDescription>{t("Instances placed in this subnet get an address from its CIDR.")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldRow label={t("Name")}><Input value={values.name} onChange={(e) => set({ name: e.target.value })} placeholder="subnet-web" /></FieldRow>
          <FieldRow label={t("VPC")}>
            <NativeSelect value={values.vpc} onChange={(e) => set({ vpc: e.target.value })}>
              {Array.from(new Set([values.vpc, ...vpcs])).map((vpc) => <option key={vpc} value={vpc}>{vpc}</option>)}
            </NativeSelect>
          </FieldRow>
          <FieldRow label={t("IPv4 CIDR")} hint={t("Use a comma to add an IPv6 CIDR for dual stack.")}><Input value={values.cidrBlock} onChange={(e) => set({ cidrBlock: e.target.value })} /></FieldRow>
          <FieldRow label={t("Gateway")} hint={t("Defaults to the first address.")}><Input value={values.gateway} onChange={(e) => set({ gateway: e.target.value })} placeholder="auto" /></FieldRow>
          <FieldRow label={t("Bound namespaces")} hint={t("Pods in these namespaces default to this subnet.")}><Input value={values.namespaces} onChange={(e) => set({ namespaces: e.target.value })} placeholder={t("ns-a, ns-b")} /></FieldRow>
          <FieldRow label={t("Excluded IPs")} hint={t("Never allocated, e.g. addresses used outside the cluster.")}><Input value={values.excludeIps} onChange={(e) => set({ excludeIps: e.target.value })} placeholder="10.100.0.1..10.100.0.10" /></FieldRow>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {defaultVpcSelected ? (
            <label className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div>
                <div className="text-sm font-medium">{t("NAT outgoing")}</div>
                <div className="text-xs text-muted-foreground">{t("SNAT traffic leaving the cluster")}</div>
              </div>
              <Switch checked={values.natOutgoing} onCheckedChange={(checked) => set({ natOutgoing: checked })} />
            </label>
          ) : (
            <div className="rounded-lg border p-3 text-xs text-muted-foreground">{t("Custom VPCs reach outside networks through a NAT gateway, not subnet NAT.")}</div>
          )}
          <label className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div>
              <div className="text-sm font-medium">{t("Private")}</div>
              <div className="text-xs text-muted-foreground">{t("Deny traffic from other subnets")}</div>
            </div>
            <Switch checked={values.isPrivate} onCheckedChange={(checked) => set({ isPrivate: checked })} />
          </label>
        </div>
        {error && <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm break-all">{error}</div>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("Cancel")}</Button>
          <Button onClick={submit} disabled={busy || !values.name.trim() || !values.cidrBlock.trim()}>{busy ? t("Creating...") : t("Create subnet")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CreateVpcDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (name: string) => void }) {
  const [values, setValues] = useState({ name: "", namespaces: "", withSubnet: true, subnetName: "", cidrBlock: "192.168.0.0/24" })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  // Set once the VPC exists, so a retry after a failed subnet does not try to create the VPC again.
  const [createdVpc, setCreatedVpc] = useState("")
  const set = (patch: Partial<typeof values>) => setValues((current) => ({ ...current, ...patch }))
  const submit = async () => {
    const name = values.name.trim()
    const subnetName = values.subnetName.trim() || `${name}-default`
    if (!isDnsLabel(name)) return setError(t("Name must be at most 63 lowercase letters, digits and dashes."))
    if (values.withSubnet && !isDnsLabel(subnetName)) return setError(t("Subnet name must be at most 63 lowercase letters, digits and dashes."))
    if (values.withSubnet && !parseIPv4Cidr(values.cidrBlock)) return setError(t("Invalid IPv4 CIDR: {v0}", { v0: values.cidrBlock }))
    setBusy(true)
    setError("")
    try {
      const namespaces = values.namespaces.split(",").map((item) => item.trim()).filter(Boolean)
      if (createdVpc !== name) {
        await requestJson(`${OVN}/vpcs`, jsonBody("POST", { apiVersion: "kubeovn.io/v1", kind: "Vpc", metadata: { name }, spec: namespaces.length ? { namespaces } : {} }))
        setCreatedVpc(name)
      }
      if (values.withSubnet) {
        // No subnet namespace binding: that would move every pod of those namespaces onto this subnet.
        try {
          await requestJson(`${OVN}/subnets`, jsonBody("POST", {
            apiVersion: "kubeovn.io/v1",
            kind: "Subnet",
            metadata: { name: subnetName },
            spec: { vpc: name, cidrBlock: values.cidrBlock.trim(), protocol: "IPv4" },
          }))
        } catch (err) {
          throw new Error(t("VPC {vpc} was created, but subnet {subnet} failed: {error}", { vpc: name, subnet: subnetName, error: err instanceof Error ? err.message : String(err) }))
        }
      }
      onOpenChange(false)
      onCreated(name)
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Failed to create VPC"))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("Create VPC")}</DialogTitle>
          <DialogDescription>{t("An isolated virtual network with its own router. Subnets in different VPCs can reuse address ranges.")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <FieldRow label={t("Name")}><Input value={values.name} onChange={(e) => set({ name: e.target.value })} placeholder="vpc-prod" /></FieldRow>
          <FieldRow label={t("Namespaces")} hint={t("Namespaces allowed to use this VPC. Leave empty to allow all.")}><Input value={values.namespaces} onChange={(e) => set({ namespaces: e.target.value })} placeholder={t("prod, prod-db")} /></FieldRow>
          <label className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div>
              <div className="text-sm font-medium">{t("Create a default subnet")}</div>
              <div className="text-xs text-muted-foreground">{t("Recommended: instances need a subnet to attach to.")}</div>
            </div>
            <Switch checked={values.withSubnet} onCheckedChange={(checked) => set({ withSubnet: checked })} />
          </label>
          {values.withSubnet && (
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldRow label={t("Subnet name")}><Input value={values.subnetName} onChange={(e) => set({ subnetName: e.target.value })} placeholder={values.name ? `${values.name}-default` : "default"} /></FieldRow>
              <FieldRow label={t("Subnet CIDR")}><Input value={values.cidrBlock} onChange={(e) => set({ cidrBlock: e.target.value })} /></FieldRow>
            </div>
          )}
        </div>
        {error && <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm break-all">{error}</div>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("Cancel")}</Button>
          <Button onClick={submit} disabled={busy || !values.name.trim()}>{busy ? t("Creating...") : t("Create VPC")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// --- VPC list ---

export function VpcListPage() {
  const profile = useNetworkProfile()
  const navigate = useNavigate()
  const [search, setSearch] = useState("")
  const [createOpen, setCreateOpen] = useState(false)
  const [deleting, setDeleting] = useState<KubeObject | null>(null)
  const { data, loading, reload } = useAsync(async () => {
    const [vpcs, subnets, natGateways] = await Promise.all([
      listItems(`${OVN}/vpcs`),
      listItems(`${OVN}/subnets`),
      listItems(`${OVN}/vpc-nat-gateways`),
    ])
    return { vpcs, subnets, natGateways }
  }, { vpcs: [] as KubeObject[], subnets: [] as KubeObject[], natGateways: [] as KubeObject[] }, [])

  const vpcFields = useMemo<FilterField<KubeObject>[]>(() => {
    const cidrs: Record<string, string[]> = {}
    for (const subnet of data.subnets) (cidrs[str(asRecord(subnet.spec).vpc, "ovn-cluster")] ||= []).push(str(asRecord(subnet.spec).cidrBlock))
    return [
      { key: "name", label: t("Name"), value: (vpc) => vpc.metadata.name },
      { key: "status", label: t("Status"), value: (vpc) => (asRecord(vpc.status).standby === true ? "Available" : "Pending") },
      { key: "cidr", label: t("CIDRs"), value: (vpc) => cidrs[vpc.metadata.name] },
      { key: "namespace", label: t("Namespaces"), aliases: ["ns"], value: (vpc) => asRecord(vpc.spec).namespaces as string[] | undefined },
    ]
  }, [data.subnets])
  const rows = useFilteredRows(data.vpcs, vpcFields, search)

  if (profile.loaded && !profile.vpc) return <div className="space-y-4"><PageHeader title={t("VPCs")} /><KubeOvnMissing /></div>

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("VPCs")}
        actions={<Button onClick={() => setCreateOpen(true)} className="gap-1.5"><Plus className="size-4" />{t("Create VPC")}</Button>}
      />
      <Toolbar
        right={<FilterInput value={search} onChange={setSearch} fields={vpcFields} rows={data.vpcs} placeholder={t("Filter, e.g. cidr:10.16")} />}
      >
        <Button size="sm" variant="outline" onClick={reload} className="gap-2"><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />{t("Refresh")}</Button>
        <span className="text-sm text-muted-foreground">{data.vpcs.length} {t("VPCs,")} {data.subnets.length} subnets</span>
      </Toolbar>
      <DataTable
        loading={loading}
        rows={rows}
        rowKey={(vpc) => vpc.metadata.name}
        empty={<EmptyState icon={Network} title={t("No VPCs")} description={t("Create a VPC to isolate tenant networks.")} action={<Button size="sm" onClick={() => setCreateOpen(true)}>{t("Create VPC")}</Button>} />}
        columns={[
          {
            header: t("Name"),
            cell: (vpc) => (
              <div className="flex items-center gap-2">
                <Link to={`/vpc/vpcs/${vpc.metadata.name}`} className="font-medium hover:text-primary transition-colors">{vpc.metadata.name}</Link>
                {asRecord(vpc.status).default === true && <Badge variant="outline">{t("Default")}</Badge>}
              </div>
            ),
          },
          { header: t("Status"), cell: (vpc) => <StatusDot status={asRecord(vpc.status).standby === true ? "Available" : "Pending"} /> },
          {
            header: t("Subnets"),
            cell: (vpc) => {
              const subnets = data.subnets.filter((subnet) => str(asRecord(subnet.spec).vpc, "ovn-cluster") === vpc.metadata.name)
              return <span className="text-sm tabular-nums">{subnets.length}</span>
            },
          },
          {
            header: t("CIDRs"),
            cell: (vpc) => {
              const cidrs = data.subnets.filter((subnet) => str(asRecord(subnet.spec).vpc, "ovn-cluster") === vpc.metadata.name).map((subnet) => str(asRecord(subnet.spec).cidrBlock))
              return <span className="font-mono text-xs text-muted-foreground">{cidrs.slice(0, 3).join(", ") || "N/A"}{cidrs.length > 3 ? ` +${cidrs.length - 3}` : ""}</span>
            },
          },
          { header: t("NAT Gateways"), cell: (vpc) => <span className="text-sm tabular-nums">{data.natGateways.filter((gw) => str(asRecord(gw.spec).vpc) === vpc.metadata.name).length}</span> },
          { header: t("Namespaces"), cell: (vpc) => <span className="text-sm text-muted-foreground">{(asRecord(vpc.spec).namespaces as string[] | undefined)?.join(", ") || t("All")}</span> },
          { header: t("Created"), className: "text-right", cell: (vpc) => <span className="text-sm text-muted-foreground tabular-nums">{relativeTime(vpc.metadata.creationTimestamp)}</span> },
          {
            header: "",
            className: "w-12 text-right",
            cell: (vpc) => asRecord(vpc.status).default === true ? null : (
              <Button size="icon" variant="ghost" aria-label={t("Delete {v0}", { v0: vpc.metadata.name })} onClick={() => setDeleting(vpc)}><Trash2 className="size-4 text-muted-foreground" /></Button>
            ),
          },
        ]}
      />
      <CreateVpcDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={(name) => navigate(`/vpc/vpcs/${name}`)} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t("Delete VPC {v0}?", { v0: deleting?.metadata.name })}
        description={t("Subnets in this VPC must be deleted first. This cannot be undone.")}
        destructive
        confirmLabel={t("Delete VPC")}
        onConfirm={async () => {
          await requestJson(`${OVN}/vpcs/${deleting?.metadata.name}`, { method: "DELETE" })
          reload()
        }}
      />
    </div>
  )
}

// --- VPC detail ---

export function VpcDetailPage() {
  const { name = "" } = useParams()
  const [subnetOpen, setSubnetOpen] = useState(false)
  const { data, loading, reload } = useAsync(async () => {
    const [vpcRes, allSubnets, natGateways, vms, vpcs] = await Promise.all([
      apiFetch(`${OVN}/vpcs/${name}`),
      listItems(`${OVN}/subnets`),
      listItems(`${OVN}/vpc-nat-gateways`),
      listItems(`${VM_API}/virtualmachines`),
      listItems(`${OVN}/vpcs`),
    ])
    const vpc = vpcRes.ok ? await vpcRes.json() as KubeObject : null
    return { vpc, allSubnets, vpcs, subnets: allSubnets.filter((subnet) => str(asRecord(subnet.spec).vpc, "ovn-cluster") === name), natGateways: natGateways.filter((gw) => str(asRecord(gw.spec).vpc) === name), vms }
  }, { vpc: null as KubeObject | null, allSubnets: [] as KubeObject[], vpcs: [] as KubeObject[], subnets: [] as KubeObject[], natGateways: [] as KubeObject[], vms: [] as KubeObject[] }, [name])

  if (loading && !data.vpc) return <LoadingState />
  if (!data.vpc) return <EmptyState icon={Network} title={t("VPC not found")} action={<Button asChild variant="outline" size="sm"><Link to="/vpc/vpcs">{t("Back to VPCs")}</Link></Button>} />

  const spec = asRecord(data.vpc.spec)
  const subnetNames = new Set(data.subnets.map((subnet) => subnet.metadata.name))
  const instances = data.vms.filter((vm) => subnetNames.has(vmSubnet(vm)))

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: t("VPCs"), to: "/vpc/vpcs" }, { label: name }]}
        title={name}
        badge={<StatusDot status={asRecord(data.vpc.status).standby === true ? "Available" : "Pending"} />}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={reload} className="gap-2"><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />{t("Refresh")}</Button>
            <Button size="sm" onClick={() => setSubnetOpen(true)} className="gap-1.5"><Plus className="size-4" />{t("Create subnet")}</Button>
          </>
        }
      />
      <Panel title={t("Basic information")}>
          <KeyValueGrid items={[
            { label: t("VPC name"), value: name },
            { label: t("Router"), value: str(asRecord(data.vpc.status).router, `vpc-${name}`) },
            { label: t("Namespaces"), value: (spec.namespaces as string[] | undefined)?.join(", ") || "All namespaces" },
            { label: t("External gateway"), value: spec.enableExternal ? "Enabled" : "Disabled" },
            { label: t("Subnets"), value: data.subnets.length },
            { label: t("Instances"), value: instances.length },
            { label: t("Created"), value: relativeTime(data.vpc.metadata.creationTimestamp) },
          ]} />
        </Panel>

      <div className="space-y-3">
        <h2 className="text-base font-semibold">{t("Subnets")}</h2>
        <SubnetTable subnets={data.subnets} loading={false} vms={data.vms} onCreate={() => setSubnetOpen(true)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t("NAT gateways")} bodyClassName="space-y-2">
            {data.natGateways.map((gw) => (
              <div key={gw.metadata.name} className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                <Link to={`/vpc/nat-gateways/${gw.metadata.name}`} className="font-medium hover:text-primary transition-colors">{gw.metadata.name}</Link>
                <span className="font-mono text-xs text-muted-foreground">{str(asRecord(gw.spec).subnet)} / {str(asRecord(gw.spec).lanIp, "auto")}</span>
              </div>
            ))}
            {data.natGateways.length === 0 && <p className="text-sm text-muted-foreground">{t("No NAT gateways.")} <Link to="/vpc/nat-gateways" className="text-primary hover:underline">{t("Create one")}</Link> {t("to give instances internet access or elastic IPs.")}</p>}
          </Panel>
        <PeeringPanel vpc={data.vpc} vpcs={data.vpcs} subnets={data.allSubnets} onSaved={reload} />
      </div>

      <RouteTablePanel vpc={data.vpc} onSaved={reload} />

      <div className="space-y-3">
        <h2 className="text-base font-semibold">{t("Instances in this VPC")}</h2>
        <DataTable
          rows={instances}
          rowKey={(vm) => `${vm.metadata.namespace}/${vm.metadata.name}`}
          minWidth={560}
          empty={<EmptyState title={t("No instances")} description={t("Instances attached to subnets of this VPC appear here.")} />}
          columns={[
            { header: t("Instance"), cell: (vm) => <Link to={`/kubevirt/virtualization/virtual-machines/${vm.metadata.namespace}/${vm.metadata.name}/overview`} className="font-medium hover:text-primary transition-colors">{vm.metadata.name}</Link> },
            { header: t("Namespace"), cell: (vm) => <span className="text-sm text-muted-foreground">{vm.metadata.namespace}</span> },
            { header: t("Subnet"), cell: (vm) => <span className="text-sm">{vmSubnet(vm)}</span> },
            { header: t("Status"), cell: (vm) => <StatusDot status={str(asRecord(vm.status).printableStatus)} /> },
          ]}
        />
      </div>

      <CreateSubnetDialog open={subnetOpen} onOpenChange={setSubnetOpen} vpcs={[name]} defaultVpc={name} existingSubnets={data.subnets} onCreated={reload} />
    </div>
  )
}

// --- Subnets ---

function SubnetTable({ subnets, loading, vms, onCreate, onDelete }: { subnets: KubeObject[]; loading: boolean; vms: KubeObject[]; onCreate?: () => void; onDelete?: (subnet: KubeObject) => void }) {
  return (
    <DataTable
      loading={loading}
      rows={subnets}
      rowKey={(subnet) => subnet.metadata.name}
      empty={<EmptyState icon={Split} title={t("No subnets")} description={t("Create a subnet to place instances in this network.")} action={onCreate && <Button size="sm" onClick={onCreate}>{t("Create subnet")}</Button>} />}
      columns={[
        { header: t("Name"), cell: (subnet) => <Link to={`/vpc/subnets/${subnet.metadata.name}`} className="font-medium hover:text-primary transition-colors">{subnet.metadata.name}</Link> },
        { header: t("Status"), cell: (subnet) => <StatusDot status={subnetReady(subnet)} /> },
        { header: t("VPC"), cell: (subnet) => <Link to={`/vpc/vpcs/${str(asRecord(subnet.spec).vpc, "ovn-cluster")}`} className="text-sm hover:text-primary transition-colors">{str(asRecord(subnet.spec).vpc, "ovn-cluster")}</Link> },
        { header: t("CIDR"), cell: (subnet) => <span className="font-mono text-xs">{str(asRecord(subnet.spec).cidrBlock)}</span> },
        { header: t("Gateway"), cell: (subnet) => <span className="font-mono text-xs text-muted-foreground">{str(asRecord(subnet.spec).gateway, "N/A")}</span> },
        {
          header: t("IP usage"),
          cell: (subnet) => {
            const usage = subnetUsage(subnet)
            return <UsageBar used={usage.used} total={usage.total} />
          },
        },
        { header: t("Instances"), cell: (subnet) => <span className="text-sm tabular-nums">{vms.filter((vm) => vmSubnet(vm) === subnet.metadata.name).length}</span> },
        { header: t("ACL rules"), cell: (subnet) => <span className="text-sm tabular-nums">{asList(asRecord(subnet.spec).acls).length}</span> },
        ...(onDelete ? [{
          header: "",
          className: "w-12 text-right",
          cell: (subnet: KubeObject) => ["ovn-default", "join"].includes(subnet.metadata.name) ? null : (
            <Button size="icon" variant="ghost" aria-label={t("Delete {v0}", { v0: subnet.metadata.name })} onClick={() => onDelete(subnet)}><Trash2 className="size-4 text-muted-foreground" /></Button>
          ),
        }] : []),
      ]}
    />
  )
}

const subnetFields: FilterField<KubeObject>[] = [
  { key: "name", label: "Name", value: (subnet) => subnet.metadata.name },
  { key: "status", label: "Status", value: (subnet) => subnetReady(subnet) },
  { key: "vpc", label: "VPC", value: (subnet) => str(asRecord(subnet.spec).vpc, "ovn-cluster") },
  { key: "cidr", label: "CIDR", value: (subnet) => str(asRecord(subnet.spec).cidrBlock) },
  { key: "gateway", label: "Gateway", aliases: ["gw"], value: (subnet) => str(asRecord(subnet.spec).gateway) },
  { key: "protocol", label: "Protocol", value: (subnet) => str(asRecord(subnet.spec).protocol) },
  { key: "namespace", label: "Bound namespaces", aliases: ["ns"], value: (subnet) => asRecord(subnet.spec).namespaces as string[] | undefined },
]

export function SubnetListPage() {
  const profile = useNetworkProfile()
  const [search, setSearch] = useState("")
  const [vpcFilter, setVpcFilter] = useState("")
  const [createOpen, setCreateOpen] = useState(false)
  const [deleting, setDeleting] = useState<KubeObject | null>(null)
  const { data, loading, reload } = useAsync(async () => {
    const [subnets, vpcs, vms] = await Promise.all([listItems(`${OVN}/subnets`), listItems(`${OVN}/vpcs`), listItems(`${VM_API}/virtualmachines`)])
    return { subnets, vpcs, vms }
  }, { subnets: [] as KubeObject[], vpcs: [] as KubeObject[], vms: [] as KubeObject[] }, [])

  const vpcNames = useMemo(() => data.vpcs.map((vpc) => vpc.metadata.name), [data.vpcs])
  const exactVpc = vpcNames.includes(vpcFilter.trim()) ? vpcFilter.trim() : ""
  const inVpc = useMemo(() => {
    const needle = vpcFilter.trim().toLowerCase()
    if (!needle) return data.subnets
    return data.subnets.filter((subnet) => {
      const vpc = str(asRecord(subnet.spec).vpc, "ovn-cluster")
      return exactVpc ? vpc === exactVpc : vpc.toLowerCase().includes(needle)
    })
  }, [data.subnets, vpcFilter, exactVpc])
  const rows = useFilteredRows(inVpc, subnetFields, search)

  if (profile.loaded && !profile.vpc) return <div className="space-y-4"><PageHeader title={t("Subnets")} /><KubeOvnMissing /></div>

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("Subnets")}
        actions={<Button onClick={() => setCreateOpen(true)} className="gap-1.5"><Plus className="size-4" />{t("Create subnet")}</Button>}
      />
      <Toolbar
        right={<FilterInput value={search} onChange={setSearch} fields={subnetFields} rows={inVpc} placeholder={t("Filter, e.g. cidr:10.16 ns:prod")} />}
      >
        <Button size="sm" variant="outline" onClick={reload} className="gap-2"><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />{t("Refresh")}</Button>
        <Combobox value={vpcFilter} onChange={setVpcFilter} options={vpcNames} placeholder={t("All VPCs")} aria-label={t("VPC")} />
      </Toolbar>
      <SubnetTable subnets={rows} loading={loading} vms={data.vms} onCreate={() => setCreateOpen(true)} onDelete={setDeleting} />
      <CreateSubnetDialog open={createOpen} onOpenChange={setCreateOpen} vpcs={vpcNames} defaultVpc={exactVpc || undefined} existingSubnets={data.subnets} onCreated={reload} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t("Delete subnet {v0}?", { v0: deleting?.metadata.name })}
        description={t("Instances still using this subnet lose connectivity. This cannot be undone.")}
        destructive
        confirmLabel={t("Delete subnet")}
        onConfirm={async () => {
          await requestJson(`${OVN}/subnets/${deleting?.metadata.name}`, { method: "DELETE" })
          reload()
        }}
      />
    </div>
  )
}

// --- Subnet detail with network ACL editor ---

type AclRule = { direction: string; priority: string; match: string; action: string }

const aclDirections = [
  { value: "to-lport", label: "Inbound (to-lport)" },
  { value: "from-lport", label: "Outbound (from-lport)" },
]
const aclActions = ["allow-related", "allow", "drop", "reject"]

const aclTemplates: Array<{ label: string; rule: (cidr: string) => AclRule }> = [
  { label: "Allow SSH from anywhere", rule: () => ({ direction: "to-lport", priority: "1100", match: "tcp.dst == 22", action: "allow-related" }) },
  { label: "Allow ICMP", rule: () => ({ direction: "to-lport", priority: "1100", match: "icmp4", action: "allow-related" }) },
  { label: "Allow traffic within subnet", rule: (cidr) => ({ direction: "to-lport", priority: "1050", match: `ip4.src == ${cidr.split(",")[0]}`, action: "allow-related" }) },
  { label: "Deny all other inbound", rule: (cidr) => ({ direction: "to-lport", priority: "1000", match: `ip4.dst == ${cidr.split(",")[0]}`, action: "drop" }) },
]

export function SubnetDetailPage() {
  const { name = "" } = useParams()
  const [rules, setRules] = useState<AclRule[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmSave, setConfirmSave] = useState(false)
  const [error, setError] = useState("")
  const { data, loading, reload } = useAsync(async () => {
    const [subnetRes, ips, vms, pools] = await Promise.all([
      apiFetch(`${OVN}/subnets/${name}`),
      listItems(`${OVN}/ips`),
      listItems(`${VM_API}/virtualmachines`),
      listItems(`${OVN}/ippools`).catch(() => [] as KubeObject[]),
    ])
    const subnet = subnetRes.ok ? await subnetRes.json() as KubeObject : null
    return { subnet, ips: ips.filter((ip) => str(asRecord(ip.spec).subnet) === name), vms: vms.filter((vm) => vmSubnet(vm) === name), pools: pools.filter((pool) => str(asRecord(pool.spec).subnet) === name) }
  }, { subnet: null as KubeObject | null, ips: [] as KubeObject[], vms: [] as KubeObject[], pools: [] as KubeObject[] }, [name])

  if (loading && !data.subnet) return <LoadingState />
  if (!data.subnet) return <EmptyState icon={Split} title={t("Subnet not found")} action={<Button asChild variant="outline" size="sm"><Link to="/vpc/subnets">{t("Back to subnets")}</Link></Button>} />

  const spec = asRecord(data.subnet.spec)
  const savedRules: AclRule[] = asList(spec.acls).map((rule) => ({ direction: str(rule.direction, "to-lport"), priority: str(rule.priority, "1000"), match: str(rule.match), action: str(rule.action, "allow-related") }))
  const editing = rules !== null
  const shownRules = rules ?? savedRules
  const usage = subnetUsage(data.subnet)
  const updateRule = (index: number, patch: Partial<AclRule>) => setRules((current) => (current ?? savedRules).map((rule, i) => i === index ? { ...rule, ...patch } : rule))

  const save = async () => {
    setSaving(true)
    setError("")
    try {
      const acls = (rules ?? []).filter((rule) => rule.match.trim()).map((rule) => ({ direction: rule.direction, priority: Number(rule.priority) || 1000, match: rule.match.trim(), action: rule.action }))
      await requestJson(`${OVN}/subnets/${name}`, jsonBody("PATCH", { spec: { acls } }, "application/merge-patch+json"))
      setRules(null)
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Failed to save ACL"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: t("Subnets"), to: "/vpc/subnets" }, { label: name }]}
        title={name}
        badge={<StatusDot status={subnetReady(data.subnet)} />}
        actions={<Button variant="outline" size="sm" onClick={reload} className="gap-2"><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />{t("Refresh")}</Button>}
      />
      <Panel title={t("Basic information")}>
          <KeyValueGrid items={[
            { label: t("VPC"), value: <Link to={`/vpc/vpcs/${str(spec.vpc, "ovn-cluster")}`} className="hover:text-primary transition-colors">{str(spec.vpc, "ovn-cluster")}</Link> },
            { label: t("CIDR"), value: <span className="font-mono">{str(spec.cidrBlock)}</span> },
            { label: t("Gateway"), value: <span className="font-mono">{str(spec.gateway, "N/A")}</span> },
            { label: t("Protocol"), value: str(spec.protocol, "IPv4") },
            { label: t("IP usage"), value: <UsageBar used={usage.used} total={usage.total} label={t("{v0} used / {v1} total", { v0: usage.used, v1: usage.total })} /> },
            { label: t("Bound namespaces"), value: (spec.namespaces as string[] | undefined)?.join(", ") || "None" },
            { label: t("NAT outgoing"), value: spec.natOutgoing ? "Enabled" : "Disabled" },
            { label: t("Private"), value: spec.private ? "Yes" : "No" },
            { label: t("Excluded IPs"), value: (spec.excludeIps as string[] | undefined)?.join(", ") || "None" },
            { label: t("Provider"), value: str(spec.provider, "ovn") },
          ]} />
        </Panel>

      <Panel
        title={t("Network ACL")}
        description={<>{t("OVN match expressions, e.g.")} <code className="font-mono">tcp.dst == 443</code>{t(". Higher priority wins.")}</>}
        bodyClassName="space-y-3"
        actions={
            <div className="flex flex-wrap gap-2">
              {editing ? (
                <>
                  <Button size="sm" variant="outline" onClick={() => { setRules(null); setError("") }}>{t("Cancel")}</Button>
                  <Button size="sm" onClick={() => setConfirmSave(true)} disabled={saving}>{saving ? t("Saving...") : t("Save rules")}</Button>
                </>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setRules(savedRules)}>{t("Edit rules")}</Button>
              )}
            </div>
        }
      >
          {shownRules.length === 0 && !editing && <p className="text-sm text-muted-foreground">{t("No rules.")}</p>}
          {shownRules.length > 0 && (
            <div className="overflow-x-auto">
              <div className="min-w-[680px] space-y-2">
                <div className="grid grid-cols-[180px_100px_1fr_150px_40px] gap-2 px-1 text-xs font-semibold text-muted-foreground">
                  <span>{t("Direction")}</span><span>{t("Priority")}</span><span>{t("Match")}</span><span>{t("Action")}</span><span />
                </div>
                {shownRules.map((rule, index) => editing ? (
                  <div key={index} className="grid grid-cols-[180px_100px_1fr_150px_40px] items-center gap-2">
                    <NativeSelect value={rule.direction} onChange={(e) => updateRule(index, { direction: e.target.value })}>
                      {aclDirections.map((item) => <option key={item.value} value={item.value}>{t(item.label)}</option>)}
                    </NativeSelect>
                    <Input type="number" value={rule.priority} onChange={(e) => updateRule(index, { priority: e.target.value })} />
                    <Input className="font-mono text-xs" value={rule.match} onChange={(e) => updateRule(index, { match: e.target.value })} placeholder={t("ip4.src == 10.0.0.0/8 && tcp.dst == 22")} />
                    <NativeSelect value={rule.action} onChange={(e) => updateRule(index, { action: e.target.value })}>
                      {aclActions.map((action) => <option key={action} value={action}>{action}</option>)}
                    </NativeSelect>
                    <Button size="icon" variant="ghost" aria-label={t("Remove rule")} onClick={() => setRules((current) => (current ?? []).filter((_, i) => i !== index))}><Trash2 className="size-4 text-muted-foreground" /></Button>
                  </div>
                ) : (
                  <div key={index} className="grid grid-cols-[180px_100px_1fr_150px_40px] items-center gap-2 rounded-lg border px-1 py-2 text-sm">
                    <span>{rule.direction === "to-lport" ? t("Inbound") : t("Outbound")}</span>
                    <span className="tabular-nums">{rule.priority}</span>
                    <span className="font-mono text-xs break-all">{rule.match}</span>
                    <Badge variant={rule.action.startsWith("allow") ? "success" : "danger"}>{rule.action}</Badge>
                    <span />
                  </div>
                ))}
              </div>
            </div>
          )}
          {editing && (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setRules((current) => [...(current ?? []), { direction: "to-lport", priority: "1000", match: "", action: "allow-related" }])}><Plus className="size-4" />{t("Add rule")}</Button>
              <span className="text-xs text-muted-foreground">{t("Quick add:")}</span>
              {aclTemplates.map((template) => (
                <Button key={template.label} size="sm" variant="ghost" onClick={() => setRules((current) => [...(current ?? []), template.rule(str(spec.cidrBlock, "0.0.0.0/0"))])}>{t(template.label)}</Button>
              ))}
            </div>
          )}
          {error && <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm break-all">{error}</div>}
      </Panel>
      <ConfirmDialog
        open={confirmSave}
        onOpenChange={setConfirmSave}
        title={t("Save network ACL for subnet {name}?", { name })}
        description={t("The rules apply to every instance in this subnet immediately.")}
        confirmLabel={t("Save rules")}
        onConfirm={save}
      />

      <SubnetIpPools subnet={data.subnet} pools={data.pools} onChanged={reload} />

      <div className="space-y-3">
        <h2 className="text-base font-semibold">{t("Allocated addresses")}</h2>
        <DataTable
          rows={data.ips}
          rowKey={(ip) => ip.metadata.name}
          minWidth={600}
          empty={<EmptyState title={t("No allocated addresses")} />}
          columns={[
            { header: t("Address"), cell: (ip) => <span className="font-mono text-xs">{str(asRecord(ip.spec).v4IpAddress || asRecord(ip.spec).ipAddress)}</span> },
            { header: t("MAC"), cell: (ip) => <span className="font-mono text-xs text-muted-foreground">{str(asRecord(ip.spec).macAddress, "N/A")}</span> },
            { header: t("Owner"), cell: (ip) => <span className="text-sm">{str(asRecord(ip.spec).namespace)}/{str(asRecord(ip.spec).podName)}</span> },
            { header: t("Node"), cell: (ip) => <span className="text-sm text-muted-foreground">{str(asRecord(ip.spec).nodeName, "N/A")}</span> },
          ]}
        />
      </div>
    </div>
  )
}
