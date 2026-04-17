import { ReactNode } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";

interface Props {
  children: ReactNode;
}

export function AppLayout({ children }: Props) {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-16 border-b border-border bg-card flex items-center px-4 gap-3 sticky top-0 z-30">
            <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
            <div className="h-6 w-px bg-border" />
            <span className="text-sm text-muted-foreground">mailhunter.ai</span>
            <span className="text-muted-foreground/40">/</span>
            <span className="text-sm font-medium text-foreground">Public Company Contact Research</span>
          </header>
          <main className="flex-1 overflow-auto">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}
