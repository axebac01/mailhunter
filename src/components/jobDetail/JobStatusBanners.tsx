import { Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { JobRow } from "@/lib/api";

interface DomainStats { total: number; resolved: number; unresolved: number; failed: number }

interface Props {
  job: JobRow;
  domainStats: DomainStats | null | undefined;
  resumePending: boolean;
  onResume: () => void;
}

export function JobStatusBanners({ job, domainStats, resumePending, onResume }: Props) {
  return (
    <>
      {(job.status === "paused" || job.status === "stopped") && (
        <>
          {job.status === "paused" && job.metaJson?.paused_reason === "firecrawl_payment_required" && (
            <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="font-medium text-destructive">Auto-paused — Firecrawl ran out of credits.</div>
                <div className="text-muted-foreground mt-0.5">
                  Top up your Firecrawl account, then click <strong>Start</strong> to resume. Failed domains will be reset and re-tried automatically — no other jobs are started.
                </div>
              </div>
              <Button asChild size="sm" variant="outline">
                <a href="https://www.firecrawl.dev/app/billing" target="_blank" rel="noreferrer">Open Firecrawl</a>
              </Button>
            </div>
          )}
          {job.status === "paused" && job.metaJson?.paused_reason === "stalled" && (
            <div className="mb-3 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
              <div className="font-medium">Auto-paused — no progress for several minutes.</div>
              <div className="text-muted-foreground mt-0.5">
                The job stopped making progress (likely Firecrawl errors or a stuck resolver). Click <strong>Start</strong> to retry from a clean state.
              </div>
            </div>
          )}
          <div className={cn(
            "mb-3 rounded-md border px-4 py-3 text-sm flex items-center gap-2",
            job.status === "paused" ? "border-warning/40 bg-warning/10" : "border-border bg-muted"
          )}>
            {job.status === "paused"
              ? <span>Scraper paused. Click <strong>Start</strong> to resume from where it left off.</span>
              : <span>Scraper stopped. Click <strong>Start</strong> to resume.</span>}
          </div>
        </>
      )}

      {job.sourceType === "uploaded" && job.status === "running" && domainStats && domainStats.unresolved > 0 && (
        <div className="mb-3 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-warning" />
          <span>Resolving domains: {domainStats.resolved} of {domainStats.total} done — scraping continues automatically as domains resolve.</span>
        </div>
      )}

      {job.sourceType === "uploaded" && job.status === "completed" && domainStats &&
       (job.companiesFound < domainStats.resolved || domainStats.unresolved > 0) && (
        <div className="mb-6 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm flex items-center justify-between gap-2">
          <span>
            This job finished early: {job.companiesFound} scraped but {domainStats.resolved} have resolved domains
            {domainStats.unresolved > 0 ? ` (${domainStats.unresolved} still resolving)` : ""}.
          </span>
          <Button size="sm" variant="outline" onClick={onResume} disabled={resumePending}>
            {resumePending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Resume scraping
          </Button>
        </div>
      )}
    </>
  );
}
