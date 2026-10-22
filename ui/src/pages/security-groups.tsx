import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom"
import { ArrowDownToLine, ArrowUpFromLine, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react"

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
  NativeSelect,
  PageHeader,
  StatusDot,
  Toolbar,
  Panel,
} from "@/components/console"
import { namespaceScope, useFilteredRows, type FilterField } from "@/lib/filter"
import {
  listItems,
  relativeTime,
  str,
  asRecord,
  useAsync,
  useNamespaces,
  type KubeObject,
} from "@/lib/kube"
import {
  createSecurityGroup,
  deleteSecurityGroup,
  emptyRule,
  getSecurityGroup,
  listSecurityGroups,
  remoteSummary,
  ruleProblem,
  ruleSummary,
  ruleTemplates,
  saveSecurityGroupRules,
  sgDetailPath,
  useSgProvider,
  setVmSecurityGroups,
  vmMatchesGroup,
  vmSecurityGroups,
  type SecurityGroup,
  type SgDirection,
  type SgProvider,
  type SgRule,
  engineLabel,
  engineResource,
  listAllSecurityGroups,
  setVmSecurityGroupRefs,
  sgRefKey,
  vmSecurityGroupRefs,
} from "@/lib/security-groups"
import { isDnsLabel } from "@/lib/validate"

const providerLabel = engineResource

const engineDescription: Record<SgProvider, string> = {
  cilium: "eBPF policy per namespace. Supports deny rules and cross-group references. Default on Kube-OVN + Cilium.",
  "kube-ovn": "OVN port ACLs, cluster wide, with explicit rule priorities. Requires port security on the instance.",
}

function ProviderNote({ provider }: { provider: SgProvider }) {
  return (
    <p className="text-xs text-muted-foreground">
      {provider === "kube-ovn" ? (
        <>OVN port ACLs, cluster wide. Attached via <code className="font-mono">ovn.kubernetes.io/security_groups</code>. Lower priority runs first.</>
      ) : (
        <>CiliumNetworkPolicy per namespace. Attached via label <code className="font-mono">sg.kubevirt-dashboard.io/&lt;name&gt;</code>. Inbound is denied unless allowed; deny wins.</>
      )}
    </p>
  )
}

// --- Rule editor ---

function RuleEditor({
  rules,
  direction,
  provider,
  groups,
  onChange,
}: {
  rules: SgRule[]
  direction: SgDirection
  provider: SgProvider
  groups: string[]
  onChange: (rules: SgRule[]) => void
}) {
  const visible = rules.map((rule, index) => ({ rule, index })).filter(({ rule }) => rule.direction === direction)
  const update = (index: number, patch: Partial<SgRule>) => onChange(rules.map((rule, i) => i === index ? { ...rule, ...patch } : rule))
  const columns = provider === "kube-ovn" ? "grid-cols-[110px_110px_130px_130px_1fr_90px_40px]" : "grid-cols-[110px_110px_130px_130px_1fr_40px]"
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <div className="min-w-[760px] space-y-2">
          <div className={cn("grid gap-2 px-1 text-xs font-semibold text-muted-foreground", columns)}>
            <span>Action</span><span>Protocol</span><span>Port range</span><span>{direction === "ingress" ? "Source" : "Destination"}</span><span />
            {provider === "kube-ovn" && <span>Priority</span>}
            <span />
          </div>
          {visible.map(({ rule, index }) => (
            <div key={index} className={cn("grid items-center gap-2", columns)}>
              <NativeSelect value={rule.action} onChange={(e) => update(index, { action: e.target.value as SgRule["action"] })}>
                <option value="allow">Allow</option>
                <option value="deny">Deny</option>
              </NativeSelect>
              <NativeSelect value={rule.protocol} onChange={(e) => update(index, { protocol: e.target.value as SgRule["protocol"], ports: e.target.value === "tcp" || e.target.value === "udp" ? rule.ports : "" })}>
                <option value="tcp">TCP</option>
                <option value="udp">UDP</option>
                <option value="icmp">ICMP</option>
                <option value="all">All</option>
              </NativeSelect>
              <Input
                value={rule.ports}
                disabled={rule.protocol === "all" || rule.protocol === "icmp"}
                onChange={(e) => update(index, { ports: e.target.value })}
                placeholder={rule.protocol === "all" || rule.protocol === "icmp" ? "N/A" : "22 or 8000-8100"}
              />
              <NativeSelect value={rule.remoteType} onChange={(e) => update(index, { remoteType: e.target.value as SgRule["remoteType"], remote: "" })}>
                <option value="any">Anywhere</option>
                <option value="cidr">CIDR block</option>
                <option value="group">Security group</option>
              </NativeSelect>
              {rule.remoteType === "cidr" ? (
                <Input className="font-mono text-xs" value={rule.remote} onChange={(e) => update(index, { remote: e.target.value })} placeholder="10.0.0.0/8" />
              ) : rule.remoteType === "group" ? (
                <NativeSelect value={rule.remote} onChange={(e) => update(index, { remote: e.target.value })}>
                  <option value="">Select a group</option>
                  {Array.from(new Set([rule.remote, ...groups].filter(Boolean))).map((group) => <option key={group} value={group}>{group}</option>)}
                </NativeSelect>
              ) : (
                <span className="px-1 text-sm text-muted-foreground">0.0.0.0/0, ::/0</span>
              )}
              {provider === "kube-ovn" && (
                <Input type="number" min={1} max={200} value={rule.priority} onChange={(e) => update(index, { priority: Number(e.target.value) })} />
              )}
              <Button size="icon" variant="ghost" aria-label="Remove rule" onClick={() => onChange(rules.filter((_, i) => i !== index))}>
                <Trash2 className="size-4 text-muted-foreground" />
              </Button>
            </div>
          ))}
        </div>
      </div>
      {visible.length === 0 && <p className="text-sm text-muted-foreground">No {direction === "ingress" ? "inbound" : "outbound"} rules.</p>}
      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onChange([...rules, { ...emptyRule(direction), ...(direction === "egress" ? { protocol: "all" as const, ports: "" } : {}) }])}>
        <Plus className="size-4" />Add {direction === "ingress" ? "inbound" : "outbound"} rule
      </Button>
    </div>
  )
}

function RuleTable({ rules, direction, provider }: { rules: SgRule[]; direction: SgDirection; provider: SgProvider }) {
  const visible = rules.filter((rule) => rule.direction === direction)
  return (
    <DataTable
      rows={visible.map((rule, index) => ({ rule, index }))}
      rowKey={({ index }) => String(index)}
      minWidth={560}
      empty={<EmptyState title={`No ${direction === "ingress" ? "inbound" : "outbound"} rules`} description={direction === "ingress" ? "Inbound traffic to attached instances is denied." : provider === "cilium" ? "Outbound traffic is not restricted." : "Outbound traffic follows the subnet default."} />}
      columns={[
        { header: "Action", cell: ({ rule }) => <Badge variant={rule.action === "allow" ? "success" : "danger"}>{rule.action === "allow" ? "Allow" : "Deny"}</Badge> },
        { header: "Protocol / ports", cell: ({ rule }) => <span className="text-sm">{ruleSummary(rule)}</span> },
        { header: direction === "ingress" ? "Source" : "Destination", cell: ({ rule }) => <span className="font-mono text-xs">{remoteSummary(rule)}</span> },
        ...(provider === "kube-ovn" ? [{ header: "Priority", cell: ({ rule }: { rule: SgRule }) => <span className="text-sm tabular-nums">{rule.priority}</span> }] : []),
      ]}
    />
  )
}

// --- Create dialog ---

function CreateSecurityGroupDialog({
  open,
  onOpenChange,
  providers,
  defaultProvider,
  defaultNamespace,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  providers: SgProvider[]
  defaultProvider: SgProvider
  defaultNamespace: string
  onCreated: (sg: { provider: SgProvider; name: string; namespace?: string }) => void
}) {
  const namespaces = useNamespaces()
  const [provider, setProvider] = useState(defaultProvider)
  const [name, setName] = useState("")
  const [namespace, setNamespace] = useState(defaultNamespace)
  const [description, setDescription] = useState("")
  const [template, setTemplate] = useState("ssh")
  const [allowSameGroup, setAllowSameGroup] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!open) return
    setNamespace(defaultNamespace)
    setProvider(defaultProvider)
  }, [defaultNamespace, defaultProvider, open])

  const submit = async () => {
    // The name also becomes a label key suffix (sg.kubevirt-dashboard.io/<name>) for Cilium.
    if (!isDnsLabel(name.trim())) {
      setError("Name must be at most 63 lowercase letters, digits and dashes.")
      return
    }
    setBusy(true)
    setError("")
    try {
      const rules = ruleTemplates.find((item) => item.id === template)?.rules || []
      await createSecurityGroup(provider, { name: name.trim(), namespace, description: description.trim(), rules, allowSameGroup })
      onOpenChange(false)
      onCreated({ provider, name: name.trim(), namespace: provider === "cilium" ? namespace : undefined })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create security group")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Create security group</DialogTitle>
          <DialogDescription>A stateful firewall for instances. Backed by {providerLabel[provider]}.</DialogDescription>
        </DialogHeader>
        {providers.length > 1 && (
          <div className="space-y-2">
            <div className="text-sm font-medium">Enforcement engine</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {providers.map((item) => (
                <ChoiceCard
                  key={item}
                  selected={provider === item}
                  onClick={() => setProvider(item)}
                  title={<span className="flex items-center gap-2">{engineLabel[item]}{item === defaultProvider && <Badge variant="outline">Default</Badge>}</span>}
                  description={engineDescription[item]}
                />
              ))}
            </div>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldRow label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="sg-web" /></FieldRow>
          {provider === "cilium" ? (
            <FieldRow label="Namespace" hint="Cilium groups apply to instances in this namespace.">
              <NativeSelect value={namespace} onChange={(e) => setNamespace(e.target.value)}>
                {Array.from(new Set([namespace, ...namespaces])).map((ns) => <option key={ns} value={ns}>{ns}</option>)}
              </NativeSelect>
            </FieldRow>
          ) : (
            <FieldRow label="Scope"><Input value="Cluster wide" disabled /></FieldRow>
          )}
          <div className="sm:col-span-2">
            <FieldRow label="Description"><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Web tier" /></FieldRow>
          </div>
        </div>
        <div className="space-y-2">
          <div className="text-sm font-medium">Start from a template</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {ruleTemplates.map((item) => (
              <ChoiceCard key={item.id} selected={template === item.id} onClick={() => setTemplate(item.id)} title={item.label} description={item.description} />
            ))}
          </div>
        </div>
        <label className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <div>
            <div className="text-sm font-medium">Allow traffic between members</div>
            <div className="text-xs text-muted-foreground">Instances in this group can reach each other on all ports.</div>
          </div>
          <Switch checked={allowSameGroup} onCheckedChange={setAllowSameGroup} />
        </label>
        {error && <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm break-all">{error}</div>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !name.trim() || (provider === "cilium" && !namespace)}>{busy ? "Creating..." : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// --- List ---

type GroupRow = { sg: SecurityGroup; instances: number }

const groupFields: FilterField<GroupRow>[] = [
  { key: "name", label: "Name", value: (row) => row.sg.name },
  { key: "description", label: "Description", aliases: ["desc"], value: (row) => row.sg.description },
  { key: "namespace", label: "Namespace", aliases: ["ns"], value: (row) => row.sg.namespace },
  { key: "type", label: "Type", value: (row) => (row.sg.managed ? "Security group" : `Policy ${row.sg.selector}`) },
  { key: "instances", label: "Instances", value: (row) => row.instances },
]

export function SecurityGroupListPage() {
  const { provider: defaultProvider, providers, loaded } = useSgProvider()
  const [searchParams, setSearchParams] = useSearchParams()
  const requested = searchParams.get("engine") as SgProvider | null
  const provider = requested && providers.includes(requested) ? requested : defaultProvider
  const navigate = useNavigate()
  const namespaces = useNamespaces()
  const [namespace, setNamespace] = useState("")
  const ns = useMemo(() => namespaceScope(namespace, namespaces), [namespace, namespaces])
  const scope = ns.scope
  const [search, setSearch] = useState("")
  const [createOpen, setCreateOpen] = useState(false)
  const [deleting, setDeleting] = useState<SecurityGroup | null>(null)

  const { data, loading, reload } = useAsync(async () => {
    if (!provider) return { groups: [] as SecurityGroup[], vms: [] as KubeObject[] }
    const [groups, vms] = await Promise.all([
      listSecurityGroups(provider, scope),
      listItems("/apis/kubevirt.io/v1/virtualmachines"),
    ])
    return { groups, vms }
  }, { groups: [] as SecurityGroup[], vms: [] as KubeObject[] }, [provider, scope])

  const allRows = useMemo(() => data.groups
    .filter((sg) => provider !== "cilium" || ns.match(sg.namespace))
    .map((sg): GroupRow => ({ sg, instances: data.vms.filter((vm) => vmMatchesGroup(vm, sg)).length })), [data, ns, provider])
  const rows = useFilteredRows(allRows, groupFields, search)

  if (!loaded) return <LoadingState />
  if (!provider) {
    return (
      <div className="space-y-4">
        <PageHeader title="Security Groups" />
        <div className="rounded-lg border bg-card">
            <EmptyState
              icon={ShieldCheck}
              title="Security groups need Kube-OVN or Cilium"
              description="The current network stack enforces access control with Kubernetes NetworkPolicy. Install Kube-OVN or Cilium, or pick a different network stack in Settings."
              action={
                <div className="flex gap-2">
                  <Button asChild size="sm" variant="outline"><Link to="/networks/kubernetes/network-policies">Network policies</Link></Button>
                  <Button asChild size="sm"><Link to="/settings">Settings</Link></Button>
                </div>
              }
            />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Security Groups"
        badge={providers.length === 1 ? <Badge variant="outline">{providerLabel[provider]}</Badge> : undefined}
        actions={<Button onClick={() => setCreateOpen(true)} className="gap-1.5"><Plus className="size-4" />Create security group</Button>}
      />
      {providers.length > 1 && (
        <div className="flex flex-wrap gap-1 border-b">
          {providers.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setSearchParams(item === defaultProvider ? {} : { engine: item })}
              className={cn(
                "flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
                provider === item ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {engineLabel[item]}
              <span className="text-xs font-normal text-muted-foreground">{engineResource[item]}</span>
              {item === defaultProvider && <Badge variant="outline">Default</Badge>}
            </button>
          ))}
        </div>
      )}
      <ProviderNote provider={provider} />
      <Toolbar
        right={<FilterInput value={search} onChange={setSearch} fields={provider === "cilium" ? groupFields : groupFields.filter((field) => field.key !== "namespace")} rows={allRows} />}
      >
        <Button size="sm" variant="outline" onClick={reload} className="gap-2"><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />Refresh</Button>
        {provider === "cilium" && (
          <Combobox value={namespace} onChange={setNamespace} options={namespaces} placeholder="All namespaces" aria-label="Namespace" />
        )}
      </Toolbar>
      <DataTable<GroupRow>
        loading={loading}
        rows={rows}
        rowKey={({ sg }) => `${sg.namespace || ""}/${sg.name}`}
        empty={<EmptyState icon={ShieldCheck} title={allRows.length ? "No matching security groups" : "No security groups"} action={<Button size="sm" onClick={() => setCreateOpen(true)}>Create security group</Button>} />}
        columns={[
          {
            header: "Name",
            cell: ({ sg }) => (
              <div className="flex flex-col">
                <Link to={sgDetailPath(sg)} className="font-medium hover:text-primary transition-colors">{sg.name}</Link>
                {sg.description && <span className="text-xs text-muted-foreground">{sg.description}</span>}
              </div>
            ),
          },
          ...(provider === "cilium" ? [{ header: "Namespace", cell: ({ sg }: GroupRow) => <span className="text-sm text-muted-foreground">{sg.namespace}</span> }] : []),
          { header: "Inbound", cell: ({ sg }) => <span className="text-sm tabular-nums">{sg.rules.filter((rule) => rule.direction === "ingress").length}</span> },
          { header: "Outbound", cell: ({ sg }) => <span className="text-sm tabular-nums">{sg.rules.filter((rule) => rule.direction === "egress").length}</span> },
          { header: "Instances", cell: ({ instances }) => <span className="text-sm tabular-nums">{instances}</span> },
          {
            header: "Type",
            cell: ({ sg }) => sg.managed
              ? <Badge variant="outline">Security group</Badge>
              : <Badge variant="outline" className="text-muted-foreground">Policy ({sg.selector})</Badge>,
          },
          { header: "Created", className: "text-right", cell: ({ sg }) => <span className="text-sm text-muted-foreground tabular-nums">{relativeTime(sg.raw.metadata.creationTimestamp)}</span> },
          {
            header: "",
            className: "w-12 text-right",
            cell: ({ sg }) => <Button size="icon" variant="ghost" aria-label={`Delete ${sg.name}`} onClick={() => setDeleting(sg)}><Trash2 className="size-4 text-muted-foreground" /></Button>,
          },
        ]}
      />
      <CreateSecurityGroupDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        providers={providers}
        defaultProvider={provider}
        defaultNamespace={scope === "all" ? "default" : scope}
        onCreated={(sg) => navigate(sgDetailPath(sg))}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete security group ${deleting?.name}?`}
        description="Instances attached to this group lose its rules immediately."
        destructive
        confirmLabel="Delete"
        onConfirm={async () => {
          if (deleting) await deleteSecurityGroup(deleting)
          reload()
        }}
      />
    </div>
  )
}

// --- Detail ---

export function SecurityGroupDetailPage() {
  const { provider: routeProvider, namespace, name = "" } = useParams()
  const provider = (routeProvider === "cilium" ? "cilium" : "kube-ovn") as SgProvider
  const navigate = useNavigate()
  const [tab, setTab] = useState<"ingress" | "egress" | "instances">("ingress")
  const [draft, setDraft] = useState<{ rules: SgRule[]; allowSameGroup: boolean } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [bindOpen, setBindOpen] = useState(false)

  const { data, loading, reload } = useAsync(async () => {
    const [sg, peers, vms] = await Promise.all([
      getSecurityGroup(provider, name, namespace),
      listSecurityGroups(provider, namespace),
      listItems(provider === "cilium" ? `/apis/kubevirt.io/v1/namespaces/${namespace}/virtualmachines` : "/apis/kubevirt.io/v1/virtualmachines"),
    ])
    return { sg, peers: peers.filter((peer) => peer.managed).map((peer) => peer.name), vms }
  }, { sg: null as SecurityGroup | null, peers: [] as string[], vms: [] as KubeObject[] }, [provider, name, namespace])

  if (loading && !data.sg) return <LoadingState />
  if (!data.sg) return <EmptyState icon={ShieldCheck} title="Security group not found" action={<Button asChild variant="outline" size="sm"><Link to="/vpc/security-groups">Back to security groups</Link></Button>} />

  const sg = data.sg
  const members = data.vms.filter((vm) => vmMatchesGroup(vm, sg))
  const editable = sg.unsupported === 0
  const rules = draft?.rules ?? sg.rules

  const save = async () => {
    if (!draft) return
    const problem = draft.rules.map(ruleProblem).find(Boolean)
    if (problem) {
      setError(problem)
      return
    }
    setSaving(true)
    setError("")
    try {
      await saveSecurityGroupRules(sg, draft.rules.map((rule) => ({ ...rule, ports: rule.ports.trim(), remote: rule.remote.trim() })), draft.allowSameGroup)
      setDraft(null)
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save rules")
    } finally {
      setSaving(false)
    }
  }

  const tabs = [
    { id: "ingress" as const, label: `Inbound rules (${rules.filter((rule) => rule.direction === "ingress").length})`, icon: ArrowDownToLine },
    { id: "egress" as const, label: `Outbound rules (${rules.filter((rule) => rule.direction === "egress").length})`, icon: ArrowUpFromLine },
    { id: "instances" as const, label: `Instances (${members.length})`, icon: ShieldCheck },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: "Security Groups", to: provider === "kube-ovn" ? "/vpc/security-groups?engine=kube-ovn" : "/vpc/security-groups" }, ...(sg.namespace ? [{ label: sg.namespace }] : []), { label: sg.name }]}
        title={sg.name}
        subtitle={sg.description || undefined}
        badge={<Badge variant="outline">{providerLabel[provider]}</Badge>}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={reload} className="gap-2"><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />Refresh</Button>
            <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>Delete</Button>
          </>
        }
      />
      <Panel title="Basic information">
          <KeyValueGrid items={[
            { label: "Name", value: sg.name },
            { label: "Scope", value: sg.namespace ? `Namespace ${sg.namespace}` : "Cluster wide" },
            { label: "Backed by", value: providerLabel[provider] },
            { label: "Applies to", value: <span className="font-mono text-xs">{sg.selector}</span> },
            { label: "Traffic between members", value: sg.allowSameGroup ? "Allowed" : "Follows rules" },
            { label: "Created", value: relativeTime(sg.raw.metadata.creationTimestamp) },
          ]} />
        </Panel>
      <ProviderNote provider={provider} />
      {!editable && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800 dark:border-yellow-800 dark:bg-yellow-950/50 dark:text-yellow-300">
          This policy contains {sg.unsupported} rule{sg.unsupported > 1 ? "s" : ""} this editor cannot represent (L7, FQDN or custom selectors). Edit it from the <Link className="underline" to={`/networks/cilium/network-policies/${sg.namespace}/${sg.name}/manifest`}>manifest</Link>.
        </div>
      )}

      <div className="flex flex-wrap gap-1 border-b">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              tab === item.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </button>
        ))}
      </div>

      {tab !== "instances" ? (
        <Panel
          title={tab === "ingress" ? "Inbound rules" : "Outbound rules"}
          bodyClassName="space-y-3"
          actions={editable && (
                <div className="flex gap-2">
                  {draft ? (
                    <>
                      <Button size="sm" variant="outline" onClick={() => { setDraft(null); setError("") }}>Cancel</Button>
                      <Button size="sm" onClick={save} disabled={saving}>{saving ? "Saving..." : "Save rules"}</Button>
                    </>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => setDraft({ rules: sg.rules, allowSameGroup: sg.allowSameGroup })}>Edit rules</Button>
                  )}
                </div>
          )}
        >
            {draft ? (
              <>
                <RuleEditor rules={draft.rules} direction={tab} provider={provider} groups={data.peers} onChange={(next) => setDraft({ ...draft, rules: next })} />
                {tab === "ingress" && (
                  <label className="flex items-center justify-between gap-3 rounded-lg border p-3">
                    <div>
                      <div className="text-sm font-medium">Allow traffic between members</div>
                      <div className="text-xs text-muted-foreground">Instances in this group can reach each other on all ports.</div>
                    </div>
                    <Switch checked={draft.allowSameGroup} onCheckedChange={(checked) => setDraft({ ...draft, allowSameGroup: checked })} />
                  </label>
                )}
              </>
            ) : (
              <RuleTable rules={sg.rules} direction={tab} provider={provider} />
            )}
            {error && <ErrorNote>{error}</ErrorNote>}
        </Panel>
      ) : (
        <div className="space-y-3">
          {sg.managed && (
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setBindOpen(true)} className="gap-1.5"><Plus className="size-4" />Attach instances</Button>
            </div>
          )}
          <DataTable
            rows={members}
            rowKey={(vm) => `${vm.metadata.namespace}/${vm.metadata.name}`}
            minWidth={560}
            empty={<EmptyState title="No attached instances" />}
            columns={[
              { header: "Instance", cell: (vm) => <Link to={`/kubevirt/virtualization/virtual-machines/${vm.metadata.namespace}/${vm.metadata.name}/overview`} className="font-medium hover:text-primary transition-colors">{vm.metadata.name}</Link> },
              { header: "Namespace", cell: (vm) => <span className="text-sm text-muted-foreground">{vm.metadata.namespace}</span> },
              { header: "Status", cell: (vm) => <StatusDot status={str(asRecord(vm.status).printableStatus)} /> },
              {
                header: "",
                className: "text-right",
                cell: (vm) => sg.managed ? (
                  <Button size="sm" variant="ghost" onClick={async () => {
                    await setVmSecurityGroups(vm, provider, vmSecurityGroups(vm, provider).filter((group) => group !== sg.name))
                    reload()
                  }}>Detach</Button>
                ) : null,
              },
            ]}
          />
        </div>
      )}

      <AttachInstancesDialog
        open={bindOpen}
        onOpenChange={setBindOpen}
        sg={sg}
        vms={data.vms.filter((vm) => !vmMatchesGroup(vm, sg))}
        onDone={reload}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete security group ${sg.name}?`}
        description={`${members.length} attached instance${members.length === 1 ? "" : "s"} lose this group's rules immediately.`}
        destructive
        confirmLabel="Delete"
        onConfirm={async () => {
          await deleteSecurityGroup(sg)
          navigate("/vpc/security-groups")
        }}
      />
    </div>
  )
}

function AttachInstancesDialog({ open, onOpenChange, sg, vms, onDone }: { open: boolean; onOpenChange: (open: boolean) => void; sg: SecurityGroup; vms: KubeObject[]; onDone: () => void }) {
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const key = (vm: KubeObject) => `${vm.metadata.namespace}/${vm.metadata.name}`
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => { if (!next) setSelected({}); onOpenChange(next) }}
      title={`Attach instances to ${sg.name}`}
      description="Updates the instance template and its running pod. Instances that cannot be updated live pick up the change on next restart."
      confirmLabel="Attach"
      onConfirm={async () => {
        const targets = vms.filter((vm) => selected[key(vm)])
        await Promise.all(targets.map((vm) => setVmSecurityGroups(vm, sg.provider, Array.from(new Set([...vmSecurityGroups(vm, sg.provider), sg.name])))))
        setSelected({})
        onDone()
      }}
    >
      <div className="max-h-72 space-y-1 overflow-y-auto">
        {vms.length === 0 && <p className="text-sm text-muted-foreground">No other instances available{sg.namespace ? ` in ${sg.namespace}` : ""}.</p>}
        {vms.map((vm) => (
          <label key={key(vm)} className="flex items-center gap-3 rounded-lg border p-2 text-sm hover:bg-muted/50">
            <input type="checkbox" className="size-4 accent-primary" checked={Boolean(selected[key(vm)])} onChange={(e) => setSelected((current) => ({ ...current, [key(vm)]: e.target.checked }))} />
            <span className="font-medium">{vm.metadata.name}</span>
            <span className="text-muted-foreground">{vm.metadata.namespace}</span>
          </label>
        ))}
      </div>
    </ConfirmDialog>
  )
}

/** Dialog used from the instance detail page to choose its security groups. */
export function InstanceSecurityGroupsDialog({ open, onOpenChange, vm, onDone }: { open: boolean; onOpenChange: (open: boolean) => void; vm: KubeObject; onDone: () => void }) {
  const { providers } = useSgProvider()
  const [groups, setGroups] = useState<SecurityGroup[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const providerKey = providers.join(",")
  useEffect(() => {
    if (!open || providerKey === "") return
    const engines = providerKey.split(",") as SgProvider[]
    listAllSecurityGroups(engines, vm.metadata.namespace).then((items) => {
      setGroups(items.filter((item) => item.managed))
      setSelected(vmSecurityGroupRefs(vm, engines).map(sgRefKey))
    })
  }, [open, providerKey, vm])
  if (providers.length === 0) return null
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Change security groups"
      description={providers.length > 1 ? "Pick groups from either engine. Cilium and Kube-OVN rules both apply when an instance uses groups from both." : "Updates the instance template and its running pod."}
      confirmLabel="Save"
      onConfirm={async () => {
        const refs = groups.filter((sg) => selected.includes(sgRefKey(sg))).map((sg) => ({ provider: sg.provider, name: sg.name }))
        await setVmSecurityGroupRefs(vm, providers, refs)
        onDone()
      }}
    >
      <div className="max-h-80 space-y-3 overflow-y-auto">
        {groups.length === 0 && <p className="text-sm text-muted-foreground">No security groups available. <Link to="/vpc/security-groups" className="text-primary hover:underline">Create one</Link>.</p>}
        {providers.map((engine) => {
          const items = groups.filter((sg) => sg.provider === engine)
          if (items.length === 0) return null
          return (
            <div key={engine} className="space-y-1">
              {providers.length > 1 && <div className="text-xs font-semibold text-muted-foreground">{engineLabel[engine]}</div>}
              {items.map((sg) => {
                const key = sgRefKey(sg)
                return (
                  <label key={key} className="flex items-center gap-3 rounded-lg border p-2 text-sm hover:bg-muted/50">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={selected.includes(key)}
                      onChange={(e) => setSelected((current) => e.target.checked ? [...current, key] : current.filter((item) => item !== key))}
                    />
                    <span className="font-medium">{sg.name}</span>
                    <span className="truncate text-muted-foreground">{sg.description || `${sg.rules.length} rules`}</span>
                  </label>
                )
              })}
            </div>
          )
        })}
      </div>
    </ConfirmDialog>
  )
}

