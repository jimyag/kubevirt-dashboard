import { useCallback, useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import * as YAML from "js-yaml"
import {
  AlertTriangle,
  ChevronDown,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { relativeTime, replaceMap } from "@/lib/kube"
import { Combobox, ConfirmDialog, EmptyState, ErrorNote, FilterInput, LoadingState, PageHeader, Pager, StatusDot, Toolbar } from "@/components/console"
import { namespaceScope, useFilteredRows, usePaged, type FilterField } from "@/lib/filter"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
import { EventList } from "@/components/events"
import { eventsUrl } from "@/lib/events"
import { ManifestPanel } from "@/components/manifest"
import { t } from "@/lib/i18n"
import { ResourceSpecificOverview } from "@/components/resource-overviews"
import { MetadataSection } from "@/components/detail-parts"
import { asRecord, asRecordList, compactValue, getValue, hiddenAnnotations, isPrimitiveDetailValue, isRecordValue } from "@/lib/detail-values"

export type KubeResource = {
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
  /** Query string (without "?") added to list requests, e.g. a label selector. Kept out of listPath so discovery still sees the plural. */
  listQuery?: string
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

const resourceListUrl = (config: ResourceConfig, path: ServedPath, namespace: string) => {
  const url = config.namespaced && namespace !== "all"
    ? `${path.resourcePath}/namespaces/${namespace}/${config.id}`
    : path.listPath
  return config.listQuery ? `${url}?${config.listQuery}` : url
}

const createPathUrl = (config: ResourceConfig, basePath: string, resource: KubeResource) =>
  config.namespaced
    ? `${basePath}/namespaces/${resource.metadata.namespace}/${config.id}`
    : `${basePath}/${config.id}`

function DetailTabs({ config, namespace, name, active }: { config: ResourceConfig; namespace?: string; name?: string; active: "overview" | "events" | "manifest" }) {
  const scopedNamespace = namespace || "_cluster"
  const tabs = [
    { id: "overview", label: t("Overview"), to: `${config.path}/${scopedNamespace}/${name}` },
    { id: "events", label: t("Events"), to: `${config.path}/${scopedNamespace}/${name}/events` },
    { id: "manifest", label: t("Manifest"), to: `${config.path}/${scopedNamespace}/${name}/manifest` },
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
    title: t("Metadata"),
    items: [
      { label: t("Name"), value: resource.metadata.name },
      { label: t("Namespace"), value: resource.metadata.namespace || "cluster scoped" },
      { label: t("Created"), value: resource.metadata.creationTimestamp },
      { label: t("UID"), value: resource.metadata.uid },
    ],
  },
  {
    title: t("Status"),
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
    return { namespace, podName: name, pods: [podLikeResource(resource)], title: t("Pod Access") }
  }

  const selector = selectorFromMatchLabels(getValue(resource, ["spec", "selector", "matchLabels"]))
  if (selector && ["Deployment", "StatefulSet", "DaemonSet", "ReplicaSet", "Job"].includes(kind)) {
    return { namespace, selector, title: t("Managed Pods") }
  }

  const serviceSelector = selectorFromMatchLabels((spec as Record<string, unknown>).selector)
  if (kind === "Service" && serviceSelector) {
    return { namespace, selector: serviceSelector, title: t("Service Pods") }
  }

  const podSelector = selectorFromMatchLabels(getValue(resource, ["spec", "podSelector", "matchLabels"]))
  if (kind === "NetworkPolicy" && podSelector) {
    return { namespace, selector: podSelector, title: t("Selected Pods") }
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
      title: t("Virtual Machine Pods"),
    }
  }

  const templateLabels = selectorFromMatchLabels(getValue(resource, ["spec", "template", "metadata", "labels"]))
  if (templateLabels && ["VirtualMachinePool", "VirtualMachineInstanceReplicaSet"].includes(kind)) {
    return { namespace, selector: templateLabels, title: t("Managed Pods") }
  }

  return undefined
}

/** Status from the config path, the phase, or a Ready / Available condition (not just the first one). */
const readinessText = (resource: KubeResource) => {
  const conditions = asRecordList(getValue(resource, ["status", "conditions"]))
  const ready = conditions.find((item) => item.type === "Ready" || item.type === "Available") || conditions[0]
  if (!ready) return undefined
  if (ready.status === "True") return String(ready.type)
  return ready.type === "Ready" ? "NotReady" : ready.type === "Available" ? "Unavailable" : `${String(ready.type)} (${String(ready.status)})`
}

const conditionsStatusPath = (path?: string[]) => Boolean(path && path[0] === "status" && path[1] === "conditions")

const resourceStatusText = (resource: KubeResource, config: ResourceConfig) =>
  String(
    // Condition-based paths (often conditions[0].type) would name a condition even when it is False.
    (conditionsStatusPath(config.statusPath) ? readinessText(resource) : getValue(resource, config.statusPath)) ??
    getValue(resource, ["status", "phase"]) ??
    readinessText(resource) ??
    "Active"
  )

function ResourceStatus({ resource, config }: { resource: KubeResource; config: ResourceConfig }) {
  return <StatusDot status={resourceStatusText(resource, config)} />
}

const fieldKey = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")

/** Filterable fields of a generic resource list: the columns shown plus labels. */
const resourceFilterFields = (config: ResourceConfig): FilterField<KubeResource>[] => [
  { key: "name", label: t("Name"), value: (r) => r.metadata.name },
  ...(config.namespaced ? [{ key: "namespace", label: t("Namespace"), aliases: ["ns"], value: (r: KubeResource) => r.metadata.namespace }] : []),
  { key: "status", label: t("Status"), value: (r) => resourceStatusText(r, config) },
  ...(config.extraColumns || []).map((column) => ({ key: fieldKey(column.label), label: column.label, value: (r: KubeResource) => column.value(r) })),
  { key: "label", label: t("Labels"), value: (r) => Object.entries(r.metadata.labels || {}).map(([key, value]) => `${key}=${value}`) },
]

const fieldDefaults = (fields?: CreateFormField[]) =>
  Object.fromEntries((fields || []).map((field) => [field.name, typeof field.defaultValue === "function" ? "" : field.defaultValue ?? ""])) as Record<string, string | boolean>

const createFieldDefaults = (fields: CreateFormField[], defaultNamespace?: string) => {
  const defaults = fieldDefaults(fields)
  if (defaultNamespace && defaultNamespace !== "all" && "namespace" in defaults) defaults.namespace = defaultNamespace
  return defaults
}

// "N/A" is a display placeholder; it must never be prefilled into an editable field and sent back.
const editableDefault = (value: string | boolean) => (value === "N/A" ? "" : value)

const resourceFieldDefaults = (resource: KubeResource, fields?: CreateFormField[]) =>
  Object.fromEntries((fields || []).map((field) => [
    field.name,
    editableDefault(typeof field.defaultValue === "function" ? field.defaultValue(resource) : field.defaultValue ?? ""),
  ])) as Record<string, string | boolean>

/** Parses free-form spec values so "replicas=3" sends a number and "enabled=true" a boolean. */
const scalarFromText = (value: string): unknown => {
  if (value === "true" || value === "false") return value === "true"
  if (value === "null") return null
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value)
  if (/^[[{]/.test(value)) {
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  }
  return value
}

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
  { name: "name", label: t("Name"), section: "Identity", defaultValue: name, required: true },
  { name: "namespace", label: t("Namespace"), section: "Identity", defaultValue: "default", required: true },
]

const createNameOnlyFields = (name: string): CreateFormField[] => [
  { name: "name", label: t("Name"), section: "Identity", defaultValue: name, required: true },
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
  const spec = Object.fromEntries(Object.entries(recordFromText(values.specFields)).map(([key, value]) => [key, scalarFromText(String(value))]))
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
        { name: "priorityLevel", label: t("Priority level"), section: "Matching", defaultValue: "workload-low" },
        { name: "matchingPrecedence", label: t("Matching precedence"), section: "Matching", type: "number", defaultValue: "1000" },
        { name: "distinguisherMethod", label: t("Distinguisher method"), section: "Matching", type: "select", defaultValue: "ByUser", options: [{ label: t("By user"), value: "ByUser" }, { label: t("By namespace"), value: "ByNamespace" }] },
        { name: "subjects", label: t("Subjects"), section: "Rules", type: "textarea", defaultValue: "Group|system:authenticated", placeholder: t("Kind|Name per line") },
        { name: "verbs", label: t("Verbs"), section: "Rules", defaultValue: "*", placeholder: "comma-separated" },
        { name: "apiGroups", label: t("API groups"), section: "Rules", defaultValue: "*", placeholder: "comma-separated" },
        { name: "resources", label: t("Resources"), section: "Rules", defaultValue: "*", placeholder: "comma-separated" },
      ]
    case "PriorityLevelConfiguration":
      return [
        ...identity,
        { name: "type", label: t("Type"), section: "Priority", type: "select", defaultValue: "Limited", options: [{ label: t("Limited"), value: "Limited" }, { label: t("Exempt"), value: "Exempt" }] },
        { name: "assuredConcurrencyShares", label: t("Assured concurrency shares"), section: "Limited", type: "number", defaultValue: "30" },
        { name: "queues", label: t("Queues"), section: "Limited", type: "number", defaultValue: "64" },
        { name: "handSize", label: t("Hand size"), section: "Limited", type: "number", defaultValue: "8" },
        { name: "queueLengthLimit", label: t("Queue length limit"), section: "Limited", type: "number", defaultValue: "50" },
      ]
    case "APIService":
      return [
        ...identity,
        { name: "group", label: t("API group"), section: "API", defaultValue: "example.com" },
        { name: "version", label: t("API version"), section: "API", defaultValue: "v1" },
        { name: "serviceNamespace", label: t("Service namespace"), section: "Service", defaultValue: "default" },
        { name: "serviceName", label: t("Service name"), section: "Service", defaultValue: "example-apiserver" },
        { name: "insecureSkipTLSVerify", label: t("Skip TLS verify"), section: "TLS", type: "checkbox", defaultValue: true },
        { name: "groupPriorityMinimum", label: t("Group priority"), section: "Priority", type: "number", defaultValue: "1000" },
        { name: "versionPriority", label: t("Version priority"), section: "Priority", type: "number", defaultValue: "15" },
      ]
    case "CustomResourceDefinition":
      return [
        ...identity,
        { name: "group", label: t("Group"), section: "Names", defaultValue: "example.com" },
        { name: "plural", label: t("Plural"), section: "Names", defaultValue: "examples" },
        { name: "singular", label: t("Singular"), section: "Names", defaultValue: "example" },
        { name: "kind", label: t("Kind"), section: "Names", defaultValue: "Example" },
        { name: "scope", label: t("Scope"), section: "Schema", type: "select", defaultValue: "Namespaced", options: [{ label: t("Namespaced"), value: "Namespaced" }, { label: t("Cluster"), value: "Cluster" }] },
        { name: "version", label: t("Version"), section: "Schema", defaultValue: "v1" },
      ]
    case "CertificateSigningRequest":
      return [...identity, { name: "request", label: t("CSR request PEM/Base64"), section: "Request", type: "textarea", defaultValue: "", placeholder: t("Paste CSR request bytes or base64") }, { name: "signerName", label: t("Signer name"), section: "Request", defaultValue: "kubernetes.io/kube-apiserver-client" }, { name: "usages", label: t("Usages"), section: "Request", defaultValue: "client auth", placeholder: "comma-separated" }]
    case "Node":
      return [...identity, { name: "labels", label: t("Labels"), section: "Metadata", type: "textarea", defaultValue: "kubernetes.io/os=linux", placeholder: "key=value per line" }, { name: "podCIDR", label: t("Pod CIDR"), section: "Spec", defaultValue: "", placeholder: "optional" }, { name: "providerID", label: t("Provider ID"), section: "Spec", defaultValue: "", placeholder: "optional" }]
    case "Endpoints":
      return [...identity, { name: "addresses", label: t("Addresses"), section: "Endpoint", defaultValue: "10.0.0.1", placeholder: "comma-separated IPs" }, { name: "port", label: t("Port"), section: "Endpoint", type: "number", defaultValue: "80" }, { name: "protocol", label: t("Protocol"), section: "Endpoint", type: "select", defaultValue: "TCP", options: [{ label: t("TCP"), value: "TCP" }, { label: t("UDP"), value: "UDP" }, { label: t("SCTP"), value: "SCTP" }] }]
    case "EndpointSlice":
      return [...identity, { name: "serviceName", label: t("Service name"), section: "Discovery", defaultValue: "example-service" }, { name: "addressType", label: t("Address type"), section: "Discovery", type: "select", defaultValue: "IPv4", options: [{ label: t("IPv4"), value: "IPv4" }, { label: t("IPv6"), value: "IPv6" }, { label: t("FQDN"), value: "FQDN" }] }, { name: "addresses", label: t("Addresses"), section: "Discovery", defaultValue: "10.0.0.1", placeholder: "comma-separated" }, { name: "port", label: t("Port"), section: "Ports", type: "number", defaultValue: "80" }]
    case "Event":
      return [...identity, { name: "involvedKind", label: t("Involved kind"), section: "Event", defaultValue: "Pod" }, { name: "involvedName", label: t("Involved name"), section: "Event", defaultValue: "example-pod" }, { name: "reason", label: t("Reason"), section: "Event", defaultValue: "ManualEvent" }, { name: "message", label: t("Message"), section: "Event", defaultValue: "Created from dashboard" }, { name: "type", label: t("Type"), section: "Event", type: "select", defaultValue: "Normal", options: [{ label: t("Normal"), value: "Normal" }, { label: t("Warning"), value: "Warning" }] }]
    case "ReplicaSet":
    case "ControllerRevision":
      return [...identity, { name: "labels", label: t("Labels"), section: "Metadata", type: "textarea", defaultValue: "app=example", placeholder: "key=value per line" }, { name: "replicas", label: t("Replicas"), section: "Spec", type: "number", defaultValue: "1" }, { name: "image", label: t("Container image"), section: "Template", defaultValue: "nginx:latest" }]
    default:
      if (config.path.includes("/calico/") || config.path.includes("/cilium/") || config.path.includes("/kube-ovn/")) {
        return [...identity, { name: "labels", label: t("Labels"), section: "Metadata", type: "textarea", defaultValue: "", placeholder: "key=value per line" }, { name: "selector", label: t("Selector"), section: "Spec", defaultValue: "all()", placeholder: "selector expression or label selector" }, { name: "cidrs", label: t("CIDRs / nets"), section: "Spec", defaultValue: "", placeholder: "comma-separated" }, { name: "specFields", label: t("{v0} Spec Fields", { v0: config.kind }), section: "Spec", type: "textarea", defaultValue: "", placeholder: "topLevelSpecKey=value per line" }]
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
    { name: "labels", label: t("Labels"), section: "Metadata", type: "textarea", defaultValue: (r) => textFromRecord(r.metadata.labels), placeholder: "key=value per line" },
    { name: "annotations", label: t("Annotations"), section: "Metadata", type: "textarea", defaultValue: (r) => textFromRecord(r.metadata.annotations), placeholder: "key=value per line" },
  ]
  const actions: ResourceAction[] = [
    resourceAction(config, resource, {
      id: "edit-metadata",
      label: t("Edit metadata"),
      description: t("Update {v0} labels and annotations.", { v0: kind }),
      fields: metadataFields,
      patch: (values) => ({ metadata: { labels: replaceMap(resource.metadata.labels, recordFromText(values.labels)), annotations: replaceMap(resource.metadata.annotations, recordFromText(values.annotations)) } }),
    }),
  ]

  const add = (action: Omit<ResourceAction, "buildRequest"> & { patch: (values: Record<string, string | boolean>) => unknown; contentType?: "merge" | "json" }) =>
    actions.push(resourceAction(config, resource, action))

  if (["Deployment", "StatefulSet", "ReplicaSet", "ReplicationController"].includes(kind)) {
    add({
      id: "edit-workload-scale",
      label: t("Edit scale"),
      description: t("Set {v0} replica count.", { v0: kind }),
      fields: [{ name: "replicas", label: t("Replicas"), section: "Scale", type: "number", defaultValue: () => String(spec.replicas ?? 1) }],
      patch: (values) => ({ spec: { replicas: numberFromValue(values.replicas, 1) } }),
    })
  }

  if (["Deployment", "StatefulSet", "DaemonSet", "ReplicaSet", "ReplicationController", "Job", "CronJob"].includes(kind)) {
    const template = kind === "CronJob" ? asRecord(getValue(resource, ["spec", "jobTemplate", "spec", "template"])) : asRecord(spec.template)
    add({
      id: "edit-pod-template-metadata",
      label: t("Edit template"),
      description: t("Update {v0} pod template labels and annotations.", { v0: kind }),
      fields: [
        { name: "labels", label: t("Template labels"), section: "Pod Template", type: "textarea", defaultValue: () => textFromRecord(asRecord(template.metadata).labels), placeholder: "key=value per line" },
        { name: "annotations", label: t("Template annotations"), section: "Pod Template", type: "textarea", defaultValue: () => textFromRecord(asRecord(template.metadata).annotations), placeholder: "key=value per line" },
      ],
      patch: (values) => {
        const metadata = { labels: replaceMap(asRecord(template.metadata).labels, recordFromText(values.labels)), annotations: replaceMap(asRecord(template.metadata).annotations, recordFromText(values.annotations)) }
        return kind === "CronJob" ? { spec: { jobTemplate: { spec: { template: { metadata } } } } } : { spec: { template: { metadata } } }
      },
    })
  }

  if (kind === "CronJob") {
    add({
      id: "edit-cron-schedule",
      label: t("Edit schedule"),
      description: t("Update schedule, suspend state, and job history limits."),
      fields: [
        { name: "schedule", label: t("Schedule"), section: "Schedule", defaultValue: () => compactValue(spec.schedule || "* * * * *") },
        { name: "suspend", label: t("Suspend"), section: "Schedule", type: "checkbox", defaultValue: () => Boolean(spec.suspend) },
        { name: "successfulJobsHistoryLimit", label: t("Successful history"), section: "History", type: "number", defaultValue: () => String(spec.successfulJobsHistoryLimit ?? 3) },
        { name: "failedJobsHistoryLimit", label: t("Failed history"), section: "History", type: "number", defaultValue: () => String(spec.failedJobsHistoryLimit ?? 1) },
      ],
      patch: (values) => ({ spec: { schedule: values.schedule, suspend: values.suspend === true, successfulJobsHistoryLimit: numberFromValue(values.successfulJobsHistoryLimit, 3), failedJobsHistoryLimit: numberFromValue(values.failedJobsHistoryLimit, 1) } }),
    })
  }

  if (kind === "HorizontalPodAutoscaler") {
    add({
      id: "edit-hpa-bounds",
      label: t("Edit bounds"),
      description: t("Update HPA minimum and maximum replicas."),
      fields: [
        { name: "minReplicas", label: t("Min replicas"), section: "Scale", type: "number", defaultValue: () => String(spec.minReplicas ?? 1) },
        { name: "maxReplicas", label: t("Max replicas"), section: "Scale", type: "number", defaultValue: () => String(spec.maxReplicas ?? 3) },
      ],
      patch: (values) => ({ spec: { minReplicas: numberFromValue(values.minReplicas, 1), maxReplicas: numberFromValue(values.maxReplicas, 3) } }),
    })
  }

  // VMI specs are immutable, so runtime edits apply to the owning VM, pool or replica set only.
  if (["VirtualMachine", "VirtualMachinePool", "VirtualMachineInstanceReplicaSet"].includes(kind)) {
    const vmSpec = kind === "VirtualMachinePool" ? asRecord(getValue(resource, ["spec", "virtualMachineTemplate", "spec"])) : spec
    const templateSpec = asRecord(getValue(vmSpec, ["template", "spec"]))
    const domain = asRecord(templateSpec.domain)
    const cpu = asRecord(domain.cpu)
    // KubeVirt rejects CPU/memory on the template when an instance type provides them.
    const usesInstancetype = Boolean(asRecord(vmSpec.instancetype).name)
    const hasRunStrategy = kind !== "VirtualMachineInstanceReplicaSet"
    add({
      id: "edit-virtualization-runtime",
      label: t("Edit runtime"),
      description: usesInstancetype
        ? `CPU and memory come from instance type ${compactValue(asRecord(vmSpec.instancetype).name)}; change the instance type to resize.`
        : `Update ${kind} run strategy, CPU, memory, and priority class.`,
      fields: [
        ...(hasRunStrategy ? [{ name: "runStrategy", label: t("Run strategy"), section: "Lifecycle", type: "select" as const, defaultValue: () => compactValue(vmSpec.runStrategy || (vmSpec.running === true ? "Always" : "Halted")), options: [{ label: t("Halted"), value: "Halted" }, { label: t("Always"), value: "Always" }, { label: t("RerunOnFailure"), value: "RerunOnFailure" }, { label: t("Manual"), value: "Manual" }] }] : []),
        ...(usesInstancetype ? [] : [
          { name: "sockets", label: t("CPU sockets"), section: "Compute", type: "number" as const, defaultValue: () => String(cpu.sockets ?? 1) },
          { name: "cores", label: t("CPU cores"), section: "Compute", type: "number" as const, defaultValue: () => String(cpu.cores ?? 1) },
          { name: "threads", label: t("CPU threads"), section: "Compute", type: "number" as const, defaultValue: () => String(cpu.threads ?? 1) },
          { name: "memory", label: t("Memory"), section: "Compute", defaultValue: () => compactValue(asRecord(asRecord(domain.resources).requests).memory || asRecord(domain.memory).guest || "1Gi") },
        ]),
        { name: "priorityClassName", label: t("Priority class"), section: "Scheduling", defaultValue: () => compactValue(templateSpec.priorityClassName) },
      ],
      patch: (values) => {
        const templatePatch = {
          spec: {
            priorityClassName: values.priorityClassName || null,
            ...(usesInstancetype ? {} : {
              domain: {
                cpu: { sockets: numberFromValue(values.sockets, 1), cores: numberFromValue(values.cores, 1), threads: numberFromValue(values.threads, 1) },
                resources: { requests: { memory: values.memory } },
              },
            }),
          },
        }
        // runStrategy and the legacy spec.running field are mutually exclusive.
        const lifecycle = hasRunStrategy ? { runStrategy: values.runStrategy, running: null } : {}
        if (kind === "VirtualMachinePool") return { spec: { virtualMachineTemplate: { spec: { ...lifecycle, template: templatePatch } } } }
        if (kind === "VirtualMachine") return { spec: { ...lifecycle, template: templatePatch } }
        return { spec: { template: templatePatch } }
      },
    })
  }

  if (kind === "Service") {
    add({
      id: "edit-service-routing",
      label: t("Edit service"),
      description: t("Update service type, selector, external IPs, and load balancer IP."),
      fields: [
        { name: "type", label: t("Type"), section: "Routing", type: "select", defaultValue: () => compactValue(spec.type || "ClusterIP"), options: [{ label: t("ClusterIP"), value: "ClusterIP" }, { label: t("NodePort"), value: "NodePort" }, { label: t("LoadBalancer"), value: "LoadBalancer" }, { label: t("ExternalName"), value: "ExternalName" }] },
        { name: "selector", label: t("Selector"), section: "Routing", type: "textarea", defaultValue: () => textFromRecord(spec.selector), placeholder: "key=value per line" },
        { name: "externalIPs", label: t("External IPs"), section: "Routing", defaultValue: () => csvFromList(spec.externalIPs), placeholder: "comma-separated" },
        { name: "loadBalancerIP", label: t("Load balancer IP"), section: "Routing", defaultValue: () => compactValue(spec.loadBalancerIP) },
      ],
      patch: (values) => ({ spec: { type: values.type, selector: replaceMap(spec.selector, recordFromText(values.selector)), externalIPs: listFromCsv(values.externalIPs), loadBalancerIP: values.loadBalancerIP || null } }),
    })
  }

  const calicoPolicyKinds = ["NetworkPolicy", "GlobalNetworkPolicy", "StagedNetworkPolicy", "StagedGlobalNetworkPolicy"]
  const isCalicoPolicy = config.path.includes("/calico/") && calicoPolicyKinds.includes(kind)
  if (isCalicoPolicy) {
    // Calico policies select endpoints with a selector expression string, not label maps.
    add({
      id: "edit-network-policy",
      label: t("Edit policy"),
      description: t("Update {v0} selector, order and policy types.", { v0: kind }),
      fields: [
        { name: "selector", label: t("Selector"), section: "Policy", defaultValue: () => compactValue(spec.selector), placeholder: "app == 'web'" },
        { name: "order", label: t("Order"), section: "Policy", type: "number", defaultValue: () => compactValue(spec.order) },
        { name: "types", label: t("Types"), section: "Policy", defaultValue: () => csvFromList(spec.types), placeholder: t("Ingress,Egress") },
      ],
      patch: (values) => ({ spec: { selector: values.selector || null, order: values.order === "" ? null : numberFromValue(values.order, 1000), types: listFromCsv(values.types) } }),
    })
  } else if (["NetworkPolicy", "CiliumNetworkPolicy", "CiliumClusterwideNetworkPolicy"].includes(kind)) {
    const cilium = kind.startsWith("Cilium")
    const selector = asRecord(cilium ? spec.endpointSelector : spec.podSelector)
    add({
      id: "edit-network-policy",
      label: t("Edit policy"),
      description: t("Update {v0} {v1}. An empty selector matches every {v2} in scope.", { v0: kind, v1: cilium ? "endpoint selector" : "pod selector and policy types", v2: cilium ? "endpoint" : "pod" }),
      fields: [
        { name: "selector", label: cilium ? "Endpoint Selector" : "Pod Selector", section: "Policy", type: "textarea", defaultValue: () => textFromRecord(selector.matchLabels), placeholder: "key=value per line" },
        ...(cilium ? [] : [{ name: "policyTypes", label: t("Policy types"), section: "Policy", defaultValue: () => csvFromList(spec.policyTypes), placeholder: t("Ingress,Egress") }]),
      ],
      patch: (values) => {
        const matchLabels = replaceMap(selector.matchLabels, recordFromText(values.selector))
        return cilium
          ? { spec: { endpointSelector: { matchLabels } } }
          : { spec: { podSelector: { matchLabels }, policyTypes: listFromCsv(values.policyTypes) } }
      },
    })
  }

  if (kind === "Ingress") {
    add({
      id: "edit-network-fields",
      label: t("Edit ingress"),
      description: t("Update the ingress class."),
      fields: [{ name: "className", label: t("Ingress class"), section: "Routing", defaultValue: () => compactValue(spec.ingressClassName) }],
      patch: (values) => ({ spec: { ingressClassName: values.className || null } }),
    })
  } else if (kind === "Gateway") {
    add({
      id: "edit-network-fields",
      label: t("Edit gateway"),
      description: t("Update the gateway class."),
      fields: [{ name: "className", label: t("Gateway class"), section: "Routing", defaultValue: () => compactValue(spec.gatewayClassName) }],
      patch: (values) => ({ spec: { gatewayClassName: values.className } }),
    })
  } else if (["HTTPRoute", "GRPCRoute", "TLSRoute"].includes(kind)) {
    add({
      id: "edit-network-fields",
      label: t("Edit {v0}", { v0: kind }),
      description: t("Update route hostnames. Leave empty to match all hostnames."),
      fields: [{ name: "hostnames", label: t("Hostnames"), section: "Routing", defaultValue: () => csvFromList(spec.hostnames), placeholder: "comma-separated" }],
      patch: (values) => ({ spec: { hostnames: listFromCsv(values.hostnames).length ? listFromCsv(values.hostnames) : null } }),
    })
  } else if (config.path.includes("/networks/") && !isCalicoPolicy && !["NetworkPolicy", "CiliumNetworkPolicy", "CiliumClusterwideNetworkPolicy"].includes(kind)) {
    add({
      id: "edit-network-fields",
      label: t("Edit {v0}", { v0: kind }),
      description: t("Set top-level {v0} spec fields. Values are parsed as numbers, booleans or JSON where possible.", { v0: kind }),
      fields: [{ name: "specFields", label: t("{v0} Spec Fields", { v0: kind }), section: "Spec", type: "textarea", defaultValue: () => "", placeholder: "topLevelSpecKey=value per line" }],
      patch: specBasicsPatch,
    })
  }

  if (kind === "ConfigMap") {
    add({
      id: "edit-config-data",
      label: t("Edit data"),
      description: t("Update ConfigMap data keys. Removed lines delete the key."),
      fields: [{ name: "data", label: t("Data"), section: "Data", type: "textarea", defaultValue: () => textFromRecord(resource.data), placeholder: "key=value per line" }],
      patch: (values) => ({ data: replaceMap(resource.data, recordFromText(values.data)) }),
    })
  }

  if (kind === "Secret") {
    // Secret.data is base64; edit decoded values and write them back through stringData.
    const decoded = Object.fromEntries(Object.entries(asRecord(resource.data)).map(([key, value]) => {
      try {
        return [key, new TextDecoder().decode(Uint8Array.from(atob(String(value)), (char) => char.charCodeAt(0)))]
      } catch {
        return [key, String(value)]
      }
    }))
    add({
      id: "edit-config-data",
      label: t("Edit data"),
      description: t("Values are shown decoded and stored base64 encoded. Removed lines delete the key."),
      fields: [{ name: "data", label: t("Data"), section: "Data", type: "textarea", defaultValue: () => Object.entries(decoded).map(([key, value]) => `${key}=${value}`).join("\n"), placeholder: "key=value per line" }],
      patch: (values) => {
        const next = recordFromText(values.data)
        const removed = Object.fromEntries(Object.keys(decoded).filter((key) => !(key in next)).map((key) => [key, null]))
        return { data: removed, stringData: next }
      },
    })
  }

  if (kind === "PersistentVolumeClaim") {
    add({
      id: "edit-storage",
      label: t("Expand volume"),
      description: t("Increase the requested size. Requires a storage class with allowVolumeExpansion; shrinking is not supported."),
      fields: [{ name: "storage", label: t("Requested storage"), section: "Storage", defaultValue: () => compactValue(asRecord(asRecord(spec.resources).requests).storage) }],
      patch: (values) => ({ spec: { resources: { requests: { storage: values.storage } } } }),
    })
  } else if (kind === "PersistentVolume") {
    add({
      id: "edit-storage",
      label: t("Edit reclaim policy"),
      description: t("Change what happens to the volume when its claim is released."),
      fields: [{ name: "reclaimPolicy", label: t("Reclaim policy"), section: "Lifecycle", type: "select", defaultValue: () => compactValue(spec.persistentVolumeReclaimPolicy || "Retain"), options: [{ label: t("Retain"), value: "Retain" }, { label: t("Delete"), value: "Delete" }] }],
      patch: (values) => ({ spec: { persistentVolumeReclaimPolicy: values.reclaimPolicy } }),
    })
  } else if (kind === "StorageClass") {
    // Provisioner, parameters, reclaimPolicy and volumeBindingMode are immutable on StorageClass.
    const annotations = asRecord(resource.metadata.annotations)
    add({
      id: "edit-storage",
      label: t("Edit StorageClass"),
      description: t("Only expansion and the default class can change; other StorageClass fields are immutable."),
      fields: [
        { name: "allowVolumeExpansion", label: t("Allow volume expansion"), section: "Storage", type: "checkbox", defaultValue: () => resource.allowVolumeExpansion === true },
        { name: "isDefault", label: t("Default StorageClass"), section: "Storage", type: "checkbox", defaultValue: () => annotations["storageclass.kubernetes.io/is-default-class"] === "true" },
      ],
      patch: (values) => ({
        allowVolumeExpansion: values.allowVolumeExpansion === true,
        metadata: { annotations: { "storageclass.kubernetes.io/is-default-class": values.isDefault === true ? "true" : null } },
      }),
    })
  }

  if (["Role", "ClusterRole"].includes(kind)) {
    add({
      id: "edit-rbac-rules",
      label: t("Edit rules"),
      description: t("Replace RBAC rules using line-oriented fields."),
      fields: [{ name: "rules", label: t("Rules"), section: "RBAC", type: "textarea", defaultValue: () => asRecordList(resource.rules).map((rule) => `${csvFromList(rule.apiGroups)}|${csvFromList(rule.resources)}|${csvFromList(rule.verbs)}`).join("\n"), placeholder: "apiGroups|resources|verbs per line" }],
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
      label: t("Edit subjects"),
      description: t("Bound to {v0} {v1}. roleRef is immutable; create a new binding to change it.", { v0: compactValue(roleRef.kind), v1: compactValue(roleRef.name) }),
      fields: [
        { name: "subjects", label: t("Subjects"), section: "Subjects", type: "textarea", defaultValue: () => asRecordList(resource.subjects).map((subject) => `${compactValue(subject.kind)}|${compactValue(subject.name)}|${compactValue(subject.namespace)}`).join("\n"), placeholder: t("Kind|Name|Namespace per line") },
      ],
      patch: (values) => ({
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
      label: t("Edit webhooks"),
      description: t("Update admission webhook failure policy, match policy, timeout, and side effects."),
      fields: [
        { name: "failurePolicy", label: t("Failure policy"), section: "Policy", type: "select", defaultValue: () => compactValue(asRecordList(resource.webhooks)[0]?.failurePolicy || "Fail"), options: [{ label: t("Fail"), value: "Fail" }, { label: t("Ignore"), value: "Ignore" }] },
        { name: "matchPolicy", label: t("Match policy"), section: "Policy", type: "select", defaultValue: () => compactValue(asRecordList(resource.webhooks)[0]?.matchPolicy || "Equivalent"), options: [{ label: t("Equivalent"), value: "Equivalent" }, { label: t("Exact"), value: "Exact" }] },
        { name: "sideEffects", label: t("Side effects"), section: "Policy", type: "select", defaultValue: () => compactValue(asRecordList(resource.webhooks)[0]?.sideEffects || "None"), options: [{ label: t("None"), value: "None" }, { label: t("NoneOnDryRun"), value: "NoneOnDryRun" }] },
        { name: "timeoutSeconds", label: t("Timeout seconds"), section: "Policy", type: "number", defaultValue: () => String(asRecordList(resource.webhooks)[0]?.timeoutSeconds || 10) },
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
      label: t("Edit {v0}", { v0: kind }),
      description: t("Update safe top-level spec fields for {v0}.", { v0: kind }),
      fields: [{ name: "specFields", label: t("{v0} Spec Fields", { v0: kind }), section: "Spec", type: "textarea", defaultValue: () => "", placeholder: "topLevelSpecKey=value per line" }],
      patch: specBasicsPatch,
    })
  }

  if (canDeleteResource(config)) {
    actions.push({
      id: "delete-resource",
      label: t("Delete {v0}", { v0: kind }),
      description: t("Delete this {v0}.", { v0: kind }),
      confirmLabel: t("Delete"),
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
      <span className="text-sm font-medium text-foreground">{t(field.label)}{field.required && <span className="text-destructive"> *</span>}</span>
      {field.type === "textarea" ? (
        <textarea
          id={id}
          value={String(value)}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.placeholder && t(field.placeholder)}
          className="min-h-24 rounded-lg border bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      ) : field.type === "select" ? (
        <select
          id={id}
          value={String(value)}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
        >
          {(field.options || []).map((option) => <option key={option.value} value={option.value}>{t(option.label)}</option>)}
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
          <span className="text-sm text-muted-foreground">{field.placeholder ? t(field.placeholder) : t("Enabled")}</span>
        </div>
      ) : (
        <Input
          id={id}
          type={field.type === "number" ? "number" : "text"}
          value={String(value)}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.placeholder && t(field.placeholder)}
        />
      )}
      {field.description && <span className="text-xs text-muted-foreground">{t(field.description)}</span>}
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
          if (!res.ok) throw new Error(`${resource.kind || t("Resource")} ${resource.metadata.name}: ${await res.text()}`)
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
        if (!created) throw new Error(`${resource.kind || t("Resource")} ${resource.metadata.name}: ${lastError || t("Resource API is not served by this cluster")}`)
      }
      setOpen(false)
      setValues(createFieldDefaults(createFields, defaultNamespace))
      setYamlEdited(false)
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Failed to create resource"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" />{t("Create")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>{t("Create")} {config.kind}</DialogTitle>
          <DialogDescription>{t("Fields on the left, generated YAML on the right.")}</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
            {fieldGroups.map((group) => (
              <div key={group.section} className="rounded-lg border bg-muted/20 p-4">
                <div className="mb-3 text-sm font-semibold text-foreground">{t(group.section)}</div>
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
                <div className="text-sm font-semibold text-foreground">{t("YAML Preview")}</div>
                <div className="text-xs text-muted-foreground">{advanced ? t("Advanced editing enabled") : t("Generated from the form")}</div>
              </div>
              <Button
                type="button"
                variant={advanced ? "default" : "outline"}
                size="sm"
                onClick={() => setAdvanced((current) => !current)}
              >{t("Advanced")}
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
          <Button variant="outline" onClick={() => setOpen(false)}>{t("Cancel")}</Button>
          <Button onClick={createResource} disabled={saving}>{saving ? t("Creating...") : t("Create")}</Button>
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
    return err instanceof Error ? err.message : t("Unable to preview request")
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
      setError(err instanceof Error ? err.message : t("Failed to {action}", { action: t(action.label).toLowerCase() }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!controlled && (
        <DialogTrigger asChild>
          <Button size="sm" variant={action.variant || "outline"}>{t(action.label)}</Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t(action.label)} {resource.kind || t("Resource")}</DialogTitle>
          {action.description && <DialogDescription>{t(action.description)}</DialogDescription>}
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
              <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">{t("This action will update the current resource.")}
              </div>
            )}
          </div>
          <div className="space-y-2">
            <div className="text-sm font-semibold text-foreground">{t("Request Preview")}</div>
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
          <Button variant="outline" onClick={() => setOpen(false)}>{t("Cancel")}</Button>
          <Button variant={action.variant === "destructive" ? "destructive" : "default"} onClick={submit} disabled={saving}>
            {saving ? t("Applying...") : t(action.confirmLabel || action.label)}
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
  const [namespaces, setNamespaces] = useState<string[]>([])
  const [namespaceFilter, setNamespaceFilter] = useState("default")
  const ns = useMemo(() => namespaceScope(namespaceFilter, namespaces), [namespaceFilter, namespaces])
  const scope = ns.scope
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
        const next = Array.from(new Set((data || []).filter(Boolean)))
        setNamespaces(next)
        // Fall back to all namespaces when the initial "default" does not exist.
        setNamespaceFilter((current) => (current === "default" && !next.includes("default") ? "" : current))
      })
      .catch(() => {
        if (!cancelled) setNamespaces(["default"])
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
        const res = await apiFetch(resourceListUrl(config, path, scope))
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
      if (!loaded) throw new Error(lastError || t("Resource API is not served by this cluster"))
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Failed to load resources"))
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [config, scope])

  useEffect(() => {
    load()
  }, [load])

  const fields = useMemo(() => resourceFilterFields(config), [config])
  const inScope = useMemo(() => (config.namespaced ? items.filter((item) => ns.match(item.metadata.namespace)) : items), [items, ns, config.namespaced])
  const filtered = useFilteredRows(inScope, fields, search)
  const { rows: pageRows, ...paging } = usePaged(filtered)

  const filtering = Boolean(search.trim()) || (config.namespaced && scope === "all" && Boolean(namespaceFilter.trim()))
  const emptyTitle = filtering ? t("No matching resources") : t("No {name} found", { name: t(config.title) })
  const emptyDescription = filtering
    ? undefined
    : config.namespaced && scope !== "all"
      ? `Namespace ${scope} has none.`
      : undefined
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
    throw new Error(lastError || t("Delete failed"))
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t(config.title)}
        badge={!loading && <span className="text-sm text-muted-foreground tabular-nums">{items.length}</span>}
        subtitle={<span className="font-mono text-xs">{config.kind} · {config.listPath.split("/").slice(1, -1).join("/")}</span>}
        actions={canCreateResource(config) && <ResourceCreateDialog config={config} onCreated={load} defaultNamespace={scope === "all" ? "default" : scope} />}
      />

      <Toolbar
        right={<FilterInput value={search} onChange={setSearch} fields={fields} rows={inScope} />}
      >
        <Button size="sm" variant="outline" onClick={load} className="gap-2">
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />{t("Refresh")}
        </Button>
        {config.namespaced && (
          <Combobox value={namespaceFilter} onChange={setNamespaceFilter} options={namespaces} placeholder={t("All namespaces")} aria-label={t("Namespace")} />
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
                    aria-label={t("Select all rows")}
                  />
                </TableHead>
                <TableHead className="h-9 px-3 text-xs font-medium text-muted-foreground">{t("Name")}</TableHead>
                {config.namespaced && <TableHead className="h-9 px-3 text-xs font-medium text-muted-foreground">{t("Namespace")}</TableHead>}
                <TableHead className="h-9 px-3 text-xs font-medium text-muted-foreground">{t("Status")}</TableHead>
                {config.extraColumns?.map((column) => <TableHead key={column.label} className="h-9 px-3 text-xs font-medium text-muted-foreground">{t(column.label)}</TableHead>)}
                <TableHead className="h-9 px-3 text-right text-xs font-medium text-muted-foreground">{t("Age")}</TableHead>
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
              ) : pageRows.map((item) => {
                const rowKey = item.metadata.uid || `${item.metadata.namespace || "_cluster"}-${item.metadata.name}`
                return (
                <TableRow key={rowKey} className="hover:bg-muted/50">
                  <TableCell className="h-10 px-3 py-1.5">
                    <input
                      type="checkbox"
                      className="size-4 rounded border-border accent-primary"
                      checked={Boolean(selected[rowKey])}
                      onChange={(event) => setSelected((current) => ({ ...current, [rowKey]: event.target.checked }))}
                      aria-label={t("Select {v0}", { v0: item.metadata.name })}
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
                        title={t("Delete")}
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
        <Pager {...paging} />
      </div>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t("Delete {v0} {v1}?", { v0: config.kind, v1: deleting?.metadata.name })}
        description={deleting?.metadata.namespace ? `Namespace ${deleting.metadata.namespace}. This cannot be undone.` : t("This cannot be undone.")}
        destructive
        confirmLabel={t("Delete")}
        onConfirm={async () => {
          if (deleting) await remove(deleting)
        }}
      />
    </div>
  )
}

/** Long annotation values (JSON, certificates) are clamped; JSON is pretty-printed when expanded. */
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
        if (!loaded) throw new Error(lastError || t("Resource API is not served by this cluster"))
      } catch (err) {
        setError(err instanceof Error ? err.message : t("Failed to load resource"))
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [config, name, namespace])

  if (loading && !resource) {
    return (
      <div className="flex h-64 items-center justify-center gap-2">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-primary" />
        <span className="text-sm text-muted-foreground">{t("Loading...")}</span>
      </div>
    )
  }

  if (!resource) {
    return (
      <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
        {error || t("Resource not found")}
      </div>
    )
  }

  const labels = Object.entries(resource.metadata.labels || {})
  const annotations = Object.entries(resource.metadata.annotations || {}).filter(([key]) => !hiddenAnnotations.has(key))
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
        throw new Error(lastError || t("Resource API is not served by this cluster"))
      })
      .catch((err) => setError(err instanceof Error ? err.message : t("Failed to load resource")))
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
        breadcrumbs={[{ label: t(config.title), to: config.path }, ...(resource.metadata.namespace ? [{ label: resource.metadata.namespace }] : []), { label: resource.metadata.name }]}
        title={resource.metadata.name}
        badge={<ResourceStatus resource={resource} config={config} />}
        subtitle={
          <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
            <span className="font-mono">{resource.kind || config.kind}</span>
            {resource.apiVersion && <span className="font-mono">{resource.apiVersion}</span>}
            <span title={resource.metadata.creationTimestamp}>{t("created {time}", { time: relativeTime(resource.metadata.creationTimestamp) })}</span>
            {!resource.metadata.namespace && <span>{t("cluster scoped")}</span>}
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
                  <Button size="sm" variant="outline" className="gap-1.5">{t("Actions")}<ChevronDown className="size-3.5" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  {menuActions.map((action) => (
                    <DropdownMenuItem key={action.id} variant={action.variant === "destructive" ? "destructive" : "default"} onClick={() => setOpenAction(action.id)}>
                      {t(action.label)}
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
          title={t(relatedPods.title)}
          namespace={relatedPods.namespace}
          selector={relatedPods.selector}
          selectors={relatedPods.selectors}
          podName={relatedPods.podName}
          pods={relatedPods.pods}
        />
      )}

      <MetadataSection resource={resource} labels={labels} annotations={annotations} />
    </div>
  )
}

export function ResourceEvents({ config }: { config: ResourceConfig }) {
  const { namespace, name } = useParams()
  const scopedNamespace = namespace && namespace !== "_cluster" ? namespace : undefined
  return (
    <div className="space-y-5">
      <PageHeader
        breadcrumbs={[{ label: t(config.title), to: config.path }, ...(scopedNamespace ? [{ label: scopedNamespace }] : []), { label: name || "" }]}
        title={name}
        subtitle={<span className="font-mono text-xs">{config.kind}</span>}
      />
      <DetailTabs config={config} namespace={namespace} name={name} active="events" />
      <EventList url={eventsUrl({ namespace: scopedNamespace, kind: config.kind, name })} showObject={false} />
    </div>
  )
}

export function ResourceManifest({ config }: { config: ResourceConfig }) {
  const { namespace, name } = useParams()
  const [resource, setResource] = useState<KubeResource | null>(null)
  const [url, setUrl] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      let loaded = false
      let lastError = ""
      for (const path of await servedPaths(config)) {
        const resourceUrl = resourcePathUrl(config, path.resourcePath, name!, namespace)
        const res = await apiFetch(resourceUrl)
        if (res.ok) {
          setResource(await res.json())
          setUrl(resourceUrl)
          loaded = true
          break
        }
        lastError = await res.text()
        if (res.status !== 404) break
      }
      if (!loaded) throw new Error(lastError || t("Resource API is not served by this cluster"))
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Failed to load manifest"))
      setResource(null)
    } finally {
      setLoading(false)
    }
  }, [config, name, namespace])

  useEffect(() => {
    load()
  }, [load])

  // Keep the panel (and an in-progress edit) mounted during reloads.
  if (loading && !resource) {
    return (
      <div className="flex h-64 items-center justify-center gap-2">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-primary" />
        <span className="text-sm text-muted-foreground">{t("Loading...")}</span>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        breadcrumbs={[{ label: t(config.title), to: config.path }, ...(namespace && namespace !== "_cluster" ? [{ label: namespace }] : []), { label: name || "" }]}
        title={name}
        subtitle={<span className="font-mono text-xs">{config.kind}</span>}
        actions={
          <Button size="sm" variant="outline" onClick={load} className="gap-2">
            <RefreshCw className="h-4 w-4" />{t("Refresh")}
          </Button>
        }
      />

      <DetailTabs config={config} namespace={namespace} name={name} active="manifest" />

      {error ? (
        <ErrorNote>{error}</ErrorNote>
      ) : (
        <ManifestPanel object={resource} url={canDeleteResource(config) ? url : undefined} onSaved={load} />
      )}
    </div>
  )
}
