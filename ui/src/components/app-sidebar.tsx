import { Link, useLocation } from "react-router-dom"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import { useNetworkProfile } from "@/lib/kube"
import { findActiveNav, useNavSections } from "@/lib/navigation"

const navButtonClass = [
  "h-8 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&>svg]:text-muted-foreground",
  "data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground data-[active=true]:[&>svg]:text-sidebar-accent-foreground",
].join(" ")

export function AppSidebar() {
  const location = useLocation()
  const profile = useNetworkProfile()
  const sections = useNavSections()
  const active = findActiveNav(location.pathname)?.item.path

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="h-(--header-height) justify-center border-b border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild className="h-9 hover:bg-transparent active:bg-transparent">
              <Link to="/">
                <div className="flex aspect-square size-7 shrink-0 items-center justify-center rounded-md bg-foreground font-mono text-xs font-semibold text-background">kv</div>
                <span className="text-sm font-semibold text-sidebar-accent-foreground">virt console</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="gap-0 py-2">
        {sections.map((section) => (
          <SidebarGroup key={section.label} className="py-1">
            {section.label !== "Home" && <SidebarGroupLabel className="h-7 text-xs text-muted-foreground">{section.label}</SidebarGroupLabel>}
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {section.items.map((item) => (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton asChild isActive={active === item.path} tooltip={item.name} className={navButtonClass}>
                      <Link to={item.path}>
                        <item.icon />
                        <span>{item.name}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border group-data-[collapsible=icon]:hidden">
        <Link to="/settings" className="flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-sidebar-accent">
          <span className={profile.loaded ? "size-2 shrink-0 rounded-full bg-green-600" : "size-2 shrink-0 rounded-full bg-muted-foreground/40"} />
          <div className="min-w-0">
            <div className="truncate text-xs font-medium text-sidebar-accent-foreground">{profile.loaded ? profile.label : "Detecting..."}</div>
            <div className="truncate text-xs text-muted-foreground">
              ACL {profile.aclEngines.length ? profile.aclEngines.map((engine) => engine === "cilium" ? "Cilium" : "Kube-OVN").join(" / ") : "NetworkPolicy"}
            </div>
          </div>
        </Link>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
