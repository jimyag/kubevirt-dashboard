import { useState } from "react"
import { Link } from "react-router-dom"
import { Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ConfirmDialog, DataTable, EmptyState, FieldRow, NativeSelect, Panel } from "@/components/console"
import { asList, asRecord, kubeOvnAnnotations, listItems, str, useAsync, useNetworkProfile, type KubeObject } from "@/lib/kube"
import {
  addVmNic,
  bandwidthProblem,
  listAttachableNetworks,
  providerSwitchAnnotation,
  removeVmNic,
  setVmBandwidth,
  vmBandwidth,
  type AttachableNetwork,
  type Bandwidth,
} from "@/lib/vm-network"
import { t } from "@/lib/i18n"

type RuntimeInterface = { name?: string; ipAddress?: string; ipAddresses?: string[]; mac?: string }

const templateSpec = (vm: KubeObject) => asRecord(asRecord(asRecord(vm.spec).template).spec)
const templateAnnotations = (vm: KubeObject) => asRecord(asRecord(asRecord(asRecord(vm.spec).template).metadata).annotations)

/** Network interfaces of an instance, with extra Multus NICs that can be added and removed. */
export function InstanceInterfaces({ vm, runtime, onChanged }: { vm: KubeObject; runtime: RuntimeInterface[]; onChanged: () => void }) {
  const profile = useNetworkProfile()
  const [adding, setAdding] = useState(false)
  const [choice, setChoice] = useState("")
  const [removing, setRemoving] = useState<{ name: string; provider?: string } | null>(null)
  const { data: networks } = useAsync(async () => {
    const subnets = profile.kubeOvnInstalled ? await listItems("/apis/kubeovn.io/v1/subnets") : []
    return listAttachableNetworks(subnets)
  }, [] as AttachableNetwork[], [profile.kubeOvnInstalled])

  const spec = templateSpec(vm)
  const annotations = templateAnnotations(vm)
  const interfaces = asList(asRecord(asRecord(spec.domain).devices).interfaces)
  const networkOf = (name: string) => asList(spec.networks).find((network) => str(network.name) === name)
  // The Kube-OVN subnet of a Multus NIC comes from the <provider>.kubernetes.io/logical_switch annotation.
  const attachment = (name: string) => {
    const nad = str(asRecord(networkOf(name)?.multus).networkName)
    if (!nad) return null
    const qualified = nad.includes("/") ? nad : `${vm.metadata.namespace}/${nad}`
    const provider = networks.find((network) => network.nad === qualified && network.provider)?.provider
    const subnet = provider ? str(annotations[providerSwitchAnnotation(provider)]) : ""
    return { nad: qualified, provider, subnet }
  }
  const selected = networks.find((network) => network.value === choice) || networks[0]

  return (
    <Panel
      title={t("Network interfaces")}
      className="lg:col-span-2"
      actions={<Button size="sm" variant="outline" className="gap-1.5" disabled={networks.length === 0} onClick={() => setAdding(true)}><Plus className="size-4" />{t("Add interface")}</Button>}
    >
      <DataTable
        minWidth={700}
        rows={interfaces}
        rowKey={(iface) => str(iface.name)}
        empty={<EmptyState title={t("No interfaces declared")} />}
        columns={[
          { header: t("Interface"), cell: (iface) => <span className="font-medium">{str(iface.name)}</span> },
          { header: t("Binding"), cell: (iface) => <span className="text-sm">{Object.keys(iface).filter((key) => !["name", "model", "macAddress", "state"].includes(key)).join(", ") || "N/A"}</span> },
          {
            header: t("Network"),
            cell: (iface) => {
              const name = str(iface.name)
              const network = networkOf(name)
              if (!network) return <span className="text-sm text-muted-foreground">N/A</span>
              const multus = attachment(name)
              if (multus) {
                return multus.subnet
                  ? <div className="flex flex-col"><Link to={`/vpc/subnets/${multus.subnet}`} className="text-sm hover:text-primary transition-colors">{t("Subnet")} {multus.subnet}</Link><span className="text-xs text-muted-foreground">{multus.nad}</span></div>
                  : <span className="text-sm">{t("Multus")} {multus.nad}</span>
              }
              const subnet = str(annotations[kubeOvnAnnotations.logicalSwitch])
              return subnet ? <Link to={`/vpc/subnets/${subnet}`} className="text-sm hover:text-primary transition-colors">{t("Subnet")} {subnet}</Link> : <span className="text-sm">{t("Pod network")}</span>
            },
          },
          {
            header: t("IP addresses"),
            cell: (iface) => {
              const item = runtime.find((entry) => entry.name === str(iface.name))
              return <span className="font-mono text-xs">{item?.ipAddresses?.join(", ") || item?.ipAddress || "-"}</span>
            },
          },
          { header: t("MAC"), cell: (iface) => <span className="font-mono text-xs text-muted-foreground">{runtime.find((entry) => entry.name === str(iface.name))?.mac || "-"}</span> },
          {
            header: "",
            className: "w-20 text-right",
            cell: (iface) => {
              const multus = attachment(str(iface.name))
              return multus ? <Button size="sm" variant="ghost" onClick={() => setRemoving({ name: str(iface.name), provider: multus.provider })}>{t("Remove")}</Button> : null
            },
          },
        ]}
      />
      <ConfirmDialog
        open={adding}
        onOpenChange={(open) => {
          setAdding(open)
          if (!open) setChoice("")
        }}
        title={t("Add network interface to {name}?", { name: vm.metadata.name })}
        description={t("Adds a bridge interface on the chosen network. A running instance may need a restart to see it.")}
        confirmLabel={t("Add interface")}
        onConfirm={async () => {
          if (!selected) return
          await addVmNic(vm, selected)
          onChanged()
        }}
      >
        <FieldRow label={t("Network")}>
          <NativeSelect value={selected?.value || ""} onChange={(e) => setChoice(e.target.value)}>
            {networks.map((network) => (
              <option key={network.value} value={network.value}>
                {network.subnet ? t("Subnet {subnet} ({cidr})", { subnet: network.subnet, cidr: network.cidr }) : `${network.nad} (${network.cniType})`}
              </option>
            ))}
          </NativeSelect>
        </FieldRow>
      </ConfirmDialog>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t("Remove interface {nic} from {name}?", { nic: removing?.name, name: vm.metadata.name })}
        description={t("The guest loses this network. A running instance may need a restart to apply it.")}
        destructive
        confirmLabel={t("Remove")}
        onConfirm={async () => {
          if (!removing) return
          await removeVmNic(vm, removing.name, removing.provider)
          onChanged()
        }}
      />
    </Panel>
  )
}

/** Inbound and outbound bandwidth limits; Kube-OVN applies changes to a running instance live. */
export function BandwidthDialog({ open, onOpenChange, vm, onChanged }: { open: boolean; onOpenChange: (open: boolean) => void; vm: KubeObject; onChanged: () => void }) {
  const [draft, setDraft] = useState<Bandwidth>(() => vmBandwidth(vm))
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(vmBandwidth(vm))
        onOpenChange(next)
      }}
      title={t("Change bandwidth of {name}?", { name: vm.metadata.name })}
      description={t("Applies to the running instance immediately. Leave empty for unlimited.")}
      confirmLabel={t("Save")}
      onConfirm={async () => {
        if (bandwidthProblem(draft.ingress) || bandwidthProblem(draft.egress)) throw new Error(t("Bandwidth must be a whole number of Mbit/s, or empty for unlimited."))
        await setVmBandwidth(vm, draft)
        onChanged()
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FieldRow label={t("Inbound bandwidth (Mbit/s)")}><Input inputMode="numeric" value={draft.ingress} onChange={(e) => setDraft({ ...draft, ingress: e.target.value })} placeholder={t("Unlimited")} /></FieldRow>
        <FieldRow label={t("Outbound bandwidth (Mbit/s)")}><Input inputMode="numeric" value={draft.egress} onChange={(e) => setDraft({ ...draft, egress: e.target.value })} placeholder={t("Unlimited")} /></FieldRow>
      </div>
    </ConfirmDialog>
  )
}
