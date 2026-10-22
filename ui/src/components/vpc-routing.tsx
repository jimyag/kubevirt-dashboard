import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { Plus, Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Combobox, ConfirmDialog, DataTable, EmptyState, ErrorNote, FieldRow, NativeSelect, Panel, StatusDot, TabBar } from "@/components/console"
import { apiFetch, asList, asRecord, requestJson, str, type KubeObject, type UnknownRecord } from "@/lib/kube"
import { cidrsOverlap, ipv4Cidr, ipv4ToNumber, parseIPv4Cidr } from "@/lib/validate"
import { t } from "@/lib/i18n"

const OVN = "/apis/kubeovn.io/v1"
const DEFAULT_VPC = "ovn-cluster"

const mergePatch = (url: string, body: unknown) =>
  requestJson(url, { method: "PATCH", headers: { "Content-Type": "application/merge-patch+json" }, body: JSON.stringify(body) })

const getVpc = async (name: string) => {
  const res = await apiFetch(`${OVN}/vpcs/${name}`)
  if (!res.ok) throw new Error(t("VPC {vpc} not found", { vpc: name }))
  return await res.json() as KubeObject
}

const isIp = (value: string) => value.includes(":") || ipv4ToNumber(value) !== null
const isCidr = (value: string) => value.includes(":") ? value.includes("/") : parseIPv4Cidr(value) !== null
const withoutPrefix = (cidr: string) => cidr.split("/")[0]

// --- Route table ---

type StaticRoute = { cidr: string; nextHopIP: string; policy: string; extra: UnknownRecord }
type PolicyRoute = { priority: string; match: string; action: string; nextHopIP: string }

const routePolicies = [
  { value: "policyDst", label: "Destination" },
  { value: "policySrc", label: "Source" },
]
const policyActions = ["allow", "drop", "reroute"]

const readStatic = (spec: UnknownRecord): StaticRoute[] =>
  asList(spec.staticRoutes).map(({ cidr, nextHopIP, policy, ...extra }) => ({ cidr: str(cidr), nextHopIP: str(nextHopIP), policy: str(policy, "policyDst"), extra }))

const readPolicy = (spec: UnknownRecord): PolicyRoute[] =>
  asList(spec.policyRoutes).map((route) => ({ priority: str(route.priority, "1000"), match: str(route.match), action: str(route.action, "allow"), nextHopIP: str(route.nextHopIP) }))

const staticProblem = (route: StaticRoute) => {
  if (!isCidr(route.cidr.trim())) return t("{cidr} is not a valid CIDR.", { cidr: route.cidr || '""' })
  if (!isIp(route.nextHopIP.trim())) return t("{ip} is not a valid next hop.", { ip: route.nextHopIP || '""' })
  return ""
}

const policyProblem = (route: PolicyRoute) => {
  const priority = Number(route.priority)
  if (!Number.isInteger(priority) || priority < 0 || priority > 32767) return t("Priority must be between 0 and 32767.")
  if (!route.match.trim()) return t("A policy route needs a match expression.")
  if (route.action === "reroute" && !route.nextHopIP.split(",").every((ip) => isIp(ip.trim()))) return t("A reroute needs a valid next hop.")
  return ""
}

/**
 * Static and policy routes of a VPC router (spec.staticRoutes and spec.policyRoutes). Fields this
 * editor does not show (ECMP mode, BFD, route table) are kept on the routes they belong to.
 */
export function RouteTablePanel({ vpc, onSaved }: { vpc: KubeObject; onSaved: () => void }) {
  const spec = asRecord(vpc.spec)
  const name = vpc.metadata.name
  const [tab, setTab] = useState<"static" | "policy">("static")
  const [staticDraft, setStaticDraft] = useState<StaticRoute[] | null>(null)
  const [policyDraft, setPolicyDraft] = useState<PolicyRoute[] | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState("")
  const savedStatic = readStatic(spec)
  const savedPolicy = readPolicy(spec)
  const editing = tab === "static" ? staticDraft !== null : policyDraft !== null

  const cancel = () => {
    setStaticDraft(null)
    setPolicyDraft(null)
    setError("")
  }

  const review = () => {
    const problem = tab === "static" ? (staticDraft ?? []).map(staticProblem).find(Boolean) : (policyDraft ?? []).map(policyProblem).find(Boolean)
    if (problem) setError(problem)
    else {
      setError("")
      setConfirming(true)
    }
  }

  const save = async () => {
    // Merge patch replaces the whole list, which is what the editor shows.
    const body = tab === "static"
      ? { spec: { staticRoutes: (staticDraft ?? []).map((route) => ({ ...route.extra, cidr: route.cidr.trim(), nextHopIP: route.nextHopIP.trim(), policy: route.policy })) } }
      : { spec: { policyRoutes: (policyDraft ?? []).map((route) => ({ priority: Number(route.priority), match: route.match.trim(), action: route.action, ...(route.action === "reroute" ? { nextHopIP: route.nextHopIP.trim() } : {}) })) } }
    await mergePatch(`${OVN}/vpcs/${name}`, body)
    cancel()
    onSaved()
  }

  const updateStatic = (index: number, patch: Partial<StaticRoute>) => setStaticDraft((current) => (current ?? []).map((route, i) => i === index ? { ...route, ...patch } : route))
  const updatePolicy = (index: number, patch: Partial<PolicyRoute>) => setPolicyDraft((current) => (current ?? []).map((route, i) => i === index ? { ...route, ...patch } : route))

  return (
    <Panel
      title={t("Route table")}
      bodyClassName="space-y-3"
      actions={editing ? (
        <>
          <Button size="sm" variant="outline" onClick={cancel}>{t("Cancel")}</Button>
          <Button size="sm" onClick={review}>{t("Save routes")}</Button>
        </>
      ) : (
        <Button size="sm" variant="outline" onClick={() => (tab === "static" ? setStaticDraft(savedStatic) : setPolicyDraft(savedPolicy))}>{t("Edit routes")}</Button>
      )}
    >
      <TabBar
        value={tab}
        onChange={(next) => {
          if (editing) return
          setTab(next)
        }}
        tabs={[
          { id: "static", label: t("Static routes ({count})", { count: savedStatic.length }) },
          { id: "policy", label: t("Policy routes ({count})", { count: savedPolicy.length }) },
        ]}
      />
      {tab === "static" && (staticDraft ? (
        <div className="overflow-x-auto">
          <div className="min-w-[620px] space-y-2">
            <div className="grid grid-cols-[1fr_1fr_150px_40px] gap-2 px-1 text-xs font-semibold text-muted-foreground">
              <span>{t("Destination CIDR")}</span><span>{t("Next hop")}</span><span>{t("Match on")}</span><span />
            </div>
            {staticDraft.map((route, index) => (
              <div key={index} className="grid grid-cols-[1fr_1fr_150px_40px] items-center gap-2">
                <Input className="font-mono text-xs" value={route.cidr} onChange={(e) => updateStatic(index, { cidr: e.target.value })} placeholder="0.0.0.0/0" />
                <Input className="font-mono text-xs" value={route.nextHopIP} onChange={(e) => updateStatic(index, { nextHopIP: e.target.value })} placeholder="10.0.1.254" />
                <NativeSelect value={route.policy} onChange={(e) => updateStatic(index, { policy: e.target.value })}>
                  {routePolicies.map((item) => <option key={item.value} value={item.value}>{t(item.label)}</option>)}
                </NativeSelect>
                <Button size="icon" variant="ghost" aria-label={t("Remove route")} onClick={() => setStaticDraft((current) => (current ?? []).filter((_, i) => i !== index))}><Trash2 className="size-4 text-muted-foreground" /></Button>
              </div>
            ))}
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setStaticDraft((current) => [...(current ?? []), { cidr: "", nextHopIP: "", policy: "policyDst", extra: {} }])}><Plus className="size-4" />{t("Add route")}</Button>
          </div>
        </div>
      ) : (
        <DataTable
          rows={savedStatic.map((route, index) => ({ route, index }))}
          rowKey={({ index }) => String(index)}
          minWidth={480}
          empty={<EmptyState title={t("No static routes")} />}
          columns={[
            { header: t("Destination CIDR"), cell: ({ route }) => <span className="font-mono text-xs">{route.cidr}</span> },
            { header: t("Next hop"), cell: ({ route }) => <span className="font-mono text-xs">{route.nextHopIP}</span> },
            { header: t("Match on"), cell: ({ route }) => <span className="text-sm">{t(routePolicies.find((item) => item.value === route.policy)?.label || route.policy)}</span> },
            { header: t("Route table"), cell: ({ route }) => <span className="text-sm text-muted-foreground">{str(route.extra.routeTable, t("Main"))}</span> },
          ]}
        />
      ))}
      {tab === "policy" && (policyDraft ? (
        <div className="overflow-x-auto">
          <div className="min-w-[720px] space-y-2">
            <div className="grid grid-cols-[100px_1fr_120px_160px_40px] gap-2 px-1 text-xs font-semibold text-muted-foreground">
              <span>{t("Priority")}</span><span>{t("Match")}</span><span>{t("Action")}</span><span>{t("Next hop")}</span><span />
            </div>
            {policyDraft.map((route, index) => (
              <div key={index} className="grid grid-cols-[100px_1fr_120px_160px_40px] items-center gap-2">
                <Input type="number" value={route.priority} onChange={(e) => updatePolicy(index, { priority: e.target.value })} />
                <Input className="font-mono text-xs" value={route.match} onChange={(e) => updatePolicy(index, { match: e.target.value })} placeholder="ip4.src == 10.0.1.0/24" />
                <NativeSelect value={route.action} onChange={(e) => updatePolicy(index, { action: e.target.value })}>
                  {policyActions.map((action) => <option key={action} value={action}>{action}</option>)}
                </NativeSelect>
                <Input className="font-mono text-xs" disabled={route.action !== "reroute"} value={route.action === "reroute" ? route.nextHopIP : ""} onChange={(e) => updatePolicy(index, { nextHopIP: e.target.value })} placeholder={route.action === "reroute" ? "10.0.1.254" : "N/A"} />
                <Button size="icon" variant="ghost" aria-label={t("Remove route")} onClick={() => setPolicyDraft((current) => (current ?? []).filter((_, i) => i !== index))}><Trash2 className="size-4 text-muted-foreground" /></Button>
              </div>
            ))}
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setPolicyDraft((current) => [...(current ?? []), { priority: "1000", match: "", action: "reroute", nextHopIP: "" }])}><Plus className="size-4" />{t("Add route")}</Button>
          </div>
        </div>
      ) : (
        <DataTable
          rows={[...savedPolicy].sort((a, b) => Number(b.priority) - Number(a.priority)).map((route, index) => ({ route, index }))}
          rowKey={({ index }) => String(index)}
          minWidth={520}
          empty={<EmptyState title={t("No policy routes")} />}
          columns={[
            { header: t("Priority"), cell: ({ route }) => <span className="text-sm tabular-nums">{route.priority}</span> },
            { header: t("Match"), cell: ({ route }) => <span className="font-mono text-xs break-all">{route.match}</span> },
            { header: t("Action"), cell: ({ route }) => <Badge variant={route.action === "drop" ? "danger" : "outline"}>{route.action}</Badge> },
            { header: t("Next hop"), cell: ({ route }) => <span className="font-mono text-xs">{route.action === "reroute" ? route.nextHopIP : "N/A"}</span> },
          ]}
        />
      ))}
      {tab === "policy" && <p className="text-xs text-muted-foreground">{t("OVN match expressions. Higher priority is evaluated first.")}</p>}
      {error && <ErrorNote>{error}</ErrorNote>}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={tab === "static" ? t("Save static routes of VPC {vpc}?", { vpc: name }) : t("Save policy routes of VPC {vpc}?", { vpc: name })}
        description={t("Routing for every subnet in this VPC changes immediately.")}
        confirmLabel={t("Save routes")}
        onConfirm={save}
      />
    </Panel>
  )
}

// --- Peering ---

type Peering = { remoteVpc: string; localConnectIP: string }

const readPeerings = (vpc: KubeObject | undefined): Peering[] =>
  asList(asRecord(vpc?.spec).vpcPeerings).map((peering) => ({ remoteVpc: str(peering.remoteVpc), localConnectIP: str(peering.localConnectIP) }))

/** Picks a free /30 in 169.254.0.0/16 that no peering of any VPC uses yet. */
const freeConnectCidr = (vpcs: KubeObject[]) => {
  const used = vpcs.flatMap((vpc) => readPeerings(vpc).map((peering) => peering.localConnectIP))
  for (let block = 0; block < 16384; block++) {
    const third = Math.floor(block / 64)
    const fourth = (block % 64) * 4
    const cidr = `169.254.${third}.${fourth}/30`
    if (!used.some((item) => cidrsOverlap(item, cidr))) return cidr
  }
  return "169.254.0.0/30"
}

/** The two usable addresses of a /30: [local, remote]. */
const connectPair = (cidr: string) => {
  const range = parseIPv4Cidr(cidr)
  if (!range || range.prefix !== 30) return null
  const toIp = (value: number) => [24, 16, 8, 0].map((shift) => Math.floor(value / 2 ** shift) % 256).join(".")
  return [`${toIp(range.start + 1)}/30`, `${toIp(range.start + 2)}/30`]
}

const subnetCidrs = (subnets: KubeObject[], vpc: string) =>
  subnets.filter((subnet) => str(asRecord(subnet.spec).vpc, DEFAULT_VPC) === vpc).map((subnet) => ipv4Cidr(str(asRecord(subnet.spec).cidrBlock))).filter(Boolean)

/**
 * VPC peering (spec.vpcPeerings). Both VPCs list each other with the two ends of a shared /30
 * link, and each side routes the other's subnets to the peer's link address.
 */
export function PeeringPanel({ vpc, vpcs, subnets, onSaved }: { vpc: KubeObject; vpcs: KubeObject[]; subnets: KubeObject[]; onSaved: () => void }) {
  const name = vpc.metadata.name
  const peerings = readPeerings(vpc)
  const byName = useMemo(() => new Map(vpcs.map((item) => [item.metadata.name, item])), [vpcs])
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<Peering | null>(null)
  const isDefault = name === DEFAULT_VPC

  const remove = async (peering: Peering) => {
    const [local, remote] = await Promise.all([getVpc(name), getVpc(peering.remoteVpc).catch(() => null)])
    const remotePeering = readPeerings(remote ?? undefined).find((item) => item.remoteVpc === name)
    const strip = (obj: KubeObject, remoteVpc: string, peerIp: string | undefined) => ({
      spec: {
        vpcPeerings: asList(asRecord(obj.spec).vpcPeerings).filter((item) => str(item.remoteVpc) !== remoteVpc),
        staticRoutes: asList(asRecord(obj.spec).staticRoutes).filter((route) => !peerIp || str(route.nextHopIP) !== peerIp),
      },
    })
    await mergePatch(`${OVN}/vpcs/${name}`, strip(local, peering.remoteVpc, remotePeering && withoutPrefix(remotePeering.localConnectIP)))
    if (remote) await mergePatch(`${OVN}/vpcs/${peering.remoteVpc}`, strip(remote, name, withoutPrefix(peering.localConnectIP)))
    onSaved()
  }

  return (
    <Panel
      title={t("Peering connections")}
      actions={!isDefault && <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setAdding(true)}><Plus className="size-4" />{t("Add peering")}</Button>}
    >
      {isDefault ? (
        <p className="text-sm text-muted-foreground">{t("The default VPC cannot be peered.")}</p>
      ) : (
        <DataTable
          rows={peerings}
          rowKey={(peering) => peering.remoteVpc}
          minWidth={520}
          empty={<EmptyState title={t("No peering connections")} />}
          columns={[
            { header: t("Peer VPC"), cell: (peering) => <Link to={`/vpc/vpcs/${peering.remoteVpc}`} className="font-medium hover:text-primary transition-colors">{peering.remoteVpc}</Link> },
            { header: t("Local address"), cell: (peering) => <span className="font-mono text-xs">{peering.localConnectIP}</span> },
            { header: t("Peer address"), cell: (peering) => <span className="font-mono text-xs">{readPeerings(byName.get(peering.remoteVpc)).find((item) => item.remoteVpc === name)?.localConnectIP || "N/A"}</span> },
            {
              header: t("Status"),
              cell: (peering) => {
                const remote = byName.get(peering.remoteVpc)
                const status = !remote ? "Missing" : readPeerings(remote).some((item) => item.remoteVpc === name) ? "Active" : "Pending"
                return <StatusDot status={status} />
              },
            },
            { header: "", className: "w-20 text-right", cell: (peering) => <Button size="sm" variant="ghost" onClick={() => setRemoving(peering)}>{t("Remove")}</Button> },
          ]}
        />
      )}
      <AddPeeringDialog open={adding} onOpenChange={setAdding} vpc={vpc} vpcs={vpcs} subnets={subnets} onSaved={onSaved} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t("Remove peering between {local} and {remote}?", { local: name, remote: removing?.remoteVpc })}
        description={t("Removes the peering and its routes from both VPCs. Traffic between them stops immediately.")}
        destructive
        confirmLabel={t("Remove")}
        onConfirm={() => removing ? remove(removing) : undefined}
      />
    </Panel>
  )
}

function AddPeeringDialog({ open, onOpenChange, vpc, vpcs, subnets, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; vpc: KubeObject; vpcs: KubeObject[]; subnets: KubeObject[]; onSaved: () => void }) {
  const name = vpc.metadata.name
  const peered = new Set(readPeerings(vpc).map((peering) => peering.remoteVpc))
  const candidates = vpcs.map((item) => item.metadata.name).filter((item) => item !== name && item !== DEFAULT_VPC && !peered.has(item))
  const [remote, setRemote] = useState("")
  const [connect, setConnect] = useState("")
  const [routes, setRoutes] = useState(true)
  const linkCidr = connect.trim() || freeConnectCidr(vpcs)
  const pair = connectPair(linkCidr)
  const localCidrs = subnetCidrs(subnets, name)
  const remoteCidrs = subnetCidrs(subnets, remote)
  const overlap = localCidrs.flatMap((left) => remoteCidrs.filter((right) => cidrsOverlap(left, right)).map((right) => `${left} / ${right}`))

  const reset = (next: boolean) => {
    if (!next) {
      setRemote("")
      setConnect("")
      setRoutes(true)
    }
    onOpenChange(next)
  }

  const submit = async () => {
    if (!candidates.includes(remote)) throw new Error(t("Choose a VPC to peer with."))
    if (!pair) throw new Error(t("The link must be a /30 CIDR, e.g. 169.254.0.0/30."))
    if (overlap.length) throw new Error(t("Subnets of the two VPCs overlap: {cidrs}", { cidrs: overlap.join(", ") }))
    const [localIp, remoteIp] = pair
    const [local, peer] = await Promise.all([getVpc(name), getVpc(remote)])
    const side = (obj: KubeObject, peerVpc: string, ownIp: string, nextHop: string, cidrs: string[]) => {
      const spec = asRecord(obj.spec)
      const existing = asList(spec.staticRoutes)
      const added = routes ? cidrs.filter((cidr) => !existing.some((route) => str(route.cidr) === cidr)).map((cidr) => ({ cidr, nextHopIP: withoutPrefix(nextHop), policy: "policyDst" })) : []
      return { spec: { vpcPeerings: [...asList(spec.vpcPeerings), { remoteVpc: peerVpc, localConnectIP: ownIp }], staticRoutes: [...existing, ...added] } }
    }
    await mergePatch(`${OVN}/vpcs/${name}`, side(local, remote, localIp, remoteIp, remoteCidrs))
    await mergePatch(`${OVN}/vpcs/${remote}`, side(peer, name, remoteIp, localIp, localCidrs))
    onSaved()
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={reset}
      title={t("Add peering")}
      description={t("Connects {vpc} with another VPC. Both VPCs are updated.", { vpc: name })}
      confirmLabel={t("Create peering")}
      onConfirm={submit}
    >
      <div className="space-y-4">
        <FieldRow label={t("Peer VPC")} hint={candidates.length === 0 ? t("No other custom VPC to peer with.") : undefined}>
          <Combobox value={remote} onChange={setRemote} options={candidates} placeholder={t("Choose a VPC")} aria-label={t("Peer VPC")} />
        </FieldRow>
        <FieldRow label={t("Link CIDR")} hint={pair ? t("{local} on {vpc}, {remote} on the peer.", { local: pair[0], vpc: name, remote: pair[1] }) : t("A /30 used only for this link.")}>
          <Input className="font-mono text-xs" value={connect} onChange={(e) => setConnect(e.target.value)} placeholder={freeConnectCidr(vpcs)} />
        </FieldRow>
        <label className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <div>
            <div className="text-sm font-medium">{t("Add routes to each other's subnets")}</div>
            <div className="font-mono text-xs text-muted-foreground">{remote ? `${remoteCidrs.join(", ") || "-"} ⇄ ${localCidrs.join(", ") || "-"}` : ""}</div>
          </div>
          <Switch checked={routes} onCheckedChange={setRoutes} />
        </label>
        {overlap.length > 0 && <ErrorNote>{t("Subnets of the two VPCs overlap: {cidrs}", { cidrs: overlap.join(", ") })}</ErrorNote>}
      </div>
    </ConfirmDialog>
  )
}
