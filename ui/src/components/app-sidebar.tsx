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
import { findActiveNav, navItemLabel, toneClasses, useNavSections, type NavItem } from "@/lib/navigation"
import { BrandMark, productName } from "@/components/brand"
import { t } from "@/lib/i18n"

const navButtonClass = [
  "h-8 text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
  "data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground",
].join(" ")

const firstPagePath = (item: NavItem): string => item.children ? firstPagePath(item.children[0]) : item.path

const containsPage = (item: NavItem, path?: string): boolean =>
  Boolean(path && (item.path === path || item.children?.some((child) => containsPage(child, path))))

function NavLeaf({ item, active }: { item: NavItem; active?: string }) {
  return (
    <SidebarMenuSubItem key={item.path}>
      <SidebarMenuSubButton asChild isActive={active === item.path} className="h-7 data-[active=true]:font-medium">
        <Link to={item.path} title={navItemLabel(item)}><span>{navItemLabel(item)}</span></Link>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  )
}

function NavNestedGroup({ item, active }: { item: NavItem; active?: string }) {
  const children = item.children || []
  const containsActive = containsPage(item, active)
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  const open = userOpen ?? containsActive

  return (
    <Collapsible asChild open={open} onOpenChange={setUserOpen} className="group/nested">
      <SidebarMenuSubItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuSubButton isActive={containsActive && !open} className="w-full" title={navItemLabel(item)}>
            <span>{navItemLabel(item)}</span>
            <ChevronRight className="ml-auto size-3.5 text-muted-foreground transition-transform group-data-[state=open]/nested:rotate-90" />
          </SidebarMenuSubButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub className="mx-2 gap-0.5 py-0">
            {children.map((child) => child.children
              ? <NavNestedGroup key={child.path || child.name} item={child} active={active} />
              : <NavLeaf key={child.path} item={child} active={active} />)}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuSubItem>
    </Collapsible>
  )
}

function NavSubGroup({ item, active }: { item: NavItem; active?: string }) {
  const children = item.children || []
  const containsActive = containsPage(item, active)
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  const open = userOpen ?? containsActive

  return (
    <Collapsible asChild open={open} onOpenChange={setUserOpen} className="group/subcollapsible">
      <SidebarMenuSubItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuSubButton isActive={containsActive && !open} className="w-full" title={navItemLabel(item)}>
            <span>{navItemLabel(item)}</span>
            <ChevronRight className="ml-auto size-3.5 text-muted-foreground transition-transform group-data-[state=open]/subcollapsible:rotate-90" />
          </SidebarMenuSubButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub className="mx-2 gap-0.5 py-0">
            {children.map((child) => child.children ? (
              <NavNestedGroup key={child.path || child.name} item={child} active={active} />
            ) : (
              <NavLeaf key={child.path} item={child} active={active} />
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuSubItem>
    </Collapsible>
  )
}

/**
 * A navigation group: opens by itself when the current page is inside it, and remembers when the
 * user folds it. Collapsed to icons, it links to its first page instead.
 */
function NavGroup({ item, active, iconClass }: { item: NavItem; active?: string; iconClass: string }) {
  const { state, isMobile } = useSidebar()
  const children = item.children || []
  const containsActive = containsPage(item, active)
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  const open = userOpen ?? containsActive

  if (state === "collapsed" && !isMobile) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton asChild isActive={containsActive} tooltip={navItemLabel(item)} className={navButtonClass}>
          <Link to={firstPagePath(item)}>
            <item.icon className={iconClass} />
            <span>{navItemLabel(item)}</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    )
  }

  return (
    <Collapsible asChild open={open} onOpenChange={setUserOpen} className="group/collapsible">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton tooltip={navItemLabel(item)} className={navButtonClass} isActive={containsActive && !open}>
            <item.icon className={iconClass} />
            <span>{navItemLabel(item)}</span>
            <ChevronRight className="ml-auto size-3.5 text-muted-foreground transition-transform group-data-[state=open]/collapsible:rotate-90" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub className="mr-0 gap-0.5 pr-0">
            {children.map((child) => child.children ? (
              <NavSubGroup key={child.path || child.name} item={child} active={active} />
            ) : (
              <SidebarMenuSubItem key={child.path}>
                <SidebarMenuSubButton asChild isActive={active === child.path} className="h-7 data-[active=true]:font-medium">
                  <Link to={child.path} title={navItemLabel(child)}><span>{navItemLabel(child)}</span></Link>
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
                    <SidebarMenuButton asChild isActive={active === item.path} tooltip={navItemLabel(item)} className={navButtonClass}>
                      <Link to={item.path}>
                        <item.icon className={toneClasses[section.tone].text} />
                        <span>{navItemLabel(item)}</span>
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
