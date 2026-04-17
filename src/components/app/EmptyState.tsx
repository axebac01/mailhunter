import { ReactNode } from "react";
import { Inbox } from "lucide-react";

interface Props {
  title?: string;
  description: string;
  icon?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ title, description, icon, action }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center text-muted-foreground mb-4">
        {icon ?? <Inbox className="h-5 w-5" />}
      </div>
      {title && <h3 className="font-medium text-foreground">{title}</h3>}
      <p className="text-sm text-muted-foreground mt-1 max-w-md">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
