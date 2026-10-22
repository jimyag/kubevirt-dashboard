import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useTheme } from "next-themes"
import { Cpu, Moon, Plus, Search, Sun } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command"
import { listItems, type KubeObject } from "@/lib/kube"
import { useNavSections } from "@/lib/navigation"
import { t } from "@/lib/i18n"

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)

/** Global ⌘K palette: jump to any console page, run common actions, or open an instance. */
export function CommandPalette() {
  const navigate = useNavigate()
  const sections = useNavSections()
  const { resolvedTheme, setTheme } = useTheme()
  const [open, setOpen] = useState(false)
  const [instances, setInstances] = useState<KubeObject[]>([])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setOpen((current) => !current)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  useEffect(() => {
    if (open) listItems("/apis/kubevirt.io/v1/virtualmachines").then(setInstances)
  }, [open])

  const go = (path: string) => {
    setOpen(false)
    navigate(path)
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="h-8 w-full max-w-72 justify-start gap-2 bg-background px-2.5 font-normal text-muted-foreground shadow-none sm:w-64"
      >
        <Search className="size-4" />
        <span className="flex-1 text-left">{t("Search or jump to...")}</span>
        <kbd className="pointer-events-none hidden h-5 items-center gap-0.5 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium sm:flex">{isMac ? "⌘" : t("Ctrl")} K</kbd>
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen} title={t("Search")} description={t("Jump to a page, run an action, or open an instance")}>
        <CommandInput placeholder={t("Type a page, action or instance name...")} />
        <CommandList className="max-h-[420px]">
          <CommandEmpty>{t("No results.")}</CommandEmpty>
          <CommandGroup heading="Actions">
            <CommandItem onSelect={() => go("/kubevirt/virtualization/virtual-machines/create")}>
              <Plus />{t("Create instance")}
            </CommandItem>
            <CommandItem onSelect={() => { setTheme(resolvedTheme === "dark" ? "light" : "dark"); setOpen(false) }}>
              {resolvedTheme === "dark" ? <Sun /> : <Moon />}{resolvedTheme === "dark" ? t("Switch to light theme") : t("Switch to dark theme")}
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          {sections.map((section) => (
            <CommandGroup key={section.label} heading={t(section.label)}>
              {section.items.map((item) => (
                <CommandItem key={item.path} value={`${section.label} ${item.name} ${t(section.label)} ${t(item.name)}`} onSelect={() => go(item.path)}>
                  <item.icon />{t(item.name)}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
          {instances.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Instances">
                {instances.slice(0, 50).map((vm) => (
                  <CommandItem
                    key={`${vm.metadata.namespace}/${vm.metadata.name}`}
                    value={`instance ${vm.metadata.namespace} ${vm.metadata.name}`}
                    onSelect={() => go(`/kubevirt/virtualization/virtual-machines/${vm.metadata.namespace}/${vm.metadata.name}/overview`)}
                  >
                    <Cpu />{vm.metadata.name}
                    <CommandShortcut className="tracking-normal">{vm.metadata.namespace}</CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
        </CommandList>
      </CommandDialog>
    </>
  )
}
