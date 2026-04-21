import { Link } from "react-router-dom";
import { Globe, FileText, Mail, Users, Play, Check, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtRelative } from "@/lib/format";

export type TimelineEventType =
  | "pages_discovered"
  | "page_crawled"
  | "emails_found"
  | "people_extracted"
  | "company_started"
  | "company_finished";

interface Props {
  event: TimelineEventType;
  createdAt: string;
  meta: any;
  level: string;
}

const CONFIG: Record<TimelineEventType, { color: string; bg: string; Icon: any; label: string }> = {
  pages_discovered:  { color: "text-info",      bg: "bg-info/10",      Icon: Globe,       label: "Discovered" },
  page_crawled:      { color: "text-foreground",bg: "bg-muted",        Icon: FileText,    label: "Crawled" },
  emails_found:      { color: "text-success",   bg: "bg-success/10",   Icon: Mail,        label: "Emails" },
  people_extracted:  { color: "text-primary",   bg: "bg-primary/10",   Icon: Users,       label: "People" },
  company_started:   { color: "text-muted-foreground", bg: "bg-muted", Icon: Play,        label: "Start" },
  company_finished:  { color: "text-muted-foreground", bg: "bg-muted", Icon: Check,       label: "Done" },
};

function summarize(event: TimelineEventType, meta: any): string {
  const company = meta?.company ?? meta?.host ?? "company";
  switch (event) {
    case "pages_discovered":
      return `${meta?.count ?? 0} pages discovered on ${meta?.host ?? company}`;
    case "page_crawled": {
      let path = meta?.url ?? "";
      try { path = new URL(meta.url).pathname || "/"; } catch { /* */ }
      const n = meta?.emails_on_page ?? 0;
      const ppl = meta?.people_on_page ?? 0;
      const bits = [`${n} email${n === 1 ? "" : "s"}`];
      if (ppl > 0) bits.push(`${ppl} people`);
      return `Crawled ${path} — ${bits.join(", ")}`;
    }
    case "emails_found": {
      const samples: string[] = Array.isArray(meta?.samples) ? meta.samples : [];
      const tail = samples.length ? ` — ${samples.slice(0, 3).join(", ")}` : "";
      const synth = meta?.synthesized > 0 ? ` (${meta.synthesized} synthesized)` : "";
      return `Found ${meta?.person_emails ?? 0} person + ${meta?.generic_emails ?? 0} generic on ${company}${synth}${tail}`;
    }
    case "people_extracted": {
      const samples: { name: string; role?: string | null }[] = Array.isArray(meta?.samples) ? meta.samples : [];
      const tail = samples.length
        ? ` — ${samples.map((s) => s.role ? `${s.name} (${s.role})` : s.name).join(", ")}`
        : "";
      return `Extracted ${meta?.count ?? 0} ${meta?.count === 1 ? "person" : "people"} from ${company}${tail}`;
    }
    case "company_started":
      return `Started ${company}`;
    case "company_finished": {
      const ms = meta?.duration_ms ?? 0;
      return `Finished ${company} in ${Math.round(ms / 1000)}s${meta?.ok === false ? " (with errors)" : ""}`;
    }
  }
}

export function TimelineEvent({ event, createdAt, meta, level }: Props) {
  const cfg = CONFIG[event];
  if (!cfg) return null;
  const Icon = level === "error" ? AlertCircle : cfg.Icon;
  const colorOverride = level === "error" ? "text-destructive" : cfg.color;
  const bgOverride = level === "error" ? "bg-destructive/10" : cfg.bg;
  const companyId = meta?.company_id;
  const company = meta?.company ?? meta?.host;

  return (
    <div className="flex items-start gap-3 px-5 py-3 hover:bg-muted/40 transition-colors">
      <div className={cn("h-7 w-7 rounded-full flex items-center justify-center shrink-0", bgOverride)}>
        <Icon className={cn("h-3.5 w-3.5", colorOverride)} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          {companyId ? (
            <Link to={`/companies/${companyId}`} className="font-medium text-sm hover:underline truncate">
              {company}
            </Link>
          ) : (
            <span className="font-medium text-sm truncate">{company}</span>
          )}
          <span className={cn("text-[10px] uppercase tracking-wide font-medium px-1.5 py-0.5 rounded", bgOverride, colorOverride)}>
            {cfg.label}
          </span>
          <span className="text-xs text-muted-foreground ml-auto shrink-0">{fmtRelative(createdAt)}</span>
        </div>
        <p className="text-sm text-muted-foreground mt-0.5 break-words">{summarize(event, meta)}</p>
      </div>
    </div>
  );
}
