import { useState } from "react"
import { Link, useLocation } from "react-router-dom"
import { ChevronRight } from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { findActiveNav, toneClasses, useNavSections, type NavItem } from "@/lib/navigation"
import { BrandMark, productName } from "@/components/brand"
import { t } from "@/lib/i18n"

const navButtonClass = [
  "h-8 text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
  "data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground",
].join(" ")

/**
 * A second-level group: opens by itself when the current page is inside it, and remembers when the
 * user folds it. Collapsed to icons, it links to its first page instead.
 */
function NavGroup({ item, active, iconClass }: { item: NavItem; active?: string; iconClass: string }) {
  const { state, isMobile } = useSidebar()
  const children = item.children || []
  const containsActive = children.some((child) => child.path === active)
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  const open = userOpen ?? containsActive

  if (state === "collapsed" && !isMobile) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton asChild isActive={containsActive} tooltip={t(item.name)} className={navButtonClass}>
          <Link to={item.path}>
            <item.icon className={iconClass} />
            <span>{t(item.name)}</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    )
  }

  return (
    <Collapsible asChild open={open} onOpenChange={setUserOpen} className="group/collapsible">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton tooltip={t(item.name)} className={navButtonClass} isActive={containsActive && !open}>
            <item.icon className={iconClass} />
            <span>{t(item.name)}</span>
            <ChevronRight className="ml-auto size-3.5 text-muted-foreground transition-transform group-data-[state=open]/collapsible:rotate-90" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub className="mr-0 gap-0.5 pr-0">
            {children.map((child) => (
              <SidebarMenuSubItem key={child.path}>
                <SidebarMenuSubButton asChild isActive={active === child.path} className="h-7 data-[active=true]:font-medium">
                  <Link to={child.path}><span>{t(child.name)}</span></Link>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  )
}

export function AppSidebar() {
  const location = useLocation()
  const sections = useNavSections()
  const active = findActiveNav(location.pathname)?.item.path

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="h-(--header-height) justify-center border-b border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild className="h-9 hover:bg-transparent active:bg-transparent">
              <Link to="/">
                <BrandMark />
                <span className="truncate text-sm font-semibold text-sidebar-accent-foreground">{productName}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="gap-0 py-2">
        {sections.map((section) => (
          <SidebarGroup key={section.label} className="py-1">
            {section.label !== "Home" && <SidebarGroupLabel className="h-7 text-xs text-muted-foreground">{t(section.label)}</SidebarGroupLabel>}
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {section.items.map((item) => item.children ? (
                  <NavGroup key={item.name} item={item} active={active} iconClass={toneClasses[section.tone].text} />
                ) : (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton asChild isActive={active === item.path} tooltip={t(item.name)} className={navButtonClass}>
                      <Link to={item.path}>
                        <item.icon className={toneClasses[section.tone].text} />
                        <span>{t(item.name)}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  )
}
