import { useCallback, useMemo, useState } from "react"

import { Combobox, PageHeader } from "@/components/console"
import { EventList } from "@/components/events"
import { eventsUrl, type KubeEvent } from "@/lib/events"
import { namespaceScope } from "@/lib/filter"
import { useNamespaces } from "@/lib/kube"
import { t } from "@/lib/i18n"

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
      <PageHeader title={t("Events")} subtitle={t("core/v1 events, refreshed every 15 seconds")} />
      <EventList
        url={eventsUrl({ namespace: ns.scope, kind: exactKind })}
        prefilter={prefilter}
        toolbarExtra={
          <>
            <Combobox value={namespace} onChange={setNamespace} options={namespaces} placeholder={t("All namespaces")} aria-label={t("Namespace")} />
            <Combobox value={kind} onChange={setKind} options={kinds} placeholder={t("All kinds")} aria-label={t("Object kind")} className="min-w-[200px]" />
          </>
        }
      />
    </div>
  )
}
