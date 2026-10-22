import { useEffect, useState } from "react"
import { Link, useLocation } from "react-router-dom"
import { ChevronRight, Server } from "lucide-react"

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
import { findActiveNav, toneClasses } from "@/lib/navigation"
import { CommandPalette } from "./command-palette"
import { LanguageToggle } from "./language-toggle"
import { ModeToggle } from "./mode-toggle"
import { t } from "@/lib/i18n"

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
      <SelectTrigger size="sm" className="h-8 max-w-[220px] gap-2 bg-background text-xs font-medium shadow-none" aria-label={t("Cluster")}>
        <Server className="h-3.5 w-3.5 text-muted-foreground" />
        <SelectValue placeholder={t("Cluster")} />
      </SelectTrigger>
      <SelectContent align="start" className="max-h-72">
        {contexts.map((c) => (
          <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function Breadcrumbs() {
  const location = useLocation()
  const active = findActiveNav(location.pathname)
  if (!active) return null
  const crumbs = active.section.label === "Home" ? [t(active.item.name)] : [t(active.section.label), ...(active.parent ? [t(active.parent.name)] : []), t(active.item.name)]
  return (
    <nav className="hidden min-w-0 items-center gap-1.5 text-sm md:flex">
      {crumbs.map((crumb, index) => (
        <span key={crumb} className="flex min-w-0 items-center gap-1.5">
          {index > 0 && <ChevronRight className="size-3.5 text-muted-foreground" />}
          {index === 0 && <span className={`size-2 rounded-sm ${toneClasses[active.section.tone].dot}`} />}
          {index === crumbs.length - 1 ? (
            <Link to={active.item.path} className="truncate font-medium text-foreground hover:text-primary transition-colors">{crumb}</Link>
          ) : (
            <span className="truncate text-muted-foreground">{crumb}</span>
          )}
        </span>
      ))}
    </nav>
  )
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 flex h-(--header-height) shrink-0 items-center border-b bg-background/80 backdrop-blur-md">
      <div className="flex w-full items-center gap-3 px-4 lg:px-6">
        <SidebarTrigger className="-ml-1 text-muted-foreground" />
        <Separator orientation="vertical" className="data-[orientation=vertical]:h-4" />
        <Breadcrumbs />
        <div className="ml-auto flex items-center gap-2">
          <CommandPalette />
          <ClusterSwitcher />
          <LanguageToggle />
          <ModeToggle />
        </div>
      </div>
    </header>
  )
}
