import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import * as YAML from "js-yaml"
import {
  AlertTriangle,
  ChevronDown,
  Copy,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { relativeTime } from "@/lib/kube"
import { ConfirmDialog, EmptyState, ErrorNote, LoadingState, NativeSelect, PageHeader, StatusDot, Toolbar } from "@/components/console"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  apiVersionFromListPath,
  expandListPaths as listPaths,
  resourceNameFromListPath,
  resourcePathFromListPath,
} from "@/resources/api-paths"
import { RelatedPodsCard, type PodSummary } from "@/components/pod-access"

type KubeResource = {
  apiVersion?: string
  kind?: string
  metadata: {
    name: string
    namespace?: string
    uid?: string
    creationTimestamp?: string
    labels?: Record<string, string>
    annotations?: Record<string, string>
    ownerReferences?: Array<{ apiVersion?: string; kind?: string; name?: string; uid?: string; controller?: boolean }>
  }
  spec?: Record<string, unknown>
  status?: Record<string, unknown>
  [key: string]: unknown
}

export type CreateFormField = {
  name: string
  label: string
  section?: string
  type?: "text" | "number" | "textarea" | "select" | "checkbox"
  defaultValue?: string | boolean | ((resource: KubeResource) => string | boolean)
  placeholder?: string
  required?: boolean
  options?: Array<{ label: string; value: string }>
  description?: string
}

export type DetailSection = {
  title: string
  description?: string
  items: Array<{ label: string; value: unknown; fullWidth?: boolean }>
}

export type ResourceAction = {
  id: string
  label: string
  description?: string
  fields?: CreateFormField[]
  confirmLabel?: string
  variant?: "default" | "outline" | "destructive" | "secondary"
  buildRequest: (resource: KubeResource, values: Record<string, string | boolean>) => {
    url: string
    options?: RequestInit
    navigateTo?: string
  }
}

export type ResourceConfig = {
  id: string
  path: string
  title: string
  subtitle: string
  listPath: string
  listPathAlternates?: string[]
  namespaced: boolean
  resourcePath: string
  resourcePathAlternates?: string[]
  kind: string
  createTemplate: string
  allowCreate?: boolean
  allowDelete?: boolean
  createFields?: CreateFormField[]
  buildCreateResource?: (values: Record<string, string | boolean>) => KubeResource | KubeResource[]
  createResourcePath?: (resource: KubeResource) => string
  detailSections?: (resource: KubeResource) => DetailSection[]
  actions?: ResourceAction[]
  statusPath?: string[]
  extraColumns?: Array<{
    label: string
    value: (resource: KubeResource) => string
  }>
}

const getContext = () => localStorage.getItem("kube-context") || ""

const apiFetch = (url: string, options: RequestInit = {}) => {
  const ctx = getContext()
  const headers = new Headers(options.headers || {})
  if (ctx) headers.set("X-Kube-Context", ctx)
  return fetch(url, { ...options, headers })
}

type ServedPath = {
  listPath: string
  resourcePath: string
  apiVersion: string
}

type DiscoveryData = {
  apiVersions: string[]
  apiResources: Array<{ name: string; apiVersion: string }>
}

type DiscoveryIndex = {
  apiVersions: Set<string>
  apiResources: Set<string>
}

const discoveryCache = new Map<string, Promise<DiscoveryIndex>>()

const cacheKey = (path: string) => `${getContext()}\n${path}`

const getDiscoveryIndex = () => {
  const key = cacheKey("discovery")
  const cached = discoveryCache.get(key)
  if (cached) return cached

  const request = apiFetch("/api/v1/discovery")
    .then(async (response) => {
      if (!response.ok) throw new Error(await response.text())
      const data = await response.json() as DiscoveryData
      return {
        apiVersions: new Set(data.apiVersions || []),
        apiResources: new Set((data.apiResources || []).map((resource) => `${resource.apiVersion}/${resource.name}`)),
      }
    })

  discoveryCache.set(key, request)
  return request
}

const servedPaths = async (config: ResourceConfig): Promise<ServedPath[]> => {
  const discovery = await getDiscoveryIndex()
  return listPaths(config).filter((path) => {
    const apiVersion = apiVersionFromListPath(path)
    const resourceName = resourceNameFromListPath(path, config.id)
    return discovery.apiVersions.has(apiVersion) && discovery.apiResources.has(`${apiVersion}/${resourceName}`)
  }).map((listPath) => ({
    listPath,
    resourcePath: resourcePathFromListPath(listPath),
    apiVersion: apiVersionFromListPath(listPath),
  }))
}

const resourcePathUrl = (config: ResourceConfig, basePath: string, name: string, namespace?: string) => {
  const nsPath = config.namespaced ? `/namespaces/${namespace}` : ""
  return `${basePath}${nsPath}/${config.id}/${name}`
}

const resourceListUrl = (config: ResourceConfig, path: ServedPath, namespace: string) =>
  config.namespaced && namespace !== "all"
    ? `${path.resourcePath}/namespaces/${namespace}/${config.id}`
    : path.listPath

const createPathUrl = (config: ResourceConfig, basePath: string, resource: KubeResource) =>
  config.namespaced
    ? `${basePath}/namespaces/${resource.metadata.namespace}/${config.id}`
    : `${basePath}/${config.id}`

const getValue = (obj: unknown, path?: string[]) => {
  if (!path) return undefined
  return path.reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") return undefined
    return (current as Record<string, unknown>)[key]
  }, obj)
}

const compactValue = (value: unknown): string => {
  if (value === undefined || value === null || value === "") return "N/A"
  if (typeof value === "boolean") return value ? "true" : "false"
  if (Array.isArray(value)) return value.length ? value.map(compactValue).join(", ") : "None"
  if (typeof value === "object") return `${Object.keys(value as Record<string, unknown>).length} fields`
  return String(value)
}

const isPrimitiveDetailValue = (value: unknown) =>
  value === undefined ||
  value === null ||
  ["string", "number", "boolean"].includes(typeof value)


const isRecordValue = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value)

const detailObjectTitle = (value: Record<string, unknown>, fallback: string) => {
  const title = value.name || value.type || value.action || value.protocol || value.kind || value.id
  return isPrimitiveDetailValue(title) && title !== undefined && title !== null && title !== "" ? compactValue(title) : fallback
}

const asRecord = (value: unknown) => isRecordValue(value) ? value : {}
const asRecordList = (value: unknown) => Array.isArray(value) ? value.filter(isRecordValue) : []
const joinList = (value: unknown) => Array.isArray(value) ? value.map(compactValue).join(", ") : compactValue(value)
const objectLabels = (value: unknown) => Object.entries(asRecord(value)).map(([key, next]) => `${key}=${compactValue(next)}`)
const resourceKeys = (value: Record<string, unknown>) => Object.keys(value).filter((key) => key !== "name" && hasRenderableValue(value[key]))
const hasRenderableValue = (value: unknown) => !(value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0))

function CompactKvTable({ rows }: { rows: Array<{ label: string; value: unknown }> }) {
  const visible = rows.filter((row) => hasRenderableValue(row.value))
  if (visible.length === 0) return <span className="text-sm text-muted-foreground">None</span>
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableBody>
          {visible.map((row) => (
            <TableRow key={row.label} className="hover:bg-muted/50">
              <TableCell className="w-44 py-2 text-xs font-medium text-muted-foreground">{row.label}</TableCell>
              <TableCell className="min-w-0 py-2 text-sm text-foreground">
                {isPrimitiveDetailValue(row.value) ? compactValue(row.value) : <DetailValue value={row.value} depth={2} />}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function ChipList({ values }: { values: unknown[] }) {
  if (values.length === 0) return <span className="text-sm text-muted-foreground">None</span>
  return (
    <div className="flex min-w-0 flex-wrap gap-1.5">
      {values.slice(0, 20).map((item, index) => (
        <span key={`${compactValue(item)}-${index}`} className="min-w-0 max-w-full break-words rounded-md border bg-muted px-2 py-1 text-xs text-foreground">
          {compactValue(item)}
        </span>
      ))}
      {values.length > 20 && <span className="text-xs text-muted-foreground">+{values.length - 20} more</span>}
    </div>
  )
}

function DetailContainerTable({ containers, statuses }: { containers: Record<string, unknown>[]; statuses?: Record<string, unknown>[] }) {
  if (containers.length === 0) return <span className="text-sm text-muted-foreground">No containers</span>
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table className="min-w-[880px]">
        <TableHeader className="bg-muted/60">
          <TableRow>
            <TableHead className="h-9 text-xs font-medium text-muted-foreground">Name</TableHead>
            <TableHead className="h-9 text-xs font-medium text-muted-foreground">Image</TableHead>
            <TableHead className="h-9 text-xs font-medium text-muted-foreground">Ready</TableHead>
            <TableHead className="h-9 text-xs font-medium text-muted-foreground">Restarts</TableHead>
            <TableHead className="h-9 text-xs font-medium text-muted-foreground">Ports</TableHead>
            <TableHead className="h-9 text-xs font-medium text-muted-foreground">Resources</TableHead>
            <TableHead className="h-9 text-xs font-medium text-muted-foreground">Args</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {containers.map((container) => {
            const status = statuses?.find((item) => item.name === container.name) || {}
            const resources = asRecord(container.resources)
            const requests = asRecord(resources.requests)
            const limits = asRecord(resources.limits)
            const ports = asRecordList(container.ports)
            return (
              <TableRow key={String(container.name)} className="hover:bg-muted/50">
                <TableCell className="font-semibold">{compactValue(container.name)}</TableCell>
                <TableCell className="max-w-[260px] break-all text-xs text-muted-foreground">{compactValue(container.image)}</TableCell>
                <TableCell><Badge variant={status.ready ? "success" : "outline"}>{compactValue(status.ready)}</Badge></TableCell>
                <TableCell className="tabular-nums">{compactValue(status.restartCount ?? 0)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {ports.length ? ports.map((port) => `${compactValue(port.containerPort || port.port)}/${compactValue(port.protocol || "TCP")}`).join(", ") : "None"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {[Object.keys(requests).length ? `req ${objectLabels(requests).join(", ")}` : "", Object.keys(limits).length ? `lim ${objectLabels(limits).join(", ")}` : ""].filter(Boolean).join(" / ") || "None"}
                </TableCell>
                <TableCell className="max-w-[280px] text-xs text-muted-foreground">
                  <div className="line-clamp-3 break-words">{joinList(container.args) || joinList(container.command) || "None"}</div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function DetailVolumeTable({ volumes }: { volumes: Record<string, unknown>[] }) {
  if (volumes.length === 0) return <span className="text-sm text-muted-foreground">No volumes</span>
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table className="min-w-[720px]">
        <TableHeader className="bg-muted/60">
          <TableRow>
            <TableHead className="h-9 text-xs font-medium text-muted-foreground">Name</TableHead>
            <TableHead className="h-9 text-xs font-medium text-muted-foreground">Type</TableHead>
            <TableHead className="h-9 text-xs font-medium text-muted-foreground">Source</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {volumes.map((volume) => {
            const type = resourceKeys(volume)[0] || "volume"
            const source = asRecord(volume[type])
            return (
              <TableRow key={String(volume.name)} className="hover:bg-muted/50">
                <TableCell className="font-semibold">{compactValue(volume.name)}</TableCell>
                <TableCell>{type}</TableCell>
                <TableCell className="break-words text-xs text-muted-foreground">
                  {Object.keys(source).length ? objectLabels(source).join(", ") : compactValue(volume[type])}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function DetailSimpleObjectTable({ rows }: { rows: Record<string, unknown>[] }) {
  const keys = Array.from(new Set(rows.flatMap((row) => Object.keys(row).filter((key) => isPrimitiveDetailValue(row[key]))))).slice(0, 6)
  if (keys.length === 0) return <ChipList values={rows.map((row, index) => detailObjectTitle(row, `Item ${index + 1}`))} />
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table className="min-w-[640px]">
        <TableHeader className="bg-muted/60">
          <TableRow>{keys.map((key) => <TableHead key={key} className="text-xs">{key}</TableHead>)}</TableRow>
        </TableHeader>
        <TableBody>
          {rows.slice(0, 12).map((row, index) => (
            <TableRow key={index} className="hover:bg-muted/50">
              {keys.map((key) => <TableCell key={key} className="max-w-[220px] break-words text-xs">{compactValue(row[key])}</TableCell>)}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length > 12 && <div className="border-t px-3 py-2 text-xs text-muted-foreground">+{rows.length - 12} more</div>}
    </div>
  )
}

function DetailValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (isPrimitiveDetailValue(value)) {
    return <span>{compactValue(value)}</span>
  }

  if (depth > 4) {
    return (
      <pre className="max-h-56 max-w-full overflow-auto rounded-lg border bg-muted/30 p-3 text-xs text-foreground whitespace-pre-wrap break-words">
        {YAML.dump(value, { noRefs: true, lineWidth: 120 })}
      </pre>
    )
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <span>None</span>

    const conditionLike = value.every((item) => isRecordValue(item) && "type" in item)
    if (conditionLike) {
      return (
        <div className="divide-y rounded-md border">
          {value.map((item, index) => {
            const condition = item as Record<string, unknown>
            return (
              <div key={`${String(condition.type || "condition")}-${index}`} className="px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-foreground">{compactValue(condition.type)}</span>
                  <StatusDot status={compactValue(condition.status)} />
                </div>
                {Boolean(condition.reason || condition.message) && (
                  <p className="mt-1 break-words text-xs text-muted-foreground">
                    {[condition.reason, condition.message].filter(Boolean).map(compactValue).join(" - ")}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )
    }

    const objectLike = value.every((item) => isRecordValue(item))
    if (objectLike) {
      const records = value as Record<string, unknown>[]
      if (records.every((item) => "image" in item && "name" in item)) {
        return <DetailContainerTable containers={records} />
      }
      if (records.every((item) => "name" in item && resourceKeys(item).length > 0) && records.some((item) => ["hostPath", "persistentVolumeClaim", "configMap", "secret", "emptyDir", "projected", "downwardAPI", "csi"].some((key) => key in item))) {
        return <DetailVolumeTable volumes={records} />
      }
      if (records.every((item) => "key" in item || "effect" in item || "operator" in item)) {
        return <DetailSimpleObjectTable rows={records} />
      }
      if (records.every((item) => Object.values(item).every((next) => isPrimitiveDetailValue(next)))) {
        return <DetailSimpleObjectTable rows={records} />
      }
      return (
        <div className="grid gap-2">
          {value.slice(0, 12).map((item, index) => {
            const record = item as Record<string, unknown>
            const entries = Object.entries(record)
            return (
              <div key={index} className="min-w-0 max-w-full rounded-lg border bg-muted/30 px-3 py-2">
                <div className="mb-2 min-w-0 break-words text-xs font-semibold text-foreground">
                  {detailObjectTitle(record, `Item ${index + 1}`)}
                </div>
                <div className="grid min-w-0 gap-1.5">
                  {entries.map(([key, nextValue]) => (
                    <div key={key} className="grid min-w-0 gap-1 rounded-md border bg-background/40 px-2 py-1.5">
                      <span className="min-w-0 break-all text-xs text-muted-foreground">{key}</span>
                      <div className="min-w-0 break-words text-xs text-foreground">
                        <DetailValue value={nextValue} depth={depth + 1} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
          {value.length > 12 && <span className="text-xs text-muted-foreground">+{value.length - 12} more</span>}
        </div>
      )
    }

    return (
      <div className="flex min-w-0 max-w-full flex-wrap gap-1.5">
        {value.slice(0, 12).map((item, index) => (
          <span key={index} className="min-w-0 max-w-full break-words rounded-md border bg-muted px-2 py-1 text-xs text-foreground">
            {compactValue(item)}
          </span>
        ))}
        {value.length > 12 && <span className="text-xs text-muted-foreground">+{value.length - 12} more</span>}
      </div>
    )
  }

  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length === 0) return <span>None</span>

  return (
    <div className="grid min-w-0 max-w-full gap-1.5">
      {entries.map(([key, nextValue]) => (
        <div key={key} className="grid min-w-0 max-w-full gap-1 rounded-md border bg-muted/30 px-2 py-1.5">
          <span className="min-w-0 break-all text-xs text-muted-foreground">{key}</span>
          <div className="min-w-0 break-words text-xs text-foreground">
            <DetailValue value={nextValue} depth={depth + 1} />
          </div>
        </div>
      ))}
    </div>
  )
}

function DetailTabs({ config, namespace, name, active }: { config: ResourceConfig; namespace?: string; name?: string; active: "overview" | "manifest" }) {
  const scopedNamespace = namespace || "_cluster"
  const tabs = [
    { id: "overview", label: "Overview", to: `${config.path}/${scopedNamespace}/${name}` },
    { id: "manifest", label: "Manifest", to: `${config.path}/${scopedNamespace}/${name}/manifest` },
  ] as const

  return (
    <div className="flex gap-1 border-b">
      {tabs.map((tab) => (
        <Link
          key={tab.id}
          to={tab.to}
          className={cn(
            "-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm transition-colors",
            active === tab.id
              ? "border-primary font-medium text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  )
}

const defaultDetailSections = (resource: KubeResource): DetailSection[] => [
  {
    title: "Metadata",
    items: [
      { label: "Name", value: resource.metadata.name },
      { label: "Namespace", value: resource.metadata.namespace || "cluster scoped" },
      { label: "Created", value: resource.metadata.creationTimestamp },
      { label: "UID", value: resource.metadata.uid },
    ],
  },
  {
    title: "Status",
    items: Object.entries(resource.status || {})
      .filter(([, value]) => isPrimitiveDetailValue(value) || (Array.isArray(value) && value.every((item) => item && typeof item === "object" && "type" in (item as Record<string, unknown>))))
      .slice(0, 8)
      .map(([label, value]) => ({ label, value })),
  },
]

const selectorFromMatchLabels = (value: unknown) => {
  if (!isRecordValue(value)) return undefined
  const selector = Object.fromEntries(
    Object.entries(value).filter(([, nextValue]) => isPrimitiveDetailValue(nextValue) && nextValue !== "")
  ) as Record<string, string>
  return Object.keys(selector).length > 0 ? selector : undefined
}

const podLikeResource = (resource: KubeResource): PodSummary => ({
  metadata: {
    name: resource.metadata.name,
    namespace: resource.metadata.namespace,
    uid: resource.metadata.uid,
    labels: resource.metadata.labels,
    creationTimestamp: resource.metadata.creationTimestamp,
  },
  spec: resource.spec as PodSummary["spec"],
  status: resource.status as PodSummary["status"],
})

const relatedPodsForResource = (resource: KubeResource) => {
  const namespace = resource.metadata.namespace
  if (!namespace) return undefined

  const kind = resource.kind || ""
  const spec = resource.spec || {}
  const name = resource.metadata.name

  if (kind === "Pod") {
    return { namespace, podName: name, pods: [podLikeResource(resource)], title: "Pod Access" }
  }

  const selector = selectorFromMatchLabels(getValue(resource, ["spec", "selector", "matchLabels"]))
  if (selector && ["Deployment", "StatefulSet", "DaemonSet", "ReplicaSet", "Job"].includes(kind)) {
    return { namespace, selector, title: "Managed Pods" }
  }

  const serviceSelector = selectorFromMatchLabels((spec as Record<string, unknown>).selector)
  if (kind === "Service" && serviceSelector) {
    return { namespace, selector: serviceSelector, title: "Service Pods" }
  }

  const podSelector = selectorFromMatchLabels(getValue(resource, ["spec", "podSelector", "matchLabels"]))
  if (kind === "NetworkPolicy" && podSelector) {
    return { namespace, selector: podSelector, title: "Selected Pods" }
  }

  if (["VirtualMachine", "VirtualMachineInstance"].includes(kind)) {
    const selectors: Array<Record<string, string>> = [
      { "vm.kubevirt.io/name": name },
      { "vmi.kubevirt.io/id": name },
      { "las.qiniu.io/vm-id": name },
      { "kubevirt.io/domain": name },
    ]
    return {
      namespace,
      selectors,
      title: "Virtual Machine Pods",
    }
  }

  const templateLabels = selectorFromMatchLabels(getValue(resource, ["spec", "template", "metadata", "labels"]))
  if (templateLabels && ["VirtualMachinePool", "VirtualMachineInstanceReplicaSet"].includes(kind)) {
    return { namespace, selector: templateLabels, title: "Managed Pods" }
  }

  return undefined
}

function ResourceStatus({ resource, config }: { resource: KubeResource; config: ResourceConfig }) {
  const value =
    getValue(resource, config.statusPath) ??
    getValue(resource, ["status", "phase"]) ??
    getValue(resource, ["status", "conditions", "0", "type"]) ??
    "Active"

  return <StatusDot status={String(value)} />
}

function PodDetailOverview({ resource }: { resource: KubeResource }) {
  const spec = asRecord(resource.spec)
  const status = asRecord(resource.status)
  const containers = asRecordList(spec.containers)
  const initContainers = asRecordList(spec.initContainers)
  const containerStatuses = asRecordList(status.containerStatuses)
  const initContainerStatuses = asRecordList(status.initContainerStatuses)
  const volumes = asRecordList(spec.volumes)
  const conditions = asRecordList(status.conditions)
  const podIPs = asRecordList(status.podIPs).map((item) => item.ip).filter(Boolean)
  const nodeSelector = objectLabels(spec.nodeSelector)
  const tolerations = asRecordList(spec.tolerations)

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Phase" value={status.phase} variant={String(status.phase || "")} />
        <SummaryCard label="Pod IP" value={status.podIP} />
        <SummaryCard label="Node" value={spec.nodeName} />
        <SummaryCard label="QoS" value={status.qosClass} />
      </div>

      <SectionCard title="Containers">
<div className="space-y-4">
          <DetailContainerTable containers={containers} statuses={containerStatuses} />
          {initContainers.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Init Containers</div>
              <DetailContainerTable containers={initContainers} statuses={initContainerStatuses} />
            </div>
          )}
        </div>
</SectionCard>

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard title="Scheduling">
            <CompactKvTable rows={[
              { label: "Service Account", value: spec.serviceAccountName },
              { label: "Restart Policy", value: spec.restartPolicy },
              { label: "Priority Class", value: spec.priorityClassName },
              { label: "Priority", value: spec.priority },
              { label: "Runtime Class", value: spec.runtimeClassName },
              { label: "Node Selector", value: nodeSelector },
              { label: "Tolerations", value: tolerations },
              { label: "Start Time", value: status.startTime },
            ]} />
          </SectionCard>

        <SectionCard title="Networking">
            <CompactKvTable rows={[
              { label: "Host IP", value: status.hostIP },
              { label: "Pod IPs", value: podIPs },
              { label: "DNS Policy", value: spec.dnsPolicy },
              { label: "Host Network", value: spec.hostNetwork },
              { label: "Host PID", value: spec.hostPID },
              { label: "Host IPC", value: spec.hostIPC },
            ]} />
          </SectionCard>
      </div>

      <SectionCard title="Volumes">
          <DetailVolumeTable volumes={volumes} />
        </SectionCard>

      <SectionCard title="Conditions">
          <DetailValue value={conditions} />
        </SectionCard>
    </div>
  )
}

function SummaryCard({ label, value, variant }: { label: string; value: unknown; variant?: string }) {
  // Empty facts are noise in a summary row; the full spec is one tab away.
  if (!variant && compactValue(value) === "N/A") return null
  return (
    <div className="min-w-0 rounded-md border bg-card px-3 py-2.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 break-words text-sm font-medium">
        {variant ? <StatusDot status={variant} label={compactValue(value)} /> : compactValue(value)}
      </div>
    </div>
  )
}

function SectionCard({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-lg border bg-card">
      <header className="border-b px-4 py-2.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </header>
      <div className="p-4">{children}</div>
    </section>
  )
}

function WorkloadDetailOverview({ resource }: { resource: KubeResource }) {
  const spec = asRecord(resource.spec)
  const status = asRecord(resource.status)
  const template = asRecord(spec.template)
  const templateSpec = asRecord(template.spec)
  const containers = asRecordList(templateSpec.containers)
  const volumes = asRecordList(templateSpec.volumes)
  const selector = asRecord(spec.selector).matchLabels || spec.selector

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <SummaryCard label="Replicas" value={status.replicas ?? spec.replicas} />
        <SummaryCard label="Ready" value={status.readyReplicas} />
        <SummaryCard label="Available" value={status.availableReplicas} />
        <SummaryCard label="Updated" value={status.updatedReplicas} />
        <SummaryCard label="Unavailable" value={status.unavailableReplicas} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard title="Rollout">
          <CompactKvTable rows={[
            { label: "Selector", value: objectLabels(selector) },
            { label: "Strategy", value: spec.strategy || spec.updateStrategy },
            { label: "Min Ready Seconds", value: spec.minReadySeconds },
            { label: "Revision History", value: spec.revisionHistoryLimit },
            { label: "Observed Generation", value: status.observedGeneration },
          ]} />
        </SectionCard>
        <SectionCard title="Pod Template">
          <CompactKvTable rows={[
            { label: "Service Account", value: templateSpec.serviceAccountName },
            { label: "Restart Policy", value: templateSpec.restartPolicy },
            { label: "Labels", value: objectLabels(asRecord(template.metadata).labels) },
            { label: "Annotations", value: objectLabels(asRecord(template.metadata).annotations) },
          ]} />
        </SectionCard>
      </div>
      <SectionCard title="Template Containers">
        <DetailContainerTable containers={containers} />
      </SectionCard>
      <SectionCard title="Template Volumes">
        <DetailVolumeTable volumes={volumes} />
      </SectionCard>
      <SectionCard title="Conditions">
        <DetailValue value={status.conditions} />
      </SectionCard>
    </div>
  )
}

function NetworkDetailOverview({ resource }: { resource: KubeResource }) {
  const spec = asRecord(resource.spec)
  const status = asRecord(resource.status)
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Type" value={spec.type || resource.kind} />
        <SummaryCard label="Class" value={spec.ingressClassName || spec.gatewayClassName || spec.controllerName || spec.provider} />
        <SummaryCard label="Selector" value={objectLabels(spec.selector || asRecord(spec.podSelector).matchLabels).length || "N/A"} />
        <SummaryCard label="Address" value={spec.clusterIP || spec.cidrBlock || spec.cidr || spec.vpc || compactValue(asRecord(status).addresses)} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard title="Routing And Selectors">
          <CompactKvTable rows={[
            { label: "Selector", value: objectLabels(spec.selector || asRecord(spec.podSelector).matchLabels) },
            { label: "Policy Types", value: spec.policyTypes },
            { label: "Ports", value: spec.ports },
            { label: "Rules", value: spec.rules || spec.ingress || spec.egress },
            { label: "Hostnames", value: spec.hostnames },
            { label: "Parent Refs", value: spec.parentRefs },
          ]} />
        </SectionCard>
        <SectionCard title="Addresses">
          <CompactKvTable rows={[
            { label: "Cluster IP", value: spec.clusterIP },
            { label: "Cluster IPs", value: spec.clusterIPs },
            { label: "External IPs", value: spec.externalIPs },
            { label: "Load Balancer", value: status.loadBalancer },
            { label: "CIDR", value: spec.cidrBlock || spec.cidr },
            { label: "Gateway", value: spec.gateway || spec.gatewayNode },
          ]} />
        </SectionCard>
      </div>
      <SectionCard title="Status">
        <DetailValue value={status.conditions || status} />
      </SectionCard>
    </div>
  )
}

function StorageDetailOverview({ resource }: { resource: KubeResource }) {
  const spec = asRecord(resource.spec)
  const status = asRecord(resource.status)
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Phase" value={status.phase || status.status || resource.kind} variant={String(status.phase || status.status || "")} />
        <SummaryCard label="Capacity" value={asRecord(status.capacity).storage || asRecord(spec.resources).requests} />
        <SummaryCard label="Storage Class" value={spec.storageClassName || resource.storageClassName || resource.provisioner} />
        <SummaryCard label="Access Modes" value={spec.accessModes || resource.reclaimPolicy} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard title="Storage">
          <CompactKvTable rows={[
            { label: "Provisioner", value: resource.provisioner },
            { label: "Volume Name", value: spec.volumeName },
            { label: "Volume Mode", value: spec.volumeMode },
            { label: "Reclaim Policy", value: resource.reclaimPolicy || spec.persistentVolumeReclaimPolicy },
            { label: "Binding Mode", value: resource.volumeBindingMode },
            { label: "Expansion", value: resource.allowVolumeExpansion },
          ]} />
        </SectionCard>
        <SectionCard title="Source And Parameters">
          <CompactKvTable rows={[
            { label: "Parameters", value: resource.parameters },
            { label: "Source", value: spec.source || spec.csi || spec.hostPath || spec.nfs },
            { label: "Claim Ref", value: spec.claimRef },
            { label: "Node Affinity", value: spec.nodeAffinity },
            { label: "Conditions", value: status.conditions },
          ]} />
        </SectionCard>
      </div>
    </div>
  )
}

function VirtualizationDetailOverview({ resource }: { resource: KubeResource }) {
  const spec = asRecord(resource.spec)
  const status = asRecord(resource.status)
  const template = asRecord(spec.template)
  const templateSpec = asRecord(template.spec)
  const domain = asRecord(templateSpec.domain || spec.domain)
  const devices = asRecord(domain.devices)
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Printable Status" value={status.printableStatus || status.phase || status.conditions} variant={String(status.printableStatus || status.phase || "")} />
        <SummaryCard label="Run Strategy" value={spec.runStrategy || spec.running} />
        <SummaryCard label="Node" value={status.nodeName} />
        <SummaryCard label="IP" value={asRecordList(status.interfaces).map((item) => item.ipAddress).filter(Boolean)} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard title="Compute">
          <CompactKvTable rows={[
            { label: "CPU", value: domain.cpu },
            { label: "Memory", value: asRecord(domain.resources).requests || spec.memory },
            { label: "Machine", value: asRecord(domain.machine).type },
            { label: "Firmware", value: domain.firmware },
            { label: "Features", value: domain.features },
          ]} />
        </SectionCard>
        <SectionCard title="Runtime">
          <CompactKvTable rows={[
            { label: "Phase", value: status.phase },
            { label: "Conditions", value: status.conditions },
            { label: "Guest OS", value: status.guestOSInfo },
            { label: "Migration", value: status.migrationState },
          ]} />
        </SectionCard>
      </div>
      <SectionCard title="Disks And Volumes">
        <div className="grid gap-4 xl:grid-cols-2">
          <DetailValue value={devices.disks || spec.disks} />
          <DetailVolumeTable volumes={asRecordList(templateSpec.volumes || spec.volumes)} />
        </div>
      </SectionCard>
      <SectionCard title="Networks">
        <DetailValue value={templateSpec.networks || devices.interfaces || spec.networks || spec.interfaces} />
      </SectionCard>
    </div>
  )
}

function NodeDetailOverview({ resource }: { resource: KubeResource }) {
  const spec = asRecord(resource.spec)
  const status = asRecord(resource.status)
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Status" value={asRecordList(status.conditions).find((item) => item.status === "True")?.type || "Unknown"} />
        <SummaryCard label="Kubelet" value={asRecord(status.nodeInfo).kubeletVersion} />
        <SummaryCard label="OS" value={asRecord(status.nodeInfo).osImage} />
        <SummaryCard label="Unschedulable" value={spec.unschedulable || false} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard title="Capacity"><CompactKvTable rows={Object.entries(asRecord(status.capacity)).map(([label, value]) => ({ label, value }))} /></SectionCard>
        <SectionCard title="Allocatable"><CompactKvTable rows={Object.entries(asRecord(status.allocatable)).map(([label, value]) => ({ label, value }))} /></SectionCard>
      </div>
      <SectionCard title="Conditions"><DetailValue value={status.conditions} /></SectionCard>
      <SectionCard title="Addresses"><DetailValue value={status.addresses} /></SectionCard>
    </div>
  )
}

const admissionRuleText = (rules: unknown) => asRecordList(rules).map((rule) => {
  const operations = joinList(rule.operations)
  const apiGroups = joinList(rule.apiGroups)
  const resources = joinList(rule.resources)
  const scope = compactValue(rule.scope)
  return [operations, apiGroups, resources, scope].filter((item) => item && item !== "N/A").join(" / ")
}).filter(Boolean)

const admissionClientText = (clientConfig: unknown) => {
  const client = asRecord(clientConfig)
  const service = asRecord(client.service)
  if (service.name) {
    return `Service ${compactValue(service.namespace || "default")}/${compactValue(service.name)}${service.path ? compactValue(service.path) : ""}`
  }
  return compactValue(client.url)
}

function AdmissionDetailOverview({ resource }: { resource: KubeResource }) {
  const spec = asRecord(resource.spec)
  const status = asRecord(resource.status)
  const webhooks = asRecordList(resource.webhooks)
  const validations = asRecordList(spec.validations)
  const variables = asRecordList(spec.variables)
  const auditAnnotations = asRecordList(spec.auditAnnotations)
  const matchConstraints = asRecord(spec.matchConstraints || spec.matchResources)

  if (webhooks.length > 0) {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard label="Webhooks" value={webhooks.length} />
          <SummaryCard label="Failure Policies" value={[...new Set(webhooks.map((item) => compactValue(item.failurePolicy || "Fail")))]} />
          <SummaryCard label="Side Effects" value={[...new Set(webhooks.map((item) => compactValue(item.sideEffects)))]} />
          <SummaryCard label="Admission Review" value={[...new Set(webhooks.flatMap((item) => Array.isArray(item.admissionReviewVersions) ? item.admissionReviewVersions.map(compactValue) : []))]} />
        </div>
        <SectionCard title="Webhooks" description="Client endpoints, matching rules, selector scope, and admission behavior.">
          <div className="overflow-x-auto rounded-lg border">
            <Table className="min-w-[1040px]">
              <TableHeader className="bg-muted/60">
                <TableRow>
                  <TableHead className="h-9 text-xs font-medium text-muted-foreground">Name</TableHead>
                  <TableHead className="h-9 text-xs font-medium text-muted-foreground">Client</TableHead>
                  <TableHead className="h-9 text-xs font-medium text-muted-foreground">Rules</TableHead>
                  <TableHead className="h-9 text-xs font-medium text-muted-foreground">Selectors</TableHead>
                  <TableHead className="h-9 text-xs font-medium text-muted-foreground">Policy</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {webhooks.map((webhook, index) => (
                  <TableRow key={`${compactValue(webhook.name)}-${index}`} className="hover:bg-muted/50">
                    <TableCell className="max-w-[220px] break-words font-semibold">{compactValue(webhook.name)}</TableCell>
                    <TableCell className="max-w-[240px] break-words text-xs text-muted-foreground">{admissionClientText(webhook.clientConfig)}</TableCell>
                    <TableCell className="max-w-[320px] text-xs text-muted-foreground">
                      <ChipList values={admissionRuleText(webhook.rules)} />
                    </TableCell>
                    <TableCell className="max-w-[240px] text-xs text-muted-foreground">
                      <DetailValue value={{
                        namespaceSelector: webhook.namespaceSelector,
                        objectSelector: webhook.objectSelector,
                        matchConditions: webhook.matchConditions,
                      }} />
                    </TableCell>
                    <TableCell className="max-w-[220px] text-xs text-muted-foreground">
                      <CompactKvTable rows={[
                        { label: "Failure", value: webhook.failurePolicy || "Fail" },
                        { label: "Match", value: webhook.matchPolicy },
                        { label: "Side Effects", value: webhook.sideEffects },
                        { label: "Timeout", value: webhook.timeoutSeconds },
                        { label: "Reinvocation", value: webhook.reinvocationPolicy },
                      ]} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </SectionCard>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Policy" value={spec.policyName || resource.metadata.name} />
        <SummaryCard label="Failure Policy" value={spec.failurePolicy} />
        <SummaryCard label="Actions" value={spec.validationActions} />
        <SummaryCard label="Conditions" value={asRecordList(status.conditions).length || "N/A"} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard title="Policy">
          <CompactKvTable rows={[
            { label: "Policy Name", value: spec.policyName },
            { label: "Failure Policy", value: spec.failurePolicy },
            { label: "Validation Actions", value: spec.validationActions },
            { label: "Param Kind", value: spec.paramKind },
            { label: "Param Ref", value: spec.paramRef },
          ]} />
        </SectionCard>
        <SectionCard title="Match Constraints">
          <CompactKvTable rows={[
            { label: "Resource Rules", value: matchConstraints.resourceRules },
            { label: "Exclude Rules", value: matchConstraints.excludeResourceRules },
            { label: "Namespace Selector", value: matchConstraints.namespaceSelector },
            { label: "Object Selector", value: matchConstraints.objectSelector },
            { label: "Match Conditions", value: matchConstraints.matchConditions },
          ]} />
        </SectionCard>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard title="Validations">
          <DetailValue value={validations} />
        </SectionCard>
        <SectionCard title="Variables And Audit">
          <DetailValue value={{ variables, auditAnnotations }} />
        </SectionCard>
      </div>
      <SectionCard title="Status">
        <DetailValue value={status.conditions || status} />
      </SectionCard>
    </div>
  )
}

function RbacDetailOverview({ resource }: { resource: KubeResource }) {
  const rules = asRecordList(resource.rules)
  const roleRef = asRecord(resource.roleRef)
  const subjects = asRecordList(resource.subjects)
  const secrets = asRecordList(resource.secrets)
  const imagePullSecrets = asRecordList(resource.imagePullSecrets)

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Rules" value={rules.length || "N/A"} />
        <SummaryCard label="Subjects" value={subjects.length || "N/A"} />
        <SummaryCard label="Role Ref" value={[roleRef.kind, roleRef.name].filter(Boolean).map(compactValue).join("/")} />
        <SummaryCard label="Automount Token" value={resource.automountServiceAccountToken} />
      </div>
      {rules.length > 0 && (
        <SectionCard title="Rules">
          <div className="overflow-x-auto rounded-lg border">
            <Table className="min-w-[900px]">
              <TableHeader className="bg-muted/60">
                <TableRow>
                  <TableHead className="h-9 text-xs font-medium text-muted-foreground">API Groups</TableHead>
                  <TableHead className="h-9 text-xs font-medium text-muted-foreground">Resources</TableHead>
                  <TableHead className="h-9 text-xs font-medium text-muted-foreground">Resource Names</TableHead>
                  <TableHead className="h-9 text-xs font-medium text-muted-foreground">Verbs</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((rule, index) => (
                  <TableRow key={index} className="hover:bg-muted/50">
                    <TableCell className="max-w-[220px] break-words text-xs">{joinList(rule.apiGroups)}</TableCell>
                    <TableCell className="max-w-[280px] break-words text-xs">{joinList(rule.resources)}</TableCell>
                    <TableCell className="max-w-[240px] break-words text-xs">{joinList(rule.resourceNames)}</TableCell>
                    <TableCell className="max-w-[240px] break-words text-xs">{joinList(rule.verbs)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </SectionCard>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard title="Subjects">
          <DetailValue value={subjects} />
        </SectionCard>
        <SectionCard title="Service Account">
          <CompactKvTable rows={[
            { label: "Secrets", value: secrets },
            { label: "Image Pull Secrets", value: imagePullSecrets },
            { label: "Automount Token", value: resource.automountServiceAccountToken },
          ]} />
        </SectionCard>
      </div>
    </div>
  )
}

function ConfigDetailOverview({ resource }: { resource: KubeResource }) {
  const data = asRecord(resource.data)
  const binaryData = asRecord(resource.binaryData)
  const type = compactValue(resource.type || resource.kind)
  const keys = Object.keys(data)
  const binaryKeys = Object.keys(binaryData)
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Type" value={type} />
        <SummaryCard label="Data Keys" value={keys.length} />
        <SummaryCard label="Binary Keys" value={binaryKeys.length || "N/A"} />
        <SummaryCard label="Immutable" value={resource.immutable} />
      </div>
      <SectionCard title="Data">
        <div className="grid gap-3 xl:grid-cols-2">
          {keys.length === 0 && <span className="text-sm text-muted-foreground">No data</span>}
          {keys.map((key) => (
            <div key={key} className="min-w-0 rounded-lg border bg-muted/30 p-3">
              <div className="mb-2 break-all text-xs font-semibold text-foreground">{key}</div>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs text-foreground">{compactValue(data[key])}</pre>
            </div>
          ))}
        </div>
      </SectionCard>
      {binaryKeys.length > 0 && (
        <SectionCard title="Binary Data">
          <ChipList values={binaryKeys} />
        </SectionCard>
      )}
    </div>
  )
}

function PolicyDetailOverview({ resource }: { resource: KubeResource }) {
  const spec = asRecord(resource.spec)
  const status = asRecord(resource.status)
  const hard = asRecord(spec.hard)
  const used = asRecord(status.used)
  const limits = asRecordList(spec.limits)

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Type" value={resource.kind} />
        <SummaryCard label="Scopes" value={spec.scopes || spec.scopeSelector} />
        <SummaryCard label="Limits" value={limits.length || "N/A"} />
        <SummaryCard label="Disruptions" value={`${compactValue(status.currentHealthy)} / ${compactValue(status.desiredHealthy)}`} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard title="Spec">
          <CompactKvTable rows={[
            { label: "Min Available", value: spec.minAvailable },
            { label: "Max Unavailable", value: spec.maxUnavailable },
            { label: "Selector", value: asRecord(spec.selector).matchLabels || spec.selector },
            { label: "Hard", value: hard },
            { label: "Limits", value: limits },
          ]} />
        </SectionCard>
        <SectionCard title="Status">
          <CompactKvTable rows={[
            { label: "Used", value: used },
            { label: "Current Healthy", value: status.currentHealthy },
            { label: "Desired Healthy", value: status.desiredHealthy },
            { label: "Expected Pods", value: status.expectedPods },
            { label: "Disruptions Allowed", value: status.disruptionsAllowed },
          ]} />
        </SectionCard>
      </div>
    </div>
  )
}

function ClusterControlDetailOverview({ resource }: { resource: KubeResource }) {
  const spec = asRecord(resource.spec)
  const status = asRecord(resource.status)
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Kind" value={resource.kind} />
        <SummaryCard label="Version" value={resource.apiVersion || spec.version} />
        <SummaryCard label="Available" value={status.available ?? status.phase ?? asRecordList(status.conditions).find((item) => item.status === "True")?.type} />
        <SummaryCard label="Created" value={resource.metadata.creationTimestamp} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard title="Spec">
          <CompactKvTable rows={Object.entries(spec).map(([label, value]) => ({ label, value }))} />
        </SectionCard>
        <SectionCard title="Status">
          <CompactKvTable rows={Object.entries(status).map(([label, value]) => ({ label, value }))} />
        </SectionCard>
      </div>
      <SectionCard title="Conditions">
        <DetailValue value={status.conditions} />
      </SectionCard>
    </div>
  )
}

function StructuredResourceOverview({ resource, sections }: { resource: KubeResource; sections: DetailSection[] }) {
  const spec = asRecord(resource.spec)
  const status = asRecord(resource.status)
  const topSpec = Object.entries(spec).filter(([, value]) => hasRenderableValue(value)).slice(0, 12).map(([label, value]) => ({ label, value }))
  const topStatus = Object.entries(status).filter(([, value]) => hasRenderableValue(value)).slice(0, 12).map(([label, value]) => ({ label, value }))
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Kind" value={resource.kind} />
        <SummaryCard label="API Version" value={resource.apiVersion} />
        <SummaryCard label="Status" value={getValue(resource, ["status", "phase"]) ?? getValue(resource, ["status", "conditions", "0", "type"]) ?? "Active"} />
        <SummaryCard label="Created" value={resource.metadata.creationTimestamp} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard title="Spec"><CompactKvTable rows={topSpec} /></SectionCard>
        <SectionCard title="Status"><CompactKvTable rows={topStatus} /></SectionCard>
      </div>
      {sections.filter((section) => !["Metadata", "Status"].includes(section.title)).map((section) => (
        <SectionCard key={section.title} title={section.title} description={section.description}>
          <CompactKvTable rows={section.items.map((item) => ({ label: item.label, value: item.value }))} />
        </SectionCard>
      ))}
    </div>
  )
}

function ResourceSpecificOverview({ resource, config, sections }: { resource: KubeResource; config: ResourceConfig; sections: DetailSection[] }) {
  const kind = resource.kind || config.kind
  const scope = `${config.id} ${config.path}`.toLowerCase()
  if (kind === "Pod") return <PodDetailOverview resource={resource} />
  if (["Deployment", "StatefulSet", "DaemonSet", "ReplicaSet", "Job", "CronJob", "HorizontalPodAutoscaler", "ReplicationController", "PodTemplate", "ControllerRevision", "VirtualMachinePool", "VirtualMachineInstanceReplicaSet"].includes(kind)) return <WorkloadDetailOverview resource={resource} />
  if (kind === "Node") return <NodeDetailOverview resource={resource} />
  if (["MutatingWebhookConfiguration", "ValidatingWebhookConfiguration", "ValidatingAdmissionPolicy", "ValidatingAdmissionPolicyBinding"].includes(kind)) return <AdmissionDetailOverview resource={resource} />
  if (["Role", "ClusterRole", "RoleBinding", "ClusterRoleBinding", "ServiceAccount"].includes(kind)) return <RbacDetailOverview resource={resource} />
  if (["ConfigMap", "Secret"].includes(kind)) return <ConfigDetailOverview resource={resource} />
  if (["LimitRange", "ResourceQuota", "PodDisruptionBudget"].includes(kind)) return <PolicyDetailOverview resource={resource} />
  if (["APIService", "CustomResourceDefinition", "ComponentStatus", "Namespace", "Lease", "CertificateSigningRequest", "FlowSchema", "PriorityLevelConfiguration", "RuntimeClass", "PriorityClass", "Event"].includes(kind)) return <ClusterControlDetailOverview resource={resource} />
  if (["Service", "Ingress", "IngressClass", "NetworkPolicy", "EndpointSlice", "Endpoints", "NetworkAttachmentDefinition", "Gateway", "GatewayClass", "HTTPRoute"].includes(kind) || ["network", "route", "gateway", "cilium", "calico", "kubeovn", "metallb"].some((item) => scope.includes(item))) return <NetworkDetailOverview resource={resource} />
  if (["PersistentVolume", "PersistentVolumeClaim", "StorageClass", "CSIDriver", "CSINode", "CSIStorageCapacity", "VolumeAttachment", "VolumeSnapshot", "VolumeSnapshotClass", "VolumeSnapshotContent", "DataVolume", "DataSource", "StorageProfile"].includes(kind) || ["volume", "storage", "snapshot"].some((item) => scope.includes(item))) return <StorageDetailOverview resource={resource} />
  if (kind.includes("VirtualMachine") || kind === "KubeVirt" || kind.startsWith("CDI") || ["ObjectTransfer", "DataImportCron", "VolumeImportSource", "VolumeUploadSource", "VolumeCloneSource"].includes(kind)) return <VirtualizationDetailOverview resource={resource} />
  return <StructuredResourceOverview resource={resource} sections={sections} />
}

const fieldDefaults = (fields?: CreateFormField[]) =>
  Object.fromEntries((fields || []).map((field) => [field.name, typeof field.defaultValue === "function" ? "" : field.defaultValue ?? ""])) as Record<string, string | boolean>

const createFieldDefaults = (fields: CreateFormField[], defaultNamespace?: string) => {
  const defaults = fieldDefaults(fields)
  if (defaultNamespace && defaultNamespace !== "all" && "namespace" in defaults) defaults.namespace = defaultNamespace
  return defaults
}

const resourceFieldDefaults = (resource: KubeResource, fields?: CreateFormField[]) =>
  Object.fromEntries((fields || []).map((field) => [
    field.name,
    typeof field.defaultValue === "function" ? field.defaultValue(resource) : field.defaultValue ?? "",
  ])) as Record<string, string | boolean>

const textFromRecord = (value: unknown) =>
  Object.entries(asRecord(value)).map(([key, next]) => `${key}=${compactValue(next)}`).join("\n")

const recordFromText = (value: string | boolean | undefined) =>
  Object.fromEntries(String(value ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [key, ...rest] = line.split("=")
      return [key.trim(), rest.join("=").trim()]
    })
    .filter(([key]) => key))

const csvFromList = (value: unknown) => Array.isArray(value) ? value.map(compactValue).join(", ") : compactValue(value) === "N/A" ? "" : compactValue(value)

const listFromCsv = (value: string | boolean | undefined) =>
  String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean)

const numberFromValue = (value: string | boolean | undefined, fallback: number) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const createNamespaceNameFields = (name: string): CreateFormField[] => [
  { name: "name", label: "Name", section: "Identity", defaultValue: name, required: true },
  { name: "namespace", label: "Namespace", section: "Identity", defaultValue: "default", required: true },
]

const createNameOnlyFields = (name: string): CreateFormField[] => [
  { name: "name", label: "Name", section: "Identity", defaultValue: name, required: true },
]

const identityCreateFields = (config: ResourceConfig) =>
  config.namespaced ? createNamespaceNameFields(`example-${config.id}`) : createNameOnlyFields(`example-${config.id}`)

const resourceActionBase = (config: ResourceConfig, resource: KubeResource) => {
  const apiVersion = resource.apiVersion || apiVersionFromListPath(config.listPath)
  if (apiVersion === "v1") return "/api/v1"
  return `/apis/${apiVersion}`
}

const resourceActionUrl = (config: ResourceConfig, resource: KubeResource) =>
  `${resourceActionBase(config, resource)}${config.namespaced ? `/namespaces/${resource.metadata.namespace}` : ""}/${config.id}/${resource.metadata.name}`

const canCreateResource = (config: ResourceConfig) => config.kind !== "ComponentStatus"
const canDeleteResource = (config: ResourceConfig) => config.kind !== "ComponentStatus"

const mergePatchOptions = (body: unknown): RequestInit => ({
  method: "PATCH",
  headers: { "Content-Type": "application/merge-patch+json", Accept: "application/json" },
  body: JSON.stringify(body),
})

const jsonPatchOptions = (body: unknown[]): RequestInit => ({
  method: "PATCH",
  headers: { "Content-Type": "application/json-patch+json", Accept: "application/json" },
  body: JSON.stringify(body),
})

const specBasicsPatch = (values: Record<string, string | boolean>) => {
  const spec = recordFromText(values.specFields)
  return Object.keys(spec).length ? { spec } : {}
}

const customCreateFields = (config: ResourceConfig) => {
  const identity = new Set(config.namespaced ? ["name", "namespace"] : ["name"])
  return (config.createFields || []).filter((field) => !identity.has(field.name))
}

const usesInferredCreate = (config: ResourceConfig) =>
  customCreateFields(config).length === 0 && (
    ["FlowSchema", "PriorityLevelConfiguration", "APIService", "CustomResourceDefinition", "CertificateSigningRequest", "Node", "Endpoints", "EndpointSlice", "Event", "ReplicaSet", "ControllerRevision"].includes(config.kind) ||
    config.path.includes("/calico/") ||
    config.path.includes("/cilium/") ||
    config.path.includes("/kube-ovn/")
  )

const effectiveCreateFields = (config: ResourceConfig): CreateFormField[] => {
  const custom = customCreateFields(config)
  if (custom.length > 0) return config.createFields || identityCreateFields(config)
  const identity = identityCreateFields(config)

  switch (config.kind) {
    case "FlowSchema":
      return [
        ...identity,
        { name: "priorityLevel", label: "Priority Level", section: "Matching", defaultValue: "workload-low" },
        { name: "matchingPrecedence", label: "Matching Precedence", section: "Matching", type: "number", defaultValue: "1000" },
        { name: "distinguisherMethod", label: "Distinguisher Method", section: "Matching", type: "select", defaultValue: "ByUser", options: [{ label: "By User", value: "ByUser" }, { label: "By Namespace", value: "ByNamespace" }] },
        { name: "subjects", label: "Subjects", section: "Rules", type: "textarea", defaultValue: "Group|system:authenticated", placeholder: "Kind|Name per line" },
        { name: "verbs", label: "Verbs", section: "Rules", defaultValue: "*", placeholder: "comma-separated" },
        { name: "apiGroups", label: "API Groups", section: "Rules", defaultValue: "*", placeholder: "comma-separated" },
        { name: "resources", label: "Resources", section: "Rules", defaultValue: "*", placeholder: "comma-separated" },
      ]
    case "PriorityLevelConfiguration":
      return [
        ...identity,
        { name: "type", label: "Type", section: "Priority", type: "select", defaultValue: "Limited", options: [{ label: "Limited", value: "Limited" }, { label: "Exempt", value: "Exempt" }] },
        { name: "assuredConcurrencyShares", label: "Assured Concurrency Shares", section: "Limited", type: "number", defaultValue: "30" },
        { name: "queues", label: "Queues", section: "Limited", type: "number", defaultValue: "64" },
        { name: "handSize", label: "Hand Size", section: "Limited", type: "number", defaultValue: "8" },
        { name: "queueLengthLimit", label: "Queue Length Limit", section: "Limited", type: "number", defaultValue: "50" },
      ]
    case "APIService":
      return [
        ...identity,
        { name: "group", label: "API Group", section: "API", defaultValue: "example.com" },
        { name: "version", label: "API Version", section: "API", defaultValue: "v1" },
        { name: "serviceNamespace", label: "Service Namespace", section: "Service", defaultValue: "default" },
        { name: "serviceName", label: "Service Name", section: "Service", defaultValue: "example-apiserver" },
        { name: "insecureSkipTLSVerify", label: "Skip TLS Verify", section: "TLS", type: "checkbox", defaultValue: true },
        { name: "groupPriorityMinimum", label: "Group Priority", section: "Priority", type: "number", defaultValue: "1000" },
        { name: "versionPriority", label: "Version Priority", section: "Priority", type: "number", defaultValue: "15" },
      ]
    case "CustomResourceDefinition":
      return [
        ...identity,
        { name: "group", label: "Group", section: "Names", defaultValue: "example.com" },
        { name: "plural", label: "Plural", section: "Names", defaultValue: "examples" },
        { name: "singular", label: "Singular", section: "Names", defaultValue: "example" },
        { name: "kind", label: "Kind", section: "Names", defaultValue: "Example" },
        { name: "scope", label: "Scope", section: "Schema", type: "select", defaultValue: "Namespaced", options: [{ label: "Namespaced", value: "Namespaced" }, { label: "Cluster", value: "Cluster" }] },
        { name: "version", label: "Version", section: "Schema", defaultValue: "v1" },
      ]
    case "CertificateSigningRequest":
      return [...identity, { name: "request", label: "CSR Request PEM/Base64", section: "Request", type: "textarea", defaultValue: "", placeholder: "Paste CSR request bytes or base64" }, { name: "signerName", label: "Signer Name", section: "Request", defaultValue: "kubernetes.io/kube-apiserver-client" }, { name: "usages", label: "Usages", section: "Request", defaultValue: "client auth", placeholder: "comma-separated" }]
    case "Node":
      return [...identity, { name: "labels", label: "Labels", section: "Metadata", type: "textarea", defaultValue: "kubernetes.io/os=linux", placeholder: "key=value per line" }, { name: "podCIDR", label: "Pod CIDR", section: "Spec", defaultValue: "", placeholder: "optional" }, { name: "providerID", label: "Provider ID", section: "Spec", defaultValue: "", placeholder: "optional" }]
    case "Endpoints":
      return [...identity, { name: "addresses", label: "Addresses", section: "Endpoint", defaultValue: "10.0.0.1", placeholder: "comma-separated IPs" }, { name: "port", label: "Port", section: "Endpoint", type: "number", defaultValue: "80" }, { name: "protocol", label: "Protocol", section: "Endpoint", type: "select", defaultValue: "TCP", options: [{ label: "TCP", value: "TCP" }, { label: "UDP", value: "UDP" }, { label: "SCTP", value: "SCTP" }] }]
    case "EndpointSlice":
      return [...identity, { name: "serviceName", label: "Service Name", section: "Discovery", defaultValue: "example-service" }, { name: "addressType", label: "Address Type", section: "Discovery", type: "select", defaultValue: "IPv4", options: [{ label: "IPv4", value: "IPv4" }, { label: "IPv6", value: "IPv6" }, { label: "FQDN", value: "FQDN" }] }, { name: "addresses", label: "Addresses", section: "Discovery", defaultValue: "10.0.0.1", placeholder: "comma-separated" }, { name: "port", label: "Port", section: "Ports", type: "number", defaultValue: "80" }]
    case "Event":
      return [...identity, { name: "involvedKind", label: "Involved Kind", section: "Event", defaultValue: "Pod" }, { name: "involvedName", label: "Involved Name", section: "Event", defaultValue: "example-pod" }, { name: "reason", label: "Reason", section: "Event", defaultValue: "ManualEvent" }, { name: "message", label: "Message", section: "Event", defaultValue: "Created from dashboard" }, { name: "type", label: "Type", section: "Event", type: "select", defaultValue: "Normal", options: [{ label: "Normal", value: "Normal" }, { label: "Warning", value: "Warning" }] }]
    case "ReplicaSet":
    case "ControllerRevision":
      return [...identity, { name: "labels", label: "Labels", section: "Metadata", type: "textarea", defaultValue: "app=example", placeholder: "key=value per line" }, { name: "replicas", label: "Replicas", section: "Spec", type: "number", defaultValue: "1" }, { name: "image", label: "Container Image", section: "Template", defaultValue: "nginx:latest" }]
    default:
      if (config.path.includes("/calico/") || config.path.includes("/cilium/") || config.path.includes("/kube-ovn/")) {
        return [...identity, { name: "labels", label: "Labels", section: "Metadata", type: "textarea", defaultValue: "", placeholder: "key=value per line" }, { name: "selector", label: "Selector", section: "Spec", defaultValue: "all()", placeholder: "selector expression or label selector" }, { name: "cidrs", label: "CIDRs / Nets", section: "Spec", defaultValue: "", placeholder: "comma-separated" }, { name: "specFields", label: `${config.kind} Spec Fields`, section: "Spec", type: "textarea", defaultValue: "", placeholder: "topLevelSpecKey=value per line" }]
      }
      return config.createFields || identity
  }
}


const flowSchemaSubject = (line: string, namespace: string) => {
  const [kind, name] = line.split("|")
  if (kind === "ServiceAccount") return { kind, serviceAccount: { name, namespace } }
  if (kind === "User") return { kind, user: { name } }
  return { kind: "Group", group: { name: name || "system:authenticated" } }
}

const buildEffectiveCreateResource = (config: ResourceConfig, values: Record<string, string | boolean>): KubeResource | KubeResource[] => {
  if (config.buildCreateResource && !usesInferredCreate(config)) return config.buildCreateResource(values)
  const name = String(values.name || `example-${config.id}`)
  const namespace = String(values.namespace || "default")
  const labels = recordFromText(values.labels)
  const metadata = { name, ...(config.namespaced ? { namespace } : {}), ...(Object.keys(labels).length ? { labels } : {}) }
  const base = { apiVersion: apiVersionFromListPath(config.listPath), kind: config.kind, metadata } as KubeResource

  switch (config.kind) {
    case "FlowSchema":
      return { ...base, spec: { matchingPrecedence: numberFromValue(values.matchingPrecedence, 1000), priorityLevelConfiguration: { name: values.priorityLevel }, distinguisherMethod: { type: values.distinguisherMethod }, rules: [{ subjects: String(values.subjects || "").split("\n").map((line) => line.trim()).filter(Boolean).map((line) => flowSchemaSubject(line, namespace)), resourceRules: [{ verbs: listFromCsv(values.verbs), apiGroups: listFromCsv(values.apiGroups), resources: listFromCsv(values.resources) }] }] } }
    case "PriorityLevelConfiguration":
      return { ...base, spec: { type: values.type, ...(values.type === "Limited" ? { limited: { assuredConcurrencyShares: numberFromValue(values.assuredConcurrencyShares, 30), limitResponse: { type: "Queue", queuing: { queues: numberFromValue(values.queues, 64), handSize: numberFromValue(values.handSize, 8), queueLengthLimit: numberFromValue(values.queueLengthLimit, 50) } } } } : {}) } }
    case "APIService":
      return { ...base, spec: { group: values.group, version: values.version, service: { namespace: values.serviceNamespace, name: values.serviceName }, insecureSkipTLSVerify: values.insecureSkipTLSVerify === true, groupPriorityMinimum: numberFromValue(values.groupPriorityMinimum, 1000), versionPriority: numberFromValue(values.versionPriority, 15) } }
    case "CustomResourceDefinition":
      return { ...base, metadata: { name: `${values.plural}.${values.group}` }, spec: { group: values.group, scope: values.scope, names: { plural: values.plural, singular: values.singular, kind: values.kind }, versions: [{ name: values.version, served: true, storage: true, schema: { openAPIV3Schema: { type: "object", "x-kubernetes-preserve-unknown-fields": true } } }] } }
    case "CertificateSigningRequest":
      return { ...base, spec: { request: values.request, signerName: values.signerName, usages: listFromCsv(values.usages) } }
    case "Node":
      return { ...base, spec: { ...(values.podCIDR ? { podCIDR: values.podCIDR } : {}), ...(values.providerID ? { providerID: values.providerID } : {}) } }
    case "Endpoints":
      return { ...base, subsets: [{ addresses: listFromCsv(values.addresses).map((ip) => ({ ip })), ports: [{ port: numberFromValue(values.port, 80), protocol: values.protocol }] }] }
    case "EndpointSlice":
      return { ...base, metadata: { ...metadata, labels: { "kubernetes.io/service-name": String(values.serviceName || "example-service") } }, addressType: values.addressType, endpoints: [{ addresses: listFromCsv(values.addresses) }], ports: [{ port: numberFromValue(values.port, 80), protocol: "TCP" }] }
    case "Event":
      return { ...base, involvedObject: { kind: values.involvedKind, name: values.involvedName, namespace }, reason: values.reason, message: values.message, type: values.type, firstTimestamp: new Date().toISOString(), lastTimestamp: new Date().toISOString(), count: 1, source: { component: "kubevirt-dashboard" } }
    case "ReplicaSet":
      return { ...base, spec: { replicas: numberFromValue(values.replicas, 1), selector: { matchLabels: labels }, template: { metadata: { labels }, spec: { containers: [{ name: "app", image: values.image }] } } } }
    case "ControllerRevision":
      return { ...base, data: { labels }, revision: 1 }
    default:
      return { ...base, spec: { selector: values.selector, cidrs: listFromCsv(values.cidrs), ...asRecord(specBasicsPatch(values).spec) } }
  }
}

const resourceAction = (
  config: ResourceConfig,
  resource: KubeResource,
  action: Omit<ResourceAction, "buildRequest"> & { patch: (values: Record<string, string | boolean>) => unknown; contentType?: "merge" | "json" }
): ResourceAction => ({
  ...action,
  buildRequest: (_, values) => ({
    url: resourceActionUrl(config, resource),
    options: action.contentType === "json" ? jsonPatchOptions(action.patch(values) as unknown[]) : mergePatchOptions(action.patch(values)),
  }),
})

const inferredResourceActions = (config: ResourceConfig, resource: KubeResource): ResourceAction[] => {
  if (resource.kind === "ComponentStatus") return []

  const kind = resource.kind || config.kind
  const spec = asRecord(resource.spec)
  const metadataFields: CreateFormField[] = [
    { name: "labels", label: "Labels", section: "Metadata", type: "textarea", defaultValue: (r) => textFromRecord(r.metadata.labels), placeholder: "key=value per line" },
    { name: "annotations", label: "Annotations", section: "Metadata", type: "textarea", defaultValue: (r) => textFromRecord(r.metadata.annotations), placeholder: "key=value per line" },
  ]
  const actions: ResourceAction[] = [
    resourceAction(config, resource, {
      id: "edit-metadata",
      label: "Edit Metadata",
      description: `Update ${kind} labels and annotations.`,
      fields: metadataFields,
      patch: (values) => ({ metadata: { labels: recordFromText(values.labels), annotations: recordFromText(values.annotations) } }),
    }),
  ]

  const add = (action: Omit<ResourceAction, "buildRequest"> & { patch: (values: Record<string, string | boolean>) => unknown; contentType?: "merge" | "json" }) =>
    actions.push(resourceAction(config, resource, action))

  if (["Deployment", "StatefulSet", "ReplicaSet", "ReplicationController"].includes(kind)) {
    add({
      id: "edit-workload-scale",
      label: "Edit Scale",
      description: `Set ${kind} replica count.`,
      fields: [{ name: "replicas", label: "Replicas", section: "Scale", type: "number", defaultValue: () => String(spec.replicas ?? 1) }],
      patch: (values) => ({ spec: { replicas: numberFromValue(values.replicas, 1) } }),
    })
  }

  if (["Deployment", "StatefulSet", "DaemonSet", "ReplicaSet", "ReplicationController", "Job", "CronJob"].includes(kind)) {
    const template = kind === "CronJob" ? asRecord(getValue(resource, ["spec", "jobTemplate", "spec", "template"])) : asRecord(spec.template)
    add({
      id: "edit-pod-template-metadata",
      label: "Edit Template",
      description: `Update ${kind} pod template labels and annotations.`,
      fields: [
        { name: "labels", label: "Template Labels", section: "Pod Template", type: "textarea", defaultValue: () => textFromRecord(asRecord(template.metadata).labels), placeholder: "key=value per line" },
        { name: "annotations", label: "Template Annotations", section: "Pod Template", type: "textarea", defaultValue: () => textFromRecord(asRecord(template.metadata).annotations), placeholder: "key=value per line" },
      ],
      patch: (values) => kind === "CronJob"
        ? { spec: { jobTemplate: { spec: { template: { metadata: { labels: recordFromText(values.labels), annotations: recordFromText(values.annotations) } } } } } }
        : { spec: { template: { metadata: { labels: recordFromText(values.labels), annotations: recordFromText(values.annotations) } } } },
    })
  }

  if (kind === "CronJob") {
    add({
      id: "edit-cron-schedule",
      label: "Edit Schedule",
      description: "Update schedule, suspend state, and job history limits.",
      fields: [
        { name: "schedule", label: "Schedule", section: "Schedule", defaultValue: () => compactValue(spec.schedule || "* * * * *") },
        { name: "suspend", label: "Suspend", section: "Schedule", type: "checkbox", defaultValue: () => Boolean(spec.suspend) },
        { name: "successfulJobsHistoryLimit", label: "Successful History", section: "History", type: "number", defaultValue: () => String(spec.successfulJobsHistoryLimit ?? 3) },
        { name: "failedJobsHistoryLimit", label: "Failed History", section: "History", type: "number", defaultValue: () => String(spec.failedJobsHistoryLimit ?? 1) },
      ],
      patch: (values) => ({ spec: { schedule: values.schedule, suspend: values.suspend === true, successfulJobsHistoryLimit: numberFromValue(values.successfulJobsHistoryLimit, 3), failedJobsHistoryLimit: numberFromValue(values.failedJobsHistoryLimit, 1) } }),
    })
  }

  if (kind === "HorizontalPodAutoscaler") {
    add({
      id: "edit-hpa-bounds",
      label: "Edit Bounds",
      description: "Update HPA minimum and maximum replicas.",
      fields: [
        { name: "minReplicas", label: "Min Replicas", section: "Scale", type: "number", defaultValue: () => String(spec.minReplicas ?? 1) },
        { name: "maxReplicas", label: "Max Replicas", section: "Scale", type: "number", defaultValue: () => String(spec.maxReplicas ?? 3) },
      ],
      patch: (values) => ({ spec: { minReplicas: numberFromValue(values.minReplicas, 1), maxReplicas: numberFromValue(values.maxReplicas, 3) } }),
    })
  }

  if (["VirtualMachine", "VirtualMachineInstance", "VirtualMachinePool", "VirtualMachineInstanceReplicaSet"].includes(kind)) {
    const templateSpec = kind === "VirtualMachinePool" ? asRecord(getValue(resource, ["spec", "virtualMachineTemplate", "spec", "template", "spec"])) : asRecord(getValue(resource, ["spec", "template", "spec"]))
    const domain = asRecord(templateSpec.domain || getValue(resource, ["spec", "domain"]))
    const cpu = asRecord(domain.cpu)
    add({
      id: "edit-virtualization-runtime",
      label: "Edit Runtime",
      description: `Update ${kind} run strategy, CPU, memory, and priority class.`,
      fields: [
        { name: "runStrategy", label: "Run Strategy", section: "Lifecycle", type: "select", defaultValue: () => compactValue(spec.runStrategy || "Halted"), options: [{ label: "Halted", value: "Halted" }, { label: "Always", value: "Always" }, { label: "Manual", value: "Manual" }] },
        { name: "sockets", label: "CPU Sockets", section: "Compute", type: "number", defaultValue: () => String(cpu.sockets ?? 1) },
        { name: "cores", label: "CPU Cores", section: "Compute", type: "number", defaultValue: () => String(cpu.cores ?? cpu.guest ?? 1) },
        { name: "threads", label: "CPU Threads", section: "Compute", type: "number", defaultValue: () => String(cpu.threads ?? 1) },
        { name: "memory", label: "Memory", section: "Compute", defaultValue: () => compactValue(asRecord(asRecord(domain.resources).requests).memory || asRecord(domain.memory).guest || "1Gi") },
        { name: "priorityClassName", label: "Priority Class", section: "Scheduling", defaultValue: () => compactValue(templateSpec.priorityClassName) },
      ],
      patch: (values) => {
        const templatePatch = {
          spec: {
            priorityClassName: values.priorityClassName || null,
            domain: {
              cpu: { sockets: numberFromValue(values.sockets, 1), cores: numberFromValue(values.cores, 1), threads: numberFromValue(values.threads, 1) },
              resources: { requests: { memory: values.memory } },
            },
          },
        }
        if (kind === "VirtualMachinePool") return { spec: { virtualMachineTemplate: { spec: { runStrategy: values.runStrategy, template: templatePatch } } } }
        if (kind === "VirtualMachine") return { spec: { runStrategy: values.runStrategy, template: templatePatch } }
        return { spec: templatePatch.spec }
      },
    })
  }

  if (kind === "Service") {
    add({
      id: "edit-service-routing",
      label: "Edit Service",
      description: "Update service type, selector, external IPs, and load balancer IP.",
      fields: [
        { name: "type", label: "Type", section: "Routing", type: "select", defaultValue: () => compactValue(spec.type || "ClusterIP"), options: [{ label: "ClusterIP", value: "ClusterIP" }, { label: "NodePort", value: "NodePort" }, { label: "LoadBalancer", value: "LoadBalancer" }, { label: "ExternalName", value: "ExternalName" }] },
        { name: "selector", label: "Selector", section: "Routing", type: "textarea", defaultValue: () => textFromRecord(spec.selector), placeholder: "key=value per line" },
        { name: "externalIPs", label: "External IPs", section: "Routing", defaultValue: () => csvFromList(spec.externalIPs), placeholder: "comma-separated" },
        { name: "loadBalancerIP", label: "Load Balancer IP", section: "Routing", defaultValue: () => compactValue(spec.loadBalancerIP) },
      ],
      patch: (values) => ({ spec: { type: values.type, selector: recordFromText(values.selector), externalIPs: listFromCsv(values.externalIPs), loadBalancerIP: values.loadBalancerIP || null } }),
    })
  }

  if (["NetworkPolicy", "CiliumNetworkPolicy", "CiliumClusterwideNetworkPolicy"].includes(kind) || config.path.includes("/calico/") || config.path.includes("/cilium/")) {
    add({
      id: "edit-network-policy",
      label: "Edit Policy",
      description: `Update ${kind} selectors and policy type fields.`,
      fields: [
        { name: "selector", label: "Selector / Endpoint Selector", section: "Policy", type: "textarea", defaultValue: () => textFromRecord(asRecord(spec.podSelector).matchLabels || asRecord(spec.endpointSelector).matchLabels), placeholder: "key=value per line" },
        { name: "policyTypes", label: "Policy Types", section: "Policy", defaultValue: () => csvFromList(spec.policyTypes || spec.types), placeholder: "Ingress,Egress" },
        { name: "specFields", label: `${kind} Spec Fields`, section: "Advanced Fields", type: "textarea", defaultValue: () => "", placeholder: "topLevelSpecKey=value per line" },
      ],
      patch: (values) => ({
        spec: {
          ...(kind.startsWith("Cilium") ? { endpointSelector: { matchLabels: recordFromText(values.selector) } } : { podSelector: { matchLabels: recordFromText(values.selector) } }),
          ...(kind.startsWith("Cilium") ? {} : { policyTypes: listFromCsv(values.policyTypes) }),
          ...asRecord(specBasicsPatch(values).spec),
        },
      }),
    })
  } else if (["Ingress", "IngressClass", "Gateway", "GatewayClass", "HTTPRoute", "NetworkAttachmentDefinition", "Endpoints", "EndpointSlice"].includes(kind) || config.path.includes("/networks/") || config.path.includes("/kube-ovn/")) {
    add({
      id: "edit-network-fields",
      label: `Edit ${kind}`,
      description: `Update common ${kind} network fields without editing YAML.`,
      fields: [
        { name: "className", label: "Class Name", section: "Routing", defaultValue: () => compactValue(spec.ingressClassName || spec.gatewayClassName || spec.controllerName) },
        { name: "hostnames", label: "Hostnames", section: "Routing", defaultValue: () => csvFromList(spec.hostnames), placeholder: "comma-separated" },
        { name: "specFields", label: `${kind} Spec Fields`, section: "Advanced Fields", type: "textarea", defaultValue: () => "", placeholder: "topLevelSpecKey=value per line" },
      ],
      patch: (values) => ({ spec: { ingressClassName: values.className || undefined, gatewayClassName: values.className || undefined, hostnames: listFromCsv(values.hostnames), ...asRecord(specBasicsPatch(values).spec) } }),
    })
  }

  if (["ConfigMap", "Secret"].includes(kind)) {
    add({
      id: "edit-config-data",
      label: "Edit Data",
      description: `Update ${kind} data keys.`,
      fields: [{ name: "data", label: "Data", section: "Data", type: "textarea", defaultValue: () => textFromRecord(resource.data), placeholder: "key=value per line" }],
      patch: (values) => ({ data: recordFromText(values.data) }),
    })
  }

  if (["PersistentVolumeClaim", "PersistentVolume", "StorageClass", "VolumeSnapshot", "VolumeSnapshotClass", "VolumeSnapshotContent", "DataVolume", "DataSource", "StorageProfile"].includes(kind) || config.path.includes("/storage/") || config.path.includes("/cdi/")) {
    add({
      id: "edit-storage",
      label: `Edit ${kind}`,
      description: `Update common ${kind} storage fields.`,
      fields: [
        { name: "storageClassName", label: "Storage Class", section: "Storage", defaultValue: () => compactValue(spec.storageClassName || resource.storageClassName) },
        { name: "storage", label: "Requested Storage", section: "Storage", defaultValue: () => compactValue(asRecord(asRecord(spec.resources).requests).storage || asRecord(asRecord(resource.status).capacity).storage) },
        { name: "reclaimPolicy", label: "Reclaim Policy", section: "Lifecycle", type: "select", defaultValue: () => compactValue(resource.reclaimPolicy || spec.persistentVolumeReclaimPolicy || "Retain"), options: [{ label: "Retain", value: "Retain" }, { label: "Delete", value: "Delete" }, { label: "Recycle", value: "Recycle" }] },
        { name: "parameters", label: "Parameters", section: "Parameters", type: "textarea", defaultValue: () => textFromRecord(resource.parameters), placeholder: "key=value per line" },
      ],
      patch: (values) => kind === "StorageClass"
        ? { reclaimPolicy: values.reclaimPolicy, parameters: recordFromText(values.parameters) }
        : { spec: { storageClassName: values.storageClassName || undefined, persistentVolumeReclaimPolicy: values.reclaimPolicy || undefined, resources: { requests: { storage: values.storage } } } },
    })
  }

  if (["Role", "ClusterRole"].includes(kind)) {
    add({
      id: "edit-rbac-rules",
      label: "Edit Rules",
      description: "Replace RBAC rules using line-oriented fields.",
      fields: [{ name: "rules", label: "Rules", section: "RBAC", type: "textarea", defaultValue: () => asRecordList(resource.rules).map((rule) => `${csvFromList(rule.apiGroups)}|${csvFromList(rule.resources)}|${csvFromList(rule.verbs)}`).join("\n"), placeholder: "apiGroups|resources|verbs per line" }],
      patch: (values) => ({
        rules: String(values.rules || "").split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
          const [apiGroups, resources, verbs] = line.split("|")
          return { apiGroups: listFromCsv(apiGroups), resources: listFromCsv(resources), verbs: listFromCsv(verbs) }
        }),
      }),
    })
  }

  if (["RoleBinding", "ClusterRoleBinding"].includes(kind)) {
    const roleRef = asRecord(resource.roleRef)
    add({
      id: "edit-rbac-binding",
      label: "Edit Binding",
      description: "Update role reference and subjects.",
      fields: [
        { name: "roleKind", label: "Role Kind", section: "Role Ref", type: "select", defaultValue: () => compactValue(roleRef.kind || "Role"), options: [{ label: "Role", value: "Role" }, { label: "ClusterRole", value: "ClusterRole" }] },
        { name: "roleName", label: "Role Name", section: "Role Ref", defaultValue: () => compactValue(roleRef.name) },
        { name: "subjects", label: "Subjects", section: "Subjects", type: "textarea", defaultValue: () => asRecordList(resource.subjects).map((subject) => `${compactValue(subject.kind)}|${compactValue(subject.name)}|${compactValue(subject.namespace)}`).join("\n"), placeholder: "Kind|Name|Namespace per line" },
      ],
      patch: (values) => ({
        roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: values.roleKind, name: values.roleName },
        subjects: String(values.subjects || "").split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
          const [subjectKind, name, namespace] = line.split("|")
          return { kind: subjectKind, name, ...(namespace ? { namespace } : {}) }
        }),
      }),
    })
  }

  if (["MutatingWebhookConfiguration", "ValidatingWebhookConfiguration"].includes(kind)) {
    add({
      id: "edit-webhook-policy",
      label: "Edit Webhooks",
      description: "Update admission webhook failure policy, match policy, timeout, and side effects.",
      fields: [
        { name: "failurePolicy", label: "Failure Policy", section: "Policy", type: "select", defaultValue: () => compactValue(asRecordList(resource.webhooks)[0]?.failurePolicy || "Fail"), options: [{ label: "Fail", value: "Fail" }, { label: "Ignore", value: "Ignore" }] },
        { name: "matchPolicy", label: "Match Policy", section: "Policy", type: "select", defaultValue: () => compactValue(asRecordList(resource.webhooks)[0]?.matchPolicy || "Equivalent"), options: [{ label: "Equivalent", value: "Equivalent" }, { label: "Exact", value: "Exact" }] },
        { name: "sideEffects", label: "Side Effects", section: "Policy", type: "select", defaultValue: () => compactValue(asRecordList(resource.webhooks)[0]?.sideEffects || "None"), options: [{ label: "None", value: "None" }, { label: "NoneOnDryRun", value: "NoneOnDryRun" }] },
        { name: "timeoutSeconds", label: "Timeout Seconds", section: "Policy", type: "number", defaultValue: () => String(asRecordList(resource.webhooks)[0]?.timeoutSeconds || 10) },
      ],
      patch: (values) => ({
        webhooks: asRecordList(resource.webhooks).map((webhook) => ({
          ...webhook,
          failurePolicy: values.failurePolicy,
          matchPolicy: values.matchPolicy,
          sideEffects: values.sideEffects,
          timeoutSeconds: numberFromValue(values.timeoutSeconds, 10),
        })),
      }),
    })
  }

  if (["ValidatingAdmissionPolicy", "ValidatingAdmissionPolicyBinding", "APIService", "CustomResourceDefinition", "FlowSchema", "PriorityLevelConfiguration", "RuntimeClass", "PriorityClass", "Namespace", "Lease"].includes(kind)) {
    add({
      id: "edit-control-plane",
      label: `Edit ${kind}`,
      description: `Update safe top-level spec fields for ${kind}.`,
      fields: [{ name: "specFields", label: `${kind} Spec Fields`, section: "Spec", type: "textarea", defaultValue: () => "", placeholder: "topLevelSpecKey=value per line" }],
      patch: specBasicsPatch,
    })
  }

  if (canDeleteResource(config)) {
    actions.push({
      id: "delete-resource",
      label: `Delete ${kind}`,
      description: `Delete this ${kind}.`,
      confirmLabel: "Delete",
      variant: "destructive",
      buildRequest: () => ({
        url: resourceActionUrl(config, resource),
        options: { method: "DELETE" },
        navigateTo: config.path,
      }),
    })
  }

  return actions
}

const groupFields = (fields?: CreateFormField[]) => {
  const groups = new Map<string, CreateFormField[]>()
  ;(fields || []).forEach((field) => {
    const section = field.section || "General"
    groups.set(section, [...(groups.get(section) || []), field])
  })
  return Array.from(groups.entries()).map(([section, items]) => ({ section, items }))
}

function FormField({ field, value, onChange }: { field: CreateFormField; value: string | boolean; onChange: (value: string | boolean) => void }) {
  const id = `create-${field.name}`
  return (
    <label htmlFor={id} className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-foreground">{field.label}{field.required && <span className="text-destructive"> *</span>}</span>
      {field.type === "textarea" ? (
        <textarea
          id={id}
          value={String(value)}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.placeholder}
          className="min-h-24 rounded-lg border bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      ) : field.type === "select" ? (
        <select
          id={id}
          value={String(value)}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
        >
          {(field.options || []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      ) : field.type === "checkbox" ? (
        <div className="flex h-9 items-center gap-2">
          <input
            id={id}
            type="checkbox"
            checked={Boolean(value)}
            onChange={(event) => onChange(event.target.checked)}
            className="h-4 w-4 rounded border-border accent-primary"
          />
          <span className="text-sm text-muted-foreground">{field.placeholder || "Enabled"}</span>
        </div>
      ) : (
        <Input
          id={id}
          type={field.type === "number" ? "number" : "text"}
          value={String(value)}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.placeholder}
        />
      )}
      {field.description && <span className="text-xs text-muted-foreground">{field.description}</span>}
    </label>
  )
}

export function ResourceCreateDialog({ config, onCreated, defaultNamespace }: { config: ResourceConfig; onCreated: () => void; defaultNamespace?: string }) {
  const createFields = useMemo(() => effectiveCreateFields(config), [config])
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState<Record<string, string | boolean>>(() => createFieldDefaults(createFields, defaultNamespace))
  const [content, setContent] = useState("")
  const [advanced, setAdvanced] = useState(false)
  const [yamlEdited, setYamlEdited] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const previewResource = useMemo(
    () => buildEffectiveCreateResource(config, values),
    [config, values]
  )
  const fieldGroups = useMemo(() => groupFields(createFields), [createFields])

  useEffect(() => {
    if (!yamlEdited) {
      const resources = Array.isArray(previewResource) ? previewResource : [previewResource]
      setContent(resources.map((resource) => YAML.dump(resource, { noRefs: true, lineWidth: 120 })).join("---\n"))
    }
  }, [previewResource, yamlEdited])

  useEffect(() => {
    if (!open) {
      setValues(createFieldDefaults(createFields, defaultNamespace))
      setAdvanced(false)
      setYamlEdited(false)
      setError("")
    }
  }, [createFields, defaultNamespace, open])

  const createResource = async () => {
    setSaving(true)
    setError("")
    try {
      const parsed = YAML.loadAll(content).filter(Boolean) as KubeResource[]
      if (parsed.length === 0) throw new Error("at least one resource is required")

      for (const resource of parsed) {
        if (!resource?.metadata?.name) throw new Error("metadata.name is required")
        if (config.namespaced && !resource.metadata.namespace) throw new Error("metadata.namespace is required")

        if (config.createResourcePath) {
          const res = await apiFetch(config.createResourcePath(resource), {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify(resource),
          })
          if (!res.ok) throw new Error(`${resource.kind || "Resource"} ${resource.metadata.name}: ${await res.text()}`)
          continue
        }

        let created = false
        let lastError = ""
        for (const path of await servedPaths(config)) {
          const nextResource = { ...resource, apiVersion: path.apiVersion || resource.apiVersion }
          const res = await apiFetch(createPathUrl(config, path.resourcePath, resource), {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify(nextResource),
          })
          if (res.ok) {
            created = true
            break
          }
          lastError = await res.text()
          if (res.status !== 404) break
        }
        if (!created) throw new Error(`${resource.kind || "Resource"} ${resource.metadata.name}: ${lastError || "Resource API is not served by this cluster"}`)
      }
      setOpen(false)
      setValues(createFieldDefaults(createFields, defaultNamespace))
      setYamlEdited(false)
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create resource")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" />
          Create
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>Create {config.kind}</DialogTitle>
          <DialogDescription>Fields on the left, generated YAML on the right.</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
            {fieldGroups.map((group) => (
              <div key={group.section} className="rounded-lg border bg-muted/20 p-4">
                <div className="mb-3 text-sm font-semibold text-foreground">{group.section}</div>
                <div className="grid gap-4 md:grid-cols-2">
                  {group.items.map((field) => (
                    <div key={field.name} className={field.type === "textarea" ? "md:col-span-2" : ""}>
                      <FormField
                        field={field}
                        value={values[field.name] ?? ""}
                        onChange={(next) => {
                          setValues((current) => ({ ...current, [field.name]: next }))
                          setYamlEdited(false)
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="min-h-0 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-foreground">YAML Preview</div>
                <div className="text-xs text-muted-foreground">{advanced ? "Advanced editing enabled" : "Generated from the form"}</div>
              </div>
              <Button
                type="button"
                variant={advanced ? "default" : "outline"}
                size="sm"
                onClick={() => setAdvanced((current) => !current)}
              >
                Advanced
              </Button>
            </div>
            <textarea
              value={content}
              readOnly={!advanced}
              onChange={(e) => {
                setContent(e.target.value)
                setYamlEdited(true)
              }}
              className={cn(
                "h-[65vh] min-h-[360px] w-full rounded-lg border bg-muted/30 p-4 font-mono text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring",
                !advanced && "cursor-default"
              )}
              spellCheck={false}
            />
          </div>
        </div>
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />
            <span className="break-words">{error}</span>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={createResource} disabled={saving}>{saving ? "Creating..." : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function requestPreview(action: ResourceAction, resource: KubeResource, values: Record<string, string | boolean>) {
  try {
    const request = action.buildRequest(resource, values)
    return YAML.dump({
      url: request.url,
      method: request.options?.method || "GET",
      headers: request.options?.headers,
      body: typeof request.options?.body === "string" ? YAML.load(request.options.body) || request.options.body : request.options?.body,
    }, { noRefs: true, lineWidth: 120 })
  } catch (err) {
    return err instanceof Error ? err.message : "Unable to preview request"
  }
}

function ResourceActionDialog({
  action,
  resource,
  onComplete,
  open: controlledOpen,
  onOpenChange,
}: {
  action: ResourceAction
  resource: KubeResource
  onComplete: (navigateTo?: string) => void
  /** When provided, the dialog is controlled and renders no trigger button. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const controlled = controlledOpen !== undefined
  const open = controlled ? controlledOpen : uncontrolledOpen
  const setOpen = (next: boolean) => (controlled ? onOpenChange?.(next) : setUncontrolledOpen(next))
  const [values, setValues] = useState<Record<string, string | boolean>>(() => resourceFieldDefaults(resource, action.fields))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (open) setValues(resourceFieldDefaults(resource, action.fields))
    else setError("")
  }, [action.fields, open, resource])

  const preview = useMemo(() => requestPreview(action, resource, values), [action, resource, values])

  const submit = async () => {
    setSaving(true)
    setError("")
    try {
      const request = action.buildRequest(resource, values)
      const res = await apiFetch(request.url, request.options || {})
      if (!res.ok) throw new Error(await res.text())
      setOpen(false)
      onComplete(request.navigateTo)
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action.label.toLowerCase()}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!controlled && (
        <DialogTrigger asChild>
          <Button size="sm" variant={action.variant || "outline"}>{action.label}</Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{action.label} {resource.kind || "Resource"}</DialogTitle>
          {action.description && <DialogDescription>{action.description}</DialogDescription>}
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-4">
            {(action.fields || []).length > 0 ? (action.fields || []).map((field) => (
              <FormField
                key={field.name}
                field={field}
                value={values[field.name] ?? ""}
                onChange={(next) => setValues((current) => ({ ...current, [field.name]: next }))}
              />
            )) : (
              <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
                This action will update the current resource.
              </div>
            )}
          </div>
          <div className="space-y-2">
            <div className="text-sm font-semibold text-foreground">Request Preview</div>
            <pre className="min-h-[220px] overflow-x-auto rounded-lg border bg-muted/30 p-4 font-mono text-xs text-foreground whitespace-pre">
              {preview}
            </pre>
          </div>
        </div>
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />
            <span className="break-words">{error}</span>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant={action.variant === "destructive" ? "destructive" : "default"} onClick={submit} disabled={saving}>
            {saving ? "Applying..." : action.confirmLabel || action.label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ResourceList({ config }: { config: ResourceConfig }) {
  const [items, setItems] = useState<KubeResource[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [namespaces, setNamespaces] = useState<string[]>(["all"])
  const [namespaceFilter, setNamespaceFilter] = useState("default")
  const [error, setError] = useState("")
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [deleting, setDeleting] = useState<KubeResource | null>(null)

  useEffect(() => {
    if (!config.namespaced) return
    let cancelled = false
    apiFetch("/api/v1/namespaces-list")
      .then(async (response) => {
        if (!response.ok) throw new Error(await response.text())
        return response.json() as Promise<string[]>
      })
      .then((data) => {
        if (cancelled) return
        const next = Array.from(new Set(["all", ...(data || []).filter(Boolean)]))
        setNamespaces(next)
        setNamespaceFilter((current) => {
          if (current && next.includes(current)) return current
          return next.includes("default") ? "default" : next.find((ns) => ns !== "all") || "all"
        })
      })
      .catch(() => {
        if (cancelled) return
        setNamespaces(["all", "default"])
        setNamespaceFilter("default")
      })
    return () => {
      cancelled = true
    }
  }, [config.id, config.namespaced])

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      let loaded = false
      let lastError = ""
      const paths = await servedPaths(config)
      for (const path of paths) {
        const res = await apiFetch(resourceListUrl(config, path, namespaceFilter))
        if (res.ok) {
          const data = await res.json()
          setItems(data.items || [])
          setSelected({})
          loaded = true
          break
        }
        lastError = await res.text()
        if (res.status !== 404) break
      }
      if (!loaded) throw new Error(lastError || "Resource API is not served by this cluster")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load resources")
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [config, namespaceFilter])

  useEffect(() => {
    load()
  }, [load])

  const filtered = useMemo(() => {
    const needle = search.toLowerCase()
    return items.filter((item) => {
      const ns = item.metadata.namespace || ""
      return item.metadata.name.toLowerCase().includes(needle) || ns.toLowerCase().includes(needle)
    })
  }, [items, search])

  const emptyTitle = search ? "No matching resources" : `No ${config.title.toLowerCase()} found`
  const emptyDescription = search
    ? "Clear or change the search text to see other resources."
    : config.namespaced && namespaceFilter !== "all"
      ? `This API returned an empty list for namespace ${namespaceFilter}.`
      : "This API returned an empty list for the current cluster context."
  const tableColumnCount = 5 + (config.namespaced ? 1 : 0) + (config.extraColumns?.length || 0)
  const selectedCount = Object.values(selected).filter(Boolean).length

  const remove = async (item: KubeResource) => {
    let lastError = ""
    for (const path of await servedPaths(config)) {
      const res = await apiFetch(resourcePathUrl(config, path.resourcePath, item.metadata.name, item.metadata.namespace), { method: "DELETE" })
      if (res.ok) {
        load()
        return
      }
      lastError = await res.text()
      if (res.status !== 404) break
    }
    throw new Error(lastError || "Delete failed")
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={config.title}
        badge={!loading && <span className="text-sm text-muted-foreground tabular-nums">{items.length}</span>}
        subtitle={<span className="font-mono text-xs">{config.kind} · {config.listPath.split("/").slice(1, -1).join("/")}</span>}
        actions={canCreateResource(config) && <ResourceCreateDialog config={config} onCreated={load} defaultNamespace={namespaceFilter} />}
      />

      <Toolbar
        right={
          <div className="relative w-full md:w-[280px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Filter by name or namespace" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        }
      >
        <Button size="sm" variant="outline" onClick={load} className="gap-2">
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          Refresh
        </Button>
        {config.namespaced && (
          <NativeSelect className="min-w-[160px]" value={namespaceFilter} onChange={(event) => setNamespaceFilter(event.target.value)} aria-label="Namespace">
            {namespaces.map((ns) => <option key={ns} value={ns}>{ns === "all" ? "All namespaces" : ns}</option>)}
          </NativeSelect>
        )}
        {selectedCount > 0 && <span className="text-sm text-muted-foreground">{selectedCount} selected</span>}
      </Toolbar>

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="max-h-[calc(100dvh-220px)] overflow-auto">
          <Table className="min-w-[760px]">
            <TableHeader className="bg-muted/60">
              <TableRow>
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    className="size-4 rounded border-border accent-primary"
                    checked={filtered.length > 0 && filtered.every((item) => selected[item.metadata.uid || item.metadata.name])}
                    onChange={(event) => {
                      const checked = event.target.checked
                      setSelected((current) => {
                        const next = { ...current }
                        filtered.forEach((item) => {
                          next[item.metadata.uid || item.metadata.name] = checked
                        })
                        return next
                      })
                    }}
                    aria-label="Select all rows"
                  />
                </TableHead>
                <TableHead className="h-9 px-3 text-xs font-medium text-muted-foreground">Name</TableHead>
                {config.namespaced && <TableHead className="h-9 px-3 text-xs font-medium text-muted-foreground">Namespace</TableHead>}
                <TableHead className="h-9 px-3 text-xs font-medium text-muted-foreground">Status</TableHead>
                {config.extraColumns?.map((column) => <TableHead key={column.label} className="h-9 px-3 text-xs font-medium text-muted-foreground">{column.label}</TableHead>)}
                <TableHead className="h-9 px-3 text-right text-xs font-medium text-muted-foreground">Age</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={tableColumnCount}><LoadingState /></TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={tableColumnCount}>
                    <EmptyState title={emptyTitle} description={emptyDescription} />
                  </TableCell>
                </TableRow>
              ) : filtered.map((item) => {
                const rowKey = item.metadata.uid || `${item.metadata.namespace || "_cluster"}-${item.metadata.name}`
                return (
                <TableRow key={rowKey} className="hover:bg-muted/50">
                  <TableCell className="h-10 px-3 py-1.5">
                    <input
                      type="checkbox"
                      className="size-4 rounded border-border accent-primary"
                      checked={Boolean(selected[rowKey])}
                      onChange={(event) => setSelected((current) => ({ ...current, [rowKey]: event.target.checked }))}
                      aria-label={`Select ${item.metadata.name}`}
                    />
                  </TableCell>
                  <TableCell className="h-9 px-3 py-1.5">
                    <Link
                      to={`${config.path}/${item.metadata.namespace || "_cluster"}/${item.metadata.name}`}
                      className="font-medium hover:text-primary transition-colors"
                    >
                      {item.metadata.name}
                    </Link>
                  </TableCell>
                  {config.namespaced && <TableCell className="h-9 px-3 py-1.5 text-sm text-muted-foreground">{item.metadata.namespace}</TableCell>}
                  <TableCell className="h-9 px-3 py-1.5"><ResourceStatus resource={item} config={config} /></TableCell>
                  {config.extraColumns?.map((column) => (
                    <TableCell key={column.label} className="h-9 px-3 py-1.5 text-sm text-muted-foreground">{column.value(item) || "N/A"}</TableCell>
                  ))}
                  <TableCell className="h-9 px-3 py-1.5 text-right text-sm text-muted-foreground tabular-nums" title={item.metadata.creationTimestamp}>
                    {relativeTime(item.metadata.creationTimestamp)}
                  </TableCell>
                  <TableCell className="h-9 px-3 py-1.5">
                    {canDeleteResource(config) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleting(item)}
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </div>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${config.kind} ${deleting?.metadata.name}?`}
        description={deleting?.metadata.namespace ? `Namespace ${deleting.metadata.namespace}. This cannot be undone.` : "This cannot be undone."}
        destructive
        confirmLabel="Delete"
        onConfirm={async () => {
          if (deleting) await remove(deleting)
        }}
      />
    </div>
  )
}

export function ResourceDetail({ config }: { config: ResourceConfig }) {
  const { namespace, name } = useParams()
  const navigate = useNavigate()
  const [resource, setResource] = useState<KubeResource | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [openAction, setOpenAction] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError("")
      try {
        let loaded = false
        let lastError = ""
        for (const path of await servedPaths(config)) {
          const res = await apiFetch(resourcePathUrl(config, path.resourcePath, name!, namespace))
          if (res.ok) {
            setResource(await res.json())
            loaded = true
            break
          }
          lastError = await res.text()
          if (res.status !== 404) break
        }
        if (!loaded) throw new Error(lastError || "Resource API is not served by this cluster")
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load resource")
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [config, name, namespace])

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center gap-2">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-primary" />
        <span className="text-sm text-muted-foreground">Loading...</span>
      </div>
    )
  }

  if (!resource) {
    return (
      <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
        {error || "Resource not found"}
      </div>
    )
  }

  const labels = Object.entries(resource.metadata.labels || {})
  const annotations = Object.entries(resource.metadata.annotations || {})
  const reload = (navigateTo?: string) => {
    if (navigateTo) {
      navigate(navigateTo)
      return
    }
    setLoading(true)
    servedPaths(config)
      .then(async (paths) => {
        let lastError = ""
        for (const path of paths) {
          const res = await apiFetch(resourcePathUrl(config, path.resourcePath, name!, namespace))
          if (res.ok) {
            setResource(await res.json())
            return
          }
          lastError = await res.text()
          if (res.status !== 404) break
        }
        throw new Error(lastError || "Resource API is not served by this cluster")
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load resource"))
      .finally(() => setLoading(false))
  }

  const sections = [
    ...defaultDetailSections(resource),
    ...(config.detailSections ? config.detailSections(resource) : []),
  ].filter((section) => section.items.length > 0)
  const relatedPods = relatedPodsForResource(resource)
  const actions = [
    ...(config.actions || []),
    ...inferredResourceActions(config, resource).filter((action) => !(config.actions || []).some((existing) => existing.id === action.id)),
  ]

  const inlineActions = actions.length <= 3 ? actions : []
  const menuActions = actions.length <= 3 ? [] : actions

  return (
    <div className="space-y-5">
      <PageHeader
        breadcrumbs={[{ label: config.title, to: config.path }, ...(resource.metadata.namespace ? [{ label: resource.metadata.namespace }] : []), { label: resource.metadata.name }]}
        title={resource.metadata.name}
        badge={<ResourceStatus resource={resource} config={config} />}
        subtitle={
          <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
            <span className="font-mono">{resource.kind || config.kind}</span>
            {resource.apiVersion && <span className="font-mono">{resource.apiVersion}</span>}
            <span title={resource.metadata.creationTimestamp}>created {relativeTime(resource.metadata.creationTimestamp)}</span>
            {!resource.metadata.namespace && <span>cluster scoped</span>}
          </span>
        }
        actions={
          <>
            {inlineActions.map((action) => (
              <ResourceActionDialog key={action.id} action={action} resource={resource} onComplete={reload} />
            ))}
            {menuActions.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" className="gap-1.5">Actions<ChevronDown className="size-3.5" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  {menuActions.map((action) => (
                    <DropdownMenuItem key={action.id} variant={action.variant === "destructive" ? "destructive" : "default"} onClick={() => setOpenAction(action.id)}>
                      {action.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {menuActions.map((action) => (
              <ResourceActionDialog
                key={action.id}
                action={action}
                resource={resource}
                onComplete={reload}
                open={openAction === action.id}
                onOpenChange={(next) => setOpenAction(next ? action.id : null)}
              />
            ))}
          </>
        }
      />

      <DetailTabs config={config} namespace={namespace} name={name} active="overview" />

      <ResourceSpecificOverview resource={resource} config={config} sections={sections} />

      {relatedPods && (
        <RelatedPodsCard
          title={relatedPods.title}
          namespace={relatedPods.namespace}
          selector={relatedPods.selector}
          selectors={relatedPods.selectors}
          podName={relatedPods.podName}
          pods={relatedPods.pods}
        />
      )}

      {(labels.length > 0 || annotations.length > 0) && (
        <SectionCard title="Labels and annotations">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-1.5">
              {labels.map(([key, value]) => (
                <span key={key} className="rounded border bg-muted/60 px-1.5 py-0.5 font-mono text-xs">{key}={value}</span>
              ))}
              {labels.length === 0 && <span className="text-sm text-muted-foreground">No labels</span>}
            </div>
            {annotations.length > 0 && <CompactKvTable rows={annotations.map(([label, value]) => ({ label, value }))} />}
          </div>
        </SectionCard>
      )}
    </div>
  )
}

export function ResourceManifest({ config }: { config: ResourceConfig }) {
  const { namespace, name } = useParams()
  const [resource, setResource] = useState<KubeResource | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      let loaded = false
      let lastError = ""
      for (const path of await servedPaths(config)) {
        const res = await apiFetch(resourcePathUrl(config, path.resourcePath, name!, namespace))
        if (res.ok) {
          setResource(await res.json())
          loaded = true
          break
        }
        lastError = await res.text()
        if (res.status !== 404) break
      }
      if (!loaded) throw new Error(lastError || "Resource API is not served by this cluster")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load manifest")
      setResource(null)
    } finally {
      setLoading(false)
    }
  }, [config, name, namespace])

  useEffect(() => {
    load()
  }, [load])

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center gap-2">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-primary" />
        <span className="text-sm text-muted-foreground">Loading...</span>
      </div>
    )
  }

  const yaml = resource ? YAML.dump(resource, { noRefs: true, lineWidth: 120 }) : ""

  return (
    <div className="space-y-5">
      <PageHeader
        breadcrumbs={[{ label: config.title, to: config.path }, ...(namespace && namespace !== "_cluster" ? [{ label: namespace }] : []), { label: name || "" }]}
        title={name}
        subtitle={<span className="font-mono text-xs">{config.kind}</span>}
        actions={
          <>
            <Button size="sm" variant="outline" disabled={!yaml} onClick={() => navigator.clipboard.writeText(yaml)} className="gap-2">
              <Copy className="h-4 w-4" />
              Copy
            </Button>
            <Button size="sm" variant="outline" onClick={load} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </>
        }
      />

      <DetailTabs config={config} namespace={namespace} name={name} active="manifest" />

      {error ? (
        <ErrorNote>{error}</ErrorNote>
      ) : (
        <pre className="min-h-[calc(100dvh-260px)] overflow-x-auto rounded-lg border bg-card p-4 font-mono text-[13px] leading-relaxed text-foreground whitespace-pre">
          {yaml}
        </pre>
      )}
    </div>
  )
}
