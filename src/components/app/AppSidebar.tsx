import { NavLink, useLocation } from "react-router-dom";
import { LayoutDashboard, Briefcase, PlusSquare, Upload, Mail, Users, Building2, Settings, Target } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

const main = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Jobs", url: "/jobs", icon: Briefcase },
  { title: "Create Job", url: "/jobs/new", icon: PlusSquare },
  { title: "Imports", url: "/imports", icon: Upload },
];
const data = [
  { title: "Contacts", url: "/contacts", icon: Mail },
  { title: "People", url: "/people", icon: Users },
  { title: "Companies", url: "/companies", icon: Building2 },
];
const sys = [{ title: "Settings", url: "/settings", icon: Settings }];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();

  const link = ({ isActive }: { isActive: boolean }) =>
    cn(
      "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors w-full",
      isActive
        ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
        : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
    );

  const renderGroup = (label: string, items: typeof main) => (
    <SidebarGroup>
      {!collapsed && <SidebarGroupLabel className="text-sidebar-foreground/50 text-xs uppercase tracking-wider px-3">{label}</SidebarGroupLabel>}
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const isActive =
              item.url === "/"
                ? location.pathname === "/"
                : location.pathname === item.url || location.pathname.startsWith(item.url + "/");
            return (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton asChild>
                  <NavLink to={item.url} end={item.url === "/"} className={link({ isActive })}>
                    <item.icon className="h-4 w-4 shrink-0" />
                    {!collapsed && <span>{item.title}</span>}
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <div className="flex items-center gap-2 px-4 h-16 border-b border-sidebar-border">
        <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-primary to-primary-hover flex items-center justify-center shrink-0">
          <Target className="h-4 w-4 text-primary-foreground" />
        </div>
        {!collapsed && (
          <div className="flex flex-col">
            <span className="text-sidebar-foreground font-semibold text-sm leading-tight">mailhunter.ai</span>
            <span className="text-sidebar-foreground/50 text-[10px] leading-tight">Internal admin</span>
          </div>
        )}
      </div>
      <SidebarContent className="bg-sidebar">
        {renderGroup("Workflows", main)}
        {renderGroup("Data", data)}
        {renderGroup("System", sys)}
      </SidebarContent>
    </Sidebar>
  );
}
