import { useState } from "react"

import { NativeSelect, PageHeader } from "@/components/console"
import { EventList } from "@/components/events"
import { eventsUrl } from "@/lib/events"
import { useNamespaces } from "@/lib/kube"

const kinds = ["VirtualMachine", "VirtualMachineInstance", "DataVolume", "Pod", "Node", "PersistentVolumeClaim", "VirtualMachineInstanceMigration"]

export function EventsPage() {
  const namespaces = useNamespaces()
  const [namespace, setNamespace] = useState("all")
  const [kind, setKind] = useState("")

  return (
    <div className="space-y-4">
      <PageHeader title="Events" subtitle="core/v1 events, refreshed every 15 seconds" />
      <EventList
        url={eventsUrl({ namespace, kind: kind || undefined })}
        toolbarExtra={
          <>
            <NativeSelect value={namespace} onChange={(e) => setNamespace(e.target.value)} aria-label="Namespace" className="min-w-[160px]">
              <option value="all">All namespaces</option>
              {namespaces.map((ns) => <option key={ns} value={ns}>{ns}</option>)}
            </NativeSelect>
            <NativeSelect value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Object kind" className="min-w-[180px]">
              <option value="">All kinds</option>
              {kinds.map((item) => <option key={item} value={item}>{item}</option>)}
            </NativeSelect>
          </>
        }
      />
    </div>
  )
}
