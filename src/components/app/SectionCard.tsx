import { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Props {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  noPadding?: boolean;
}

export function SectionCard({ title, description, action, children, className, noPadding }: Props) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div>
          <h2 className="font-semibold text-sm text-foreground">{title}</h2>
          {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
        </div>
        {action}
      </div>
      <div className={noPadding ? "" : "p-5"}>{children}</div>
    </Card>
  );
}
