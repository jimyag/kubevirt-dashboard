import { apiFetch, type KubeObject } from "./kube"

export type KubeEvent = KubeObject & {
  type?: string
  reason?: string
  message?: string
  count?: number
  firstTimestamp?: string
  lastTimestamp?: string
  eventTime?: string
  series?: { count?: number; lastObservedTime?: string }
  source?: { component?: string; host?: string }
  reportingComponent?: string
  involvedObject?: { kind?: string; name?: string; namespace?: string; apiVersion?: string }
}

export const eventTime = (event: KubeEvent) =>
  event.series?.lastObservedTime || event.lastTimestamp || event.eventTime || event.firstTimestamp || event.metadata.creationTimestamp

export const eventCount = (event: KubeEvent) => event.series?.count || event.count || 1

/** Console route for the object an event refers to, when the console has a page for its kind. */
export const involvedObjectPath = (event: KubeEvent) => consoleObjectPath(event.involvedObject)

/** Console route of the dedicated page for an object of these kinds, or null. */
export const consoleObjectPath = (object?: { kind?: string; name?: string; namespace?: string }) => {
  if (!object?.name) return null
  const ns = object.namespace
  switch (object.kind) {
    case "VirtualMachine":
    case "VirtualMachineInstance":
      return ns ? `/kubevirt/virtualization/virtual-machines/${ns}/${object.name}/overview` : null
    case "DataVolume":
      return ns ? `/kubevirt/cdi/data-volumes/${ns}/${object.name}/overview` : null
    case "Pod":
      return ns ? `/kubernetes/workloads/pods/${ns}/${object.name}` : null
    case "Node":
      return `/nodes/_cluster/${object.name}`
    case "PersistentVolumeClaim":
      return ns ? `/storage/kubernetes/persistent-volume-claims/${ns}/${object.name}` : null
    case "Subnet":
      return `/vpc/subnets/${object.name}`
    case "Vpc":
      return `/vpc/vpcs/${object.name}`
    default:
      return null
  }
}

/**
 * Builds the core/v1 events URL. Field selectors on involvedObject are supported by the API
 * server, so scoping happens server side rather than by listing every event.
 */
export const eventsUrl = ({ namespace, kind, name }: { namespace?: string; kind?: string; name?: string }) => {
  const selectors = [name && `involvedObject.name=${name}`, kind && `involvedObject.kind=${kind}`].filter(Boolean).join(",")
  const base = namespace && namespace !== "all" ? `/api/v1/namespaces/${namespace}/events` : "/api/v1/events"
  return selectors ? `${base}?fieldSelector=${encodeURIComponent(selectors)}` : base
}

export const fetchEvents = async (url: string): Promise<KubeEvent[]> => {
  const res = await apiFetch(url)
  if (!res.ok) throw new Error(await res.text())
  const data = await res.json()
  return ((data.items || []) as KubeEvent[]).sort((a, b) => new Date(eventTime(b) || 0).getTime() - new Date(eventTime(a) || 0).getTime())
}
