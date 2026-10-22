import { useCallback, useMemo, useState } from "react"

import { Combobox, PageHeader } from "@/components/console"
import { EventList } from "@/components/events"
import { eventsUrl, type KubeEvent } from "@/lib/events"
import { namespaceScope } from "@/lib/filter"
import { useNamespaces } from "@/lib/kube"

const kinds = ["VirtualMachine", "VirtualMachineInstance", "DataVolume", "Pod", "Node", "PersistentVolumeClaim", "VirtualMachineInstanceMigration"]

export function EventsPage() {
  const namespaces = useNamespaces()
  const [namespace, setNamespace] = useState("")
  const [kind, setKind] = useState("")

  // Exact values become field selectors on the API request; partial text filters locally.
  const ns = useMemo(() => namespaceScope(namespace, namespaces), [namespace, namespaces])
  const kindText = kind.trim()
  const exactKind = kinds.find((item) => item.toLowerCase() === kindText.toLowerCase())
  const prefilter = useCallback((event: KubeEvent) => {
    if (!ns.match(event.involvedObject?.namespace || event.metadata.namespace)) return false
    return exactKind || !kindText ? true : (event.involvedObject?.kind || "").toLowerCase().includes(kindText.toLowerCase())
  }, [ns, exactKind, kindText])

  return (
    <div className="space-y-4">
      <PageHeader title="Events" subtitle="core/v1 events, refreshed every 15 seconds" />
      <EventList
        url={eventsUrl({ namespace: ns.scope, kind: exactKind })}
        prefilter={prefilter}
        toolbarExtra={
          <>
            <Combobox value={namespace} onChange={setNamespace} options={namespaces} placeholder="All namespaces" aria-label="Namespace" />
            <Combobox value={kind} onChange={setKind} options={kinds} placeholder="All kinds" aria-label="Object kind" className="min-w-[200px]" />
          </>
        }
      />
    </div>
  )
}
