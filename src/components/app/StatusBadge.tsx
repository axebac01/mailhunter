import { cn } from "@/lib/utils";
import type { ImportStatus, JobStatus } from "@/types";

const jobMap: Record<JobStatus, { label: string; cls: string; dot?: boolean }> = {
  draft: { label: "Draft", cls: "bg-muted text-muted-foreground" },
  scheduled: { label: "Scheduled", cls: "bg-info/10 text-info" },
  running: { label: "Running", cls: "bg-primary/10 text-primary", dot: true },
  paused: { label: "Paused", cls: "bg-warning/10 text-warning" },
  completed: { label: "Completed", cls: "bg-success/10 text-success" },
  failed: { label: "Failed", cls: "bg-destructive/10 text-destructive" },
  stopped: { label: "Stopped", cls: "bg-muted text-muted-foreground" },
};

const importMap: Record<ImportStatus, { label: string; cls: string }> = {
  pending: { label: "Pending", cls: "bg-muted text-muted-foreground" },
  matched: { label: "Matched", cls: "bg-success/10 text-success" },
  partial_match: { label: "Partial", cls: "bg-info/10 text-info" },
  not_found: { label: "Not found", cls: "bg-warning/10 text-warning" },
  duplicate: { label: "Duplicate", cls: "bg-accent text-accent-foreground" },
  failed: { label: "Failed", cls: "bg-destructive/10 text-destructive" },
};

export function JobStatusBadge({ status }: { status: JobStatus }) {
  const c = jobMap[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium", c.cls)}>
      {c.dot && <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse-soft" />}
      {c.label}
    </span>
  );
}

export function ImportStatusBadge({ status }: { status: ImportStatus }) {
  const c = importMap[status];
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", c.cls)}>{c.label}</span>;
}

export function ContactTypeBadge({ type }: { type: "generic_email" | "phone" | "contact_form" }) {
  const map = {
    generic_email: { label: "Generic email", cls: "bg-primary/10 text-primary" },
    phone: { label: "Phone", cls: "bg-info/10 text-info" },
    contact_form: { label: "Contact form", cls: "bg-accent text-accent-foreground" },
  } as const;
  const c = map[type];
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", c.cls)}>{c.label}</span>;
}
