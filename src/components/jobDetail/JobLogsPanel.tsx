import { useMemo, useState } from "react";
import { SectionCard } from "@/components/app/SectionCard";
import { EmptyState } from "@/components/app/EmptyState";
import { fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CrawlLogRow } from "@/lib/api";

type LogFilter = "all" | "done" | "errors" | "shutdown" | "resolver";

const matchLog = (l: CrawlLogRow, f: LogFilter) => {
  const ev = l.metaJson?.event;
  if (f === "done") return ev === "company_finished";
  if (f === "errors") return l.level === "error" || l.level === "warn";
  if (f === "shutdown") return /paused by user|stopped by user|resumed|shutdown|aborted/i.test(l.message ?? "");
  if (f === "resolver") return ev === "resolve_started" || ev === "resolve_deferred" || ev === "resolve_completed";
  return true;
};

export function JobLogsPanel({ logs }: { logs: CrawlLogRow[] }) {
  const [logFilter, setLogFilter] = useState<LogFilter>("all");

  const logCounts = useMemo(() => {
    const c = { all: logs.length, done: 0, errors: 0, shutdown: 0, resolver: 0 };
    for (const l of logs) {
      if (matchLog(l, "done")) c.done++;
      if (matchLog(l, "errors")) c.errors++;
      if (matchLog(l, "shutdown")) c.shutdown++;
      if (matchLog(l, "resolver")) c.resolver++;
    }
    return c;
  }, [logs]);

  const filteredLogs = useMemo(() => logs.filter((l) => matchLog(l, logFilter)), [logs, logFilter]);

  const chips: { key: LogFilter; label: string; n: number }[] = [
    { key: "all", label: "All", n: logCounts.all },
    { key: "done", label: "Companies done", n: logCounts.done },
    { key: "errors", label: "Errors", n: logCounts.errors },
    { key: "shutdown", label: "Shutdown", n: logCounts.shutdown },
    { key: "resolver", label: "Resolver", n: logCounts.resolver },
  ];

  return (
    <SectionCard title="Activity log" noPadding>
      <div className="flex items-center gap-2 flex-wrap px-5 py-3 border-b border-border">
        {chips.map((c) => (
          <button
            key={c.key}
            onClick={() => setLogFilter(c.key)}
            className={cn(
              "text-xs px-2.5 py-1 rounded-full border transition-colors",
              logFilter === c.key
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground border-border hover:bg-muted",
            )}
          >
            {c.label} · {c.n}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {filteredLogs.length} of {logCounts.all}
        </span>
      </div>
      <div className="divide-y divide-border max-h-[500px] overflow-auto scrollbar-thin font-mono text-xs">
        {logCounts.all === 0 && <EmptyState description="No log entries yet." />}
        {logCounts.all > 0 && filteredLogs.length === 0 && (
          <EmptyState description="No log entries match this filter." />
        )}
        {filteredLogs.map((l) => (
          <div key={l.id} className="px-5 py-2 flex items-start gap-3">
            <span className={
              l.level === "error" ? "text-destructive" :
              l.level === "warn" ? "text-warning" :
              l.level === "success" ? "text-success" : "text-muted-foreground"
            }>[{l.level}]</span>
            <span className="text-muted-foreground shrink-0">{fmtRelative(l.createdAt)}</span>
            <span>{l.message}</span>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
