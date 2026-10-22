import { useEffect, useState } from "react"
import { Globe } from "lucide-react"

import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { getContext, setContext } from "@/lib/kube"
import { ModeToggle } from "./mode-toggle"

function ClusterSwitcher() {
  const [contexts, setContexts] = useState<string[]>([])
  const [current, setCurrent] = useState(getContext())

  useEffect(() => {
    fetch("/api/v1/contexts")
      .then((r) => r.json())
      .then((d) => {
        setContexts(d.contexts || [])
        if (!getContext() && d.default) {
          setContext(d.default)
          setCurrent(d.default)
        }
      })
      .catch(() => {})
  }, [])

  const change = (value: string) => {
    setContext(value)
    setCurrent(value)
    window.location.reload()
  }

  return (
    <Select value={current} onValueChange={change} disabled={contexts.length === 0}>
      <SelectTrigger size="sm" className="h-8 max-w-[220px] gap-2 text-xs font-semibold" aria-label="Cluster">
        <Globe className="h-3.5 w-3.5 text-muted-foreground" />
        <SelectValue placeholder="Cluster" />
      </SelectTrigger>
      <SelectContent align="start" className="max-h-72">
        {contexts.map((c) => (
          <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 flex h-(--header-height) shrink-0 items-center gap-2 border-b">
      <div className="flex w-full items-center gap-2 px-4 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-4" />
        <ClusterSwitcher />
        <div className="ml-auto flex items-center gap-2">
          <ModeToggle />
        </div>
      </div>
    </header>
  )
}
