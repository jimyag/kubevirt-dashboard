import { useMemo, useState, type ReactNode } from "react"
import { Link, useParams } from "react-router-dom"
import { Cable, ListTree, Plus, RefreshCw, Route } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ConfirmDialog, DataTable, EmptyState, FilterInput, LoadingState, PageHeader, StatusDot, Toolbar } from "@/components/console"
import { AddPeeringDialog, RouteTablePanel } from "@/components/vpc-routing"
import { peeringStatus, poolStatus, readPeerings, readPolicy, readStatic, removePeering, type Peering } from "@/lib/vpc"
import { CreateIpPoolDialog, DeleteIpPoolDialog, IpPoolTable } from "@/components/ip-pools"
import { KubeOvnMissing } from "@/pages/vpc"
import { useFilteredRows, type FilterField } from "@/lib/filter"
import { apiFetch, asRecord, listItems, str, useAsync, useNetworkProfile, type KubeObject } from "@/lib/kube"
import { t } from "@/lib/i18n"

const OVN = "/apis/kubeovn.io/v1"

const vpcLink = (name: string) => <Link to={`/vpc/vpcs/${name}`} className="text-sm hover:text-primary transition-colors">{name}</Link>

/** Wraps a VPC page so stacks without VPCs show the same notice as the VPC list. */
function VpcOnly({ title, children }: { title: string; children: ReactNode }) {
  const profile = useNetworkProfile()
  if (profile.loaded && !profile.vpc) return <div className="space-y-4"><PageHeader title={title} /><KubeOvnMissing /></div>
  return <>{children}</>
}

// --- Route tables ---

type RouteTableRow = { vpc: KubeObject; staticCount: number; policyCount: number; defaultRoute: string }

const routeTableFields: FilterField<RouteTableRow>[] = [
  { key: "vpc", label: "VPC", aliases: ["name"], value: (row) => row.vpc.metadata.name },
  { key: "nexthop", label: "Default route", aliases: ["via"], value: (row) => row.defaultRoute },
]

/** One route table per VPC router: its static and policy routes. */
export function RouteTableListPage() {
  const [search, setSearch] = useState("")
  const { data, loading, reload } = useAsync(() => listItems(`${OVN}/vpcs`), [] as KubeObject[], [])
  const rows = useMemo(() => data.map((vpc): RouteTableRow => {
    const spec = asRecord(vpc.spec)
    const statics = readStatic(spec)
    return {
      vpc,
      staticCount: statics.length,
      policyCount: readPolicy(spec).length,
      defaultRoute: statics.find((route) => route.cidr === "0.0.0.0/0")?.nextHopIP || "",
    }
  }), [data])
  const filtered = useFilteredRows(rows, routeTableFields, search)

  return (
    <VpcOnly title={t("Route Tables")}>
      <div className="space-y-4">
        <PageHeader title={t("Route Tables")} />
        <Toolbar right={<FilterInput value={search} onChange={setSearch} fields={routeTableFields} rows={rows} placeholder={t("Filter, e.g. vpc:vpc-prod")} />}>
          <Button size="sm" variant="outline" onClick={reload} className="gap-2"><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />{t("Refresh")}</Button>
        </Toolbar>
        <DataTable
          loading={loading}
          rows={filtered}
          rowKey={(row) => row.vpc.metadata.name}
          empty={<EmptyState icon={Route} title={t("No route tables")} />}
          columns={[
            {
              header: t("Route table"),
              cell: (row) => (
                <div className="flex flex-col">
                  <Link to={`/vpc/route-tables/${row.vpc.metadata.name}`} className="font-medium hover:text-primary transition-colors">{str(asRecord(row.vpc.status).router, row.vpc.metadata.name)}</Link>
                  <span className="text-xs text-muted-foreground">{t("VPC {vpc}", { vpc: row.vpc.metadata.name })}</span>
                </div>
              ),
            },
            { header: t("Static routes"), cell: (row) => <span className="text-sm tabular-nums">{row.staticCount}</span> },
            { header: t("Policy routes"), cell: (row) => <span className="text-sm tabular-nums">{row.policyCount}</span> },
            { header: t("Default route"), cell: (row) => <span className="font-mono text-xs">{row.defaultRoute ? `0.0.0.0/0 → ${row.defaultRoute}` : "-"}</span> },
          ]}
        />
      </div>
    </VpcOnly>
  )
}

export function RouteTableDetailPage() {
  const { name = "" } = useParams()
  const { data: vpc, loading, reload } = useAsync(async () => {
    const res = await apiFetch(`${OVN}/vpcs/${name}`)
    return res.ok ? await res.json() as KubeObject : null
  }, null as KubeObject | null, [name])

  if (loading && !vpc) return <LoadingState />
  if (!vpc) return <EmptyState icon={Route} title={t("VPC not found")} action={<Button asChild variant="outline" size="sm"><Link to="/vpc/route-tables">{t("Back")}</Link></Button>} />
  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumbs={[{ label: t("Route Tables"), to: "/vpc/route-tables" }, { label: name }]}
        title={str(asRecord(vpc.status).router, name)}
        subtitle={t("VPC {vpc}", { vpc: name })}
        actions={<Button variant="outline" size="sm" onClick={reload} className="gap-2"><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />{t("Refresh")}</Button>}
      />
      <RouteTablePanel vpc={vpc} onSaved={reload} />
    </div>
  )
}

// --- Peering connections ---

type PeeringRow = { key: string; local: string; peering: Peering; peerAddress: string; status: string }

const peeringFields: FilterField<PeeringRow>[] = [
  { key: "vpc", label: "VPC", value: (row) => [row.local, row.peering.remoteVpc] },
  { key: "status", label: "Status", value: (row) => row.status },
  { key: "address", label: "Local address", aliases: ["ip"], value: (row) => [row.peering.localConnectIP, row.peerAddress] },
]

/** Every peering in the cluster, listed once per VPC pair. */
export function PeeringListPage() {
  const [search, setSearch] = useState("")
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<PeeringRow | null>(null)
  const { data, loading, reload } = useAsync(async () => {
    const [vpcs, subnets] = await Promise.all([listItems(`${OVN}/vpcs`), listItems(`${OVN}/subnets`)])
    return { vpcs, subnets }
  }, { vpcs: [] as KubeObject[], subnets: [] as KubeObject[] }, [])

  const rows = useMemo(() => {
    const byName = new Map(data.vpcs.map((vpc) => [vpc.metadata.name, vpc]))
    const seen = new Set<string>()
    const result: PeeringRow[] = []
    for (const vpc of data.vpcs) {
      const local = vpc.metadata.name
      for (const peering of readPeerings(vpc)) {
        // A pair appears on both VPCs; show it once, from the side that sorts first.
        const key = [local, peering.remoteVpc].sort().join("|")
        if (seen.has(key)) continue
        seen.add(key)
        result.push({
          key,
          local,
          peering,
          peerAddress: readPeerings(byName.get(peering.remoteVpc)).find((item) => item.remoteVpc === local)?.localConnectIP || "",
          status: peeringStatus(local, peering, byName),
        })
      }
    }
    return result
  }, [data.vpcs])
  const filtered = useFilteredRows(rows, peeringFields, search)

  return (
    <VpcOnly title={t("Peering Connections")}>
      <div className="space-y-4">
        <PageHeader
          title={t("Peering Connections")}
          actions={<Button onClick={() => setAdding(true)} className="gap-1.5"><Plus className="size-4" />{t("Add peering")}</Button>}
        />
        <Toolbar right={<FilterInput value={search} onChange={setSearch} fields={peeringFields} rows={rows} placeholder={t("Filter, e.g. vpc:vpc-prod")} />}>
          <Button size="sm" variant="outline" onClick={reload} className="gap-2"><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />{t("Refresh")}</Button>
        </Toolbar>
        <DataTable
          loading={loading}
          rows={filtered}
          rowKey={(row) => row.key}
          empty={<EmptyState icon={Cable} title={rows.length ? t("No matching peering connections") : t("No peering connections")} action={<Button size="sm" onClick={() => setAdding(true)}>{t("Add peering")}</Button>} />}
          columns={[
            { header: t("VPC"), cell: (row) => vpcLink(row.local) },
            { header: t("Local address"), cell: (row) => <span className="font-mono text-xs">{row.peering.localConnectIP}</span> },
            { header: t("Peer VPC"), cell: (row) => vpcLink(row.peering.remoteVpc) },
            { header: t("Peer address"), cell: (row) => <span className="font-mono text-xs">{row.peerAddress || "N/A"}</span> },
            { header: t("Status"), cell: (row) => <StatusDot status={row.status} /> },
            { header: "", className: "w-20 text-right", cell: (row) => <Button size="sm" variant="ghost" onClick={() => setRemoving(row)}>{t("Remove")}</Button> },
          ]}
        />
        <AddPeeringDialog open={adding} onOpenChange={setAdding} vpcs={data.vpcs} subnets={data.subnets} onSaved={reload} />
        <ConfirmDialog
          open={removing !== null}
          onOpenChange={(open) => !open && setRemoving(null)}
          title={t("Remove peering between {local} and {remote}?", { local: removing?.local, remote: removing?.peering.remoteVpc })}
          description={t("Removes the peering and its routes from both VPCs. Traffic between them stops immediately.")}
          destructive
          confirmLabel={t("Remove")}
          onConfirm={async () => {
            if (!removing) return
            await removePeering(removing.local, removing.peering)
            reload()
          }}
        />
      </div>
    </VpcOnly>
  )
}

// --- IP pools ---

const poolFields: FilterField<KubeObject>[] = [
  { key: "name", label: "Name", value: (pool) => pool.metadata.name },
  { key: "subnet", label: "Subnet", value: (pool) => str(asRecord(pool.spec).subnet) },
  { key: "namespace", label: "Namespaces", aliases: ["ns"], value: (pool) => asRecord(pool.spec).namespaces as string[] | undefined },
  { key: "status", label: "Status", value: poolStatus },
]

export function IpPoolListPage() {
  const [search, setSearch] = useState("")
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<KubeObject | null>(null)
  const { data, loading, reload } = useAsync(async () => {
    const [pools, subnets] = await Promise.all([listItems(`${OVN}/ippools`).catch(() => [] as KubeObject[]), listItems(`${OVN}/subnets`)])
    return { pools, subnets: subnets.filter((subnet) => subnet.metadata.name !== "join") }
  }, { pools: [] as KubeObject[], subnets: [] as KubeObject[] }, [])
  const filtered = useFilteredRows(data.pools, poolFields, search)

  return (
    <VpcOnly title={t("IP Pools")}>
      <div className="space-y-4">
        <PageHeader
          title={t("IP Pools")}
          actions={<Button onClick={() => setCreating(true)} className="gap-1.5"><Plus className="size-4" />{t("Create IP pool")}</Button>}
        />
        <Toolbar right={<FilterInput value={search} onChange={setSearch} fields={poolFields} rows={data.pools} placeholder={t("Filter, e.g. subnet:subnet-web")} />}>
          <Button size="sm" variant="outline" onClick={reload} className="gap-2"><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />{t("Refresh")}</Button>
        </Toolbar>
        <IpPoolTable
          pools={filtered}
          loading={loading}
          showSubnet
          onDelete={setDeleting}
          empty={<EmptyState icon={ListTree} title={data.pools.length ? t("No matching IP pools") : t("No IP pools")} action={<Button size="sm" onClick={() => setCreating(true)}>{t("Create IP pool")}</Button>} />}
        />
        <CreateIpPoolDialog open={creating} onOpenChange={setCreating} subnets={data.subnets} onCreated={reload} />
        <DeleteIpPoolDialog pool={deleting} onOpenChange={(open) => !open && setDeleting(null)} onDeleted={reload} />
      </div>
    </VpcOnly>
  )
}
