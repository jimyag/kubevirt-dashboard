import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import { Globe, Trash2, Waypoints } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ChoiceCard, Combobox, ConfirmDialog, DataTable, EmptyState, ErrorNote, FieldRow, Panel, StatusDot } from "@/components/console"
import { asRecord, listItems, requestJson, str, useAsync, useDiscovery, type KubeObject } from "@/lib/kube"
import { OVN_API, natEngineLabel, natKinds, natManifest, natReady, type NatEngine } from "@/lib/nat"
import { t } from "@/lib/i18n"
import { usePolling } from "@/lib/polling"

type Binding = {
  item: KubeObject
  engine: NatEngine
  plural: string
  type: "fip" | "dnat"
  eip: string
  address: string
  ports: string
}

type NatData = {
  iptablesEips: KubeObject[]
  ovnEips: KubeObject[]
  gateways: KubeObject[]
  subnets: KubeObject[]
  bindings: Binding[]
}

const emptyData: NatData = { iptablesEips: [], ovnEips: [], gateways: [], subnets: [], bindings: [] }
const spec = (item: KubeObject) => asRecord(item.spec)
const status = (item: KubeObject) => asRecord(item.status)
const eipAddress = (item?: KubeObject) => (item ? str(status(item).ip) || str(spec(item).v4ip) || str(status(item).v4Ip) || str(spec(item).v4Ip) : "")

/**
 * Elastic IPs bound to one instance: floating IPs (1:1 NAT) and DNAT port forwards, for both
 * Kube-OVN NAT models. VPC NAT gateway rules match the instance's IPs; OVN rules match its Kube-OVN
 * IP object (`<vm>.<namespace>`) or its IPs.
 */
export function InstanceElasticIps({ namespace, name, ips, subnet }: { namespace: string; name: string; ips: string[]; subnet?: string }) {
  const discovery = useDiscovery()
  // useDiscovery returns a new object every render; key the engine list on plain booleans.
  const hasIptables = discovery.loaded && discovery.hasResource("kubeovn.io/v1", "iptables-eips")
  const hasOvn = discovery.loaded && discovery.hasResource("kubeovn.io/v1", "ovn-eips")
  const engines = useMemo<NatEngine[]>(() => [...(hasIptables ? ["iptables" as const] : []), ...(hasOvn ? ["ovn" as const] : [])], [hasIptables, hasOvn])
  const ipName = `${name}.${namespace}`
  const [dialog, setDialog] = useState<"fip" | "dnat" | null>(null)
  const [removing, setRemoving] = useState<Binding | null>(null)
  const ipKey = ips.join(",")

  const { data, error, reload: load } = useAsync(async (): Promise<NatData> => {
    if (engines.length === 0) return emptyData
    const has = (engine: NatEngine) => engines.includes(engine)
    const list = (plural: string, engine: NatEngine) => (has(engine) ? listItems(`${OVN_API}/${plural}`) : Promise.resolve([] as KubeObject[]))
    const [iptablesEips, iptablesFips, iptablesDnats, ovnEips, ovnFips, ovnDnats, gateways, subnets] = await Promise.all([
      list("iptables-eips", "iptables"), list("iptables-fip-rules", "iptables"), list("iptables-dnat-rules", "iptables"),
      list("ovn-eips", "ovn"), list("ovn-fips", "ovn"), list("ovn-dnat-rules", "ovn"),
      list("vpc-nat-gateways", "iptables"), listItems(`${OVN_API}/subnets`),
    ])
    const mine = new Set(ipKey.split(",").filter(Boolean))
    const iptablesAddress = (eip: string) => eipAddress(iptablesEips.find((item) => item.metadata.name === eip))
    const ovnAddress = (eip: string) => eipAddress(ovnEips.find((item) => item.metadata.name === eip))
    const ovnMatches = (item: KubeObject) => str(spec(item).ipName) === ipName || mine.has(str(status(item).v4Ip)) || mine.has(str(spec(item).v4Ip))
    const dnatPorts = (item: KubeObject) => `${str(spec(item).protocol || status(item).protocol, "tcp")} ${str(spec(item).externalPort)} → ${str(spec(item).internalPort)}`
    const bindings: Binding[] = [
      ...iptablesFips.filter((item) => mine.has(str(spec(item).internalIp))).map((item): Binding => ({ item, engine: "iptables", plural: "iptables-fip-rules", type: "fip", eip: str(spec(item).eip), address: str(status(item).v4ip) || iptablesAddress(str(spec(item).eip)), ports: "" })),
      ...iptablesDnats.filter((item) => mine.has(str(spec(item).internalIp))).map((item): Binding => ({ item, engine: "iptables", plural: "iptables-dnat-rules", type: "dnat", eip: str(spec(item).eip), address: str(status(item).v4ip) || iptablesAddress(str(spec(item).eip)), ports: dnatPorts(item) })),
      ...ovnFips.filter(ovnMatches).map((item): Binding => ({ item, engine: "ovn", plural: "ovn-fips", type: "fip", eip: str(spec(item).ovnEip), address: str(status(item).v4Eip) || ovnAddress(str(spec(item).ovnEip)), ports: "" })),
      ...ovnDnats.filter(ovnMatches).map((item): Binding => ({ item, engine: "ovn", plural: "ovn-dnat-rules", type: "dnat", eip: str(spec(item).ovnEip), address: str(status(item).v4Eip) || ovnAddress(str(spec(item).ovnEip)), ports: dnatPorts(item) })),
    ]
    return { iptablesEips, ovnEips, gateways, subnets, bindings }
  }, emptyData, [engines, ipKey, ipName])
  usePolling(load, engines.length > 0 ? 5000 : 0)

  if (engines.length === 0) return null

  const running = ips.length > 0
  return (
    <Panel
      title={t("Elastic IPs")}
      className="lg:col-span-2"
      actions={
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={load}>{t("Refresh")}</Button>
          <Button size="sm" variant="outline" disabled={!running} onClick={() => setDialog("dnat")} className="gap-1.5"><Waypoints className="size-3.5" />{t("Add port forwarding")}</Button>
          <Button size="sm" variant="outline" disabled={!running} onClick={() => setDialog("fip")} className="gap-1.5"><Globe className="size-3.5" />{t("Bind floating IP")}</Button>
        </div>
      }
      bodyClassName="p-0"
    >
      {error && <ErrorNote>{error}</ErrorNote>}
      <DataTable
        rows={data.bindings}
        rowKey={(binding) => `${binding.plural}/${binding.item.metadata.name}`}
        minWidth={640}
        empty={<EmptyState icon={Globe} title={running ? t("No elastic IP bound") : t("Start the instance to bind an elastic IP")} />}
        columns={[
          { header: t("Elastic IP"), cell: (binding) => <div><div className="font-mono text-sm">{binding.address || "-"}</div><div className="text-xs text-muted-foreground">{binding.eip}</div></div> },
          { header: t("Type"), cell: (binding) => <span className="text-sm">{binding.type === "fip" ? t("Floating IP") : t("Port forwarding")}</span> },
          { header: t("Ports"), cell: (binding) => <span className="font-mono text-xs">{binding.ports || t("All")}</span> },
          ...(engines.length > 1 ? [{ header: t("NAT engine"), cell: (binding: Binding) => <span className="text-sm text-muted-foreground">{t(natEngineLabel[binding.engine])}</span> }] : []),
          { header: t("Status"), cell: (binding) => <StatusDot status={natReady(binding.item)} label={natReady(binding.item) === "NotReady" ? t("Not ready") : undefined} /> },
          {
            header: "",
            className: "w-24 text-right",
            cell: (binding) => <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground" onClick={() => setRemoving(binding)}><Trash2 className="size-3.5" />{t("Unbind")}</Button>,
          },
        ]}
      />
      {dialog && (
        <BindDialog
          kind={dialog}
          engines={engines}
          data={data}
          ips={ips}
          ipName={ipName}
          vmName={name}
          subnet={subnet}
          onClose={() => setDialog(null)}
          onDone={load}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={removing?.type === "fip" ? t("Unbind floating IP {address}?", { address: removing.address || removing.eip }) : t("Remove port forwarding {ports}?", { ports: removing?.ports })}
        description={t("Deletes {kind} {name}. The elastic IP itself is kept.", { kind: removing?.item.kind || removing?.plural, name: removing?.item.metadata.name })}
        destructive
        confirmLabel={removing?.type === "fip" ? t("Unbind") : t("Remove")}
        onConfirm={async () => {
          if (!removing) return
          await requestJson(`${OVN_API}/${removing.plural}/${removing.item.metadata.name}`, { method: "DELETE" })
          load()
        }}
      />
    </Panel>
  )
}

/** Picks an elastic IP and creates a floating IP or DNAT rule for the instance, after confirmation. */
function BindDialog({ kind, engines, data, ips, ipName, vmName, subnet, onClose, onDone }: {
  kind: "fip" | "dnat"
  engines: NatEngine[]
  data: NatData
  ips: string[]
  ipName: string
  vmName: string
  subnet?: string
  onClose: () => void
  onDone: () => void
}) {
  const [engine, setEngine] = useState<NatEngine>(engines[0])
  const [eip, setEip] = useState("")
  const [internalIp, setInternalIp] = useState(ips[0] || "")
  const [protocol, setProtocol] = useState("tcp")
  const [externalPort, setExternalPort] = useState("")
  const [internalPort, setInternalPort] = useState("")
  const [error, setError] = useState("")
  const [confirming, setConfirming] = useState<{ plural: string; body: Record<string, unknown> } | null>(null)

  // VPC NAT gateway EIPs only work for instances in that gateway's VPC.
  const vpc = str(spec(data.subnets.find((item) => item.metadata.name === subnet) || ({ metadata: { name: "" } } as KubeObject)).vpc)
  const gatewaysInVpc = new Set(data.gateways.filter((gw) => !vpc || str(spec(gw).vpc) === vpc).map((gw) => gw.metadata.name))
  const eips = engine === "iptables" ? data.iptablesEips.filter((item) => !vpc || gatewaysInVpc.has(str(spec(item).natGwDp))) : data.ovnEips.filter((item) => str(status(item).type || spec(item).type, "nat") === "nat")
  // A floating IP needs an EIP nothing else uses; port forwards can share an EIP with other DNAT rules.
  const usable = eips.filter((item) => {
    const nat = str(status(item).nat)
    return kind === "fip" ? !nat : !nat || nat.split(",").every((use) => use.trim() === "dnat")
  })
  const options = usable.map((item) => ({ value: item.metadata.name, hint: [eipAddress(item), engine === "iptables" ? str(spec(item).natGwDp) : str(spec(item).externalSubnet)].filter(Boolean).join(" · ") }))

  const natKind = natKinds[engine][kind]!
  const ruleName = kind === "fip" ? `${vmName}-fip` : `${vmName}-${protocol}-${externalPort || "port"}`
  const values: Record<string, string> = engine === "iptables"
    ? { eip, internalIp, protocol, externalPort, internalPort }
    : { ovnEip: eip, ipType: "ip", ipName, vpc: "", v4Ip: "", type: "centralized", protocol, externalPort, internalPort }

  const review = () => {
    setError("")
    if (!eip) return setError(t("Choose an elastic IP."))
    const invalid = natKind.validate?.(values)
    if (invalid) return setError(invalid)
    setConfirming({ plural: natKind.plural, body: natManifest(natKind, ruleName.slice(0, 63).replace(/-+$/, ""), values) })
  }

  const address = eipAddress(eips.find((item) => item.metadata.name === eip))
  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{kind === "fip" ? t("Bind floating IP") : t("Add port forwarding")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {engines.length > 1 && (
              <FieldRow label={t("NAT engine")}>
                <div className="grid gap-2 sm:grid-cols-2">
                  {engines.map((item) => <ChoiceCard key={item} selected={engine === item} onClick={() => { setEngine(item); setEip("") }} title={t(natEngineLabel[item])} />)}
                </div>
              </FieldRow>
            )}
            <FieldRow label={t("Elastic IP")} hint={options.length === 0 ? <>{t("No free elastic IP.")} <Link to={engine === engines[0] ? "/vpc/elastic-ips" : `/vpc/elastic-ips?engine=${engine}`} className="text-primary hover:underline">{t("Create one")}</Link></> : undefined}>
              <Combobox value={eip} onChange={setEip} options={options} placeholder={t("Choose an elastic IP")} aria-label={t("Elastic IP")} className="w-full" />
            </FieldRow>
            {engine === "iptables" ? (
              <FieldRow label={t("Internal IP")}>
                <Combobox value={internalIp} onChange={setInternalIp} options={ips} aria-label={t("Internal IP")} className="w-full font-mono" />
              </FieldRow>
            ) : (
              <FieldRow label={t("IP name")} hint={t("IP object of this instance.")}>
                <Input value={ipName} readOnly className="font-mono" />
              </FieldRow>
            )}
            {kind === "dnat" && (
              <>
                <FieldRow label={t("Protocol")}>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {["tcp", "udp"].map((item) => <ChoiceCard key={item} selected={protocol === item} onClick={() => setProtocol(item)} title={item.toUpperCase()} />)}
                  </div>
                </FieldRow>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FieldRow label={t("External port")}><Input value={externalPort} onChange={(e) => setExternalPort(e.target.value.trim())} placeholder="2222" className="font-mono" /></FieldRow>
                  <FieldRow label={t("Internal port")}><Input value={internalPort} onChange={(e) => setInternalPort(e.target.value.trim())} placeholder="22" className="font-mono" /></FieldRow>
                </div>
              </>
            )}
            {error && <ErrorNote>{error}</ErrorNote>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>{t("Cancel")}</Button>
            <Button onClick={review}>{kind === "fip" ? t("Bind") : t("Add")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={kind === "fip"
          ? t("Bind {address} to {instance}?", { address: address || eip, instance: vmName })
          : t("Forward {address}:{external} to {instance}:{internal}?", { address: address || eip, external: externalPort, instance: vmName, internal: internalPort })}
        description={kind === "fip" ? t("All traffic to the elastic IP reaches the instance. Its security groups still apply.") : t("{protocol} traffic to this port reaches the instance. Its security groups still apply.", { protocol: protocol.toUpperCase() })}
        confirmLabel={kind === "fip" ? t("Bind") : t("Add")}
        onConfirm={async () => {
          if (!confirming) return
          await requestJson(`${OVN_API}/${confirming.plural}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(confirming.body) })
          toast.success(kind === "fip" ? t("Floating IP bound") : t("Port forwarding added"))
          onClose()
          onDone()
        }}
      />
    </>
  )
}
