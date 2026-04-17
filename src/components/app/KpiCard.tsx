import { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Props {
  label: string;
  value: string | number;
  icon?: ReactNode;
  hint?: string;
  trend?: "up" | "down" | "neutral";
  className?: string;
}

export function KpiCard({ label, value, icon, hint, className }: Props) {
  return (
    <Card className={cn("p-5 hover:shadow-elevated transition-shadow", className)}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
          <p className="text-2xl font-semibold text-foreground mt-2 tracking-tight">{value}</p>
          {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
        </div>
        {icon && <div className="h-9 w-9 rounded-lg bg-accent flex items-center justify-center text-accent-foreground">{icon}</div>}
      </div>
    </Card>
  );
}
