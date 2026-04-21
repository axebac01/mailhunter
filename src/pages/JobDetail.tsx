import { useEffect, useMemo, useRef, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Play, Pause, Square, Copy, Building2, Mail, Users, Globe, Trash2, Search, Activity, Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { api, type JobStatus } from "@/lib/api";
import { startSimulator, stopSimulator } from "@/lib/jobSimulator";
import { exportJobResults } from "@/lib/exporters";
import { PageHeader } from "@/components/app/PageHeader";
import { SectionCard } from "@/components/app/SectionCard";
import { JobStatusBadge, ContactTypeBadge } from "@/components/app/StatusBadge";
import { ProgressBar } from "@/components/app/ProgressBar";
import { KpiCard } from "@/components/app/KpiCard";
import { EmptyState } from "@/components/app/EmptyState";
import { ExportButton } from "@/components/app/ExportButton";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { fmtDateTime, fmtRelative, fmtNum } from "@/lib/format";
import { TimelineEvent, type TimelineEventType } from "@/components/app/TimelineEvent";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export default function JobDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const job = useQuery({ queryKey: ["job", id], queryFn: () => api.getJob(id), refetchInterval: 2500 });

  type PendingAction = { kind: "pausing" | "stopping"; startedAt: number; estimatedWaveMs: number };
  const PENDING_KEY = (jobId: string) => `jobDetail:pendingAction:${jobId}`;

  const [pendingAction, setPendingActionState] = useState<PendingAction | null>(() => {
    if (typeof window === "undefined" || !id) return null;
    try {
      const raw = sessionStorage.getItem(PENDING_KEY(id));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as PendingAction;
      // Only rehydrate if startedAt is recent (< 90s old)
      if (Date.now() - parsed.startedAt > 90_000) {
        sessionStorage.removeItem(PENDING_KEY(id));
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  });

  const setPendingAction = (next: PendingAction | null) => {
    setPendingActionState(next);
    if (typeof window === "undefined" || !id) return;
    try {
      if (next) sessionStorage.setItem(PENDING_KEY(id), JSON.stringify(next));
      else sessionStorage.removeItem(PENDING_KEY(id));
    } catch {
      /* ignore quota / privacy errors */
    }
  };

  const [, setTick] = useState(0);

  // Smooth countdown via rAF, throttled to ~250ms updates. Avoids interval drift / focus jitter.
  useEffect(() => {
    if (!pendingAction) return;
    let rafId = 0;
    let last = 0;
    const loop = (now: number) => {
      if (now - last >= 250) {
        last = now;
        setTick((t) => (t + 1) % 1_000_000);
      }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [pendingAction]);

  // Estimate wave duration: p90 of last 20 "company_finished" durations + 3s buffer.
  function estimateWaveMs(): number {
    const rows = (logs.data ?? []) as any[];
    const samples: number[] = [];
    for (const r of rows) {
      const meta = r?.meta ?? r?.meta_json;
      if (meta?.event === "company_finished" && typeof meta.duration_ms === "number") {
        samples.push(meta.duration_ms);
        if (samples.length >= 20) break;
      }
    }
    if (samples.length === 0) return 45000;
    const sorted = [...samples].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9));
    const p90 = sorted[idx];
    return Math.min(60000, Math.max(5000, p90 + 3000));
  }

  // Inline circular progress ring used in the Pausing…/Stopping… pill.
  function CountdownRing({ progress, className }: { progress: number; className?: string }) {
    const r = 5;
    const c = 2 * Math.PI * r;
    const clamped = Math.max(0, Math.min(1, progress));
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" className={className} aria-hidden="true">
        <circle cx="7" cy="7" r={r} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
        <circle
          cx="7" cy="7" r={r} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - clamped)}
          transform="rotate(-90 7 7)" style={{ transition: "stroke-dashoffset 250ms linear" }}
        />
      </svg>
    );
  }

  // Lightweight poll for the latest log row while a pause/stop is pending
  const latestLog = useQuery({
    queryKey: ["latestLog", id, pendingAction?.startedAt],
    queryFn: async () => {
      const { data } = await supabase
        .from("crawl_logs")
        .select("message, created_at")
        .eq("crawl_job_id", id)
        .order("created_at", { ascending: false })
        .limit(5);
      return data ?? [];
    },
    refetchInterval: pendingAction ? 3000 : false,
    enabled: !!pendingAction,
  });

  // Detect worker exit: matching log line newer than click, or 60s safety timeout
  useEffect(() => {
    if (!pendingAction) return;
    const needle = pendingAction.kind === "pausing" ? "paused by user" : "stopped by user";
    const rows = latestLog.data ?? [];
    const exited = rows.some((r: any) => {
      const ts = new Date(r.created_at).getTime();
      return ts >= pendingAction.startedAt - 1000 && typeof r.message === "string" && r.message.toLowerCase().includes(needle);
    });
    if (exited) {
      setPendingAction(null);
      return;
    }
    const elapsed = Date.now() - pendingAction.startedAt;
    const remaining = 60000 - elapsed;
    if (remaining <= 0) {
      // Auto-refetch once before surrendering — worker may have exited just now.
      (async () => {
        await Promise.all([
          qc.invalidateQueries({ queryKey: ["job", id] }),
          qc.invalidateQueries({ queryKey: ["logs", id] }),
          latestLog.refetch(),
        ]);
        const fresh = (latestLog.data ?? []) as any[];
        const justExited = fresh.some((r: any) => {
          const ts = new Date(r.created_at).getTime();
          return ts >= pendingAction.startedAt - 1000 && typeof r.message === "string" && r.message.toLowerCase().includes(needle);
        });
        setPendingAction(null);
        if (!justExited) {
          toast("Worker is taking longer than expected. The status is correct — refresh logs to confirm.", {
            action: {
              label: "Refresh logs",
              onClick: () => qc.invalidateQueries({ queryKey: ["logs", id] }),
            },
          });
        }
      })();
      return;
    }
    const t = setTimeout(() => setPendingAction(null), remaining);
    return () => clearTimeout(t);
  }, [pendingAction, latestLog.data]);
  const allJobs = useQuery({ queryKey: ["jobs"], queryFn: () => api.listJobs() });
  const allContacts = useQuery({ queryKey: ["contacts"], queryFn: () => api.listContacts(), refetchInterval: 2500 });
  const allPeople = useQuery({ queryKey: ["people"], queryFn: () => api.listPeople(), refetchInterval: 2500 });
  const logs = useQuery({ queryKey: ["logs", id], queryFn: () => api.listLogs(id), refetchInterval: 2500 });
  const sourcePages = useQuery({ queryKey: ["sourcePages", id], queryFn: () => api.listSourcePages({ jobId: id }), refetchInterval: 5000 });
  const domainStats = useQuery({
    queryKey: ["domainStats", id],
    queryFn: async () => {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data: imports } = await supabase.from("imports").select("id").eq("crawl_job_id", id);
      const importIds = (imports ?? []).map((i: any) => i.id);
      if (importIds.length === 0) return null;
      const { data: rows } = await supabase.from("import_rows").select("matched_company_id").in("import_id", importIds).not("matched_company_id", "is", null);
      const companyIds = Array.from(new Set((rows ?? []).map((r: any) => r.matched_company_id).filter(Boolean)));
      if (companyIds.length === 0) return { total: 0, resolved: 0, unresolved: 0, failed: 0 };
      const { data: companies } = await supabase.from("companies").select("id, domain, domain_status").in("id", companyIds);
      const list = (companies ?? []) as any[];
      return {
        total: list.length,
        resolved: list.filter((c) => c.domain).length,
        unresolved: list.filter((c) => !c.domain && (c.domain_status === "unresolved" || !c.domain_status)).length,
        failed: list.filter((c) => !c.domain && c.domain_status === "failed").length,
      };
    },
    refetchInterval: 5000,
    enabled: !!id,
  });

  const [contactsFilter, setContactsFilter] = useState<string>(id);
  useEffect(() => { setContactsFilter(id); }, [id]);

  const jobContacts = useMemo(() => {
    const list = allContacts.data ?? [];
    if (contactsFilter === "all") return list;
    return list.filter((c) => c.jobId === contactsFilter);
  }, [allContacts.data, contactsFilter]);
  const jobPeople = useMemo(() => (allPeople.data ?? []).filter((p) => p.jobId === id), [allPeople.data, id]);

  const updateStatus = useMutation({
    mutationFn: (s: JobStatus) => api.updateJobStatus(id, s),
    onSuccess: (_d, s) => {
      if (s === "running") startSimulator(id); else stopSimulator(id);
      qc.invalidateQueries({ queryKey: ["job", id] });
      qc.invalidateQueries({ queryKey: ["jobs"] });
    },
  });

  const dup = useMutation({
    mutationFn: () => api.duplicateJob(id),
    onSuccess: (j) => { qc.invalidateQueries({ queryKey: ["jobs"] }); toast.success("Duplicated"); navigate(`/jobs/${j.id}`); },
  });

  const clearContacts = useMutation({
    mutationFn: () => api.clearJobContacts(id),
    onSuccess: () => {
      toast.success("Cleared all contacts for this job");
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["people"] });
      qc.invalidateQueries({ queryKey: ["sourcePages", id] });
      qc.invalidateQueries({ queryKey: ["job", id] });
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["kpis"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to clear"),
  });

  const resolveDomains = useMutation({
    mutationFn: async (vars?: { retryFailed?: boolean; reresolveAll?: boolean }) => {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data, error } = await supabase.functions.invoke("resolve-domains-batch", {
        body: { jobId: id, retryFailed: vars?.retryFailed ?? false, reresolveAll: vars?.reresolveAll ?? false },
      });
      if (error) throw error;
      return data as { resolved: number; failed: number; total: number; paymentRequired?: boolean };
    },
    onSuccess: (r) => {
      if (r?.paymentRequired) {
        toast.error("Firecrawl: insufficient credits. Top up to continue.");
      } else {
        toast.success(`Domain resolution: ${r?.resolved ?? 0} resolved, ${r?.failed ?? 0} failed (of ${r?.total ?? 0}).`);
      }
      qc.invalidateQueries({ queryKey: ["domainStats", id] });
      qc.invalidateQueries({ queryKey: ["companies"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Resolve domains failed"),
  });

  const resumeScraping = useMutation({
    mutationFn: async () => {
      await api.updateJobStatus(id, "running");
      const { data, error } = await supabase.functions.invoke("scrape-emails-batch", { body: { jobId: id } });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Resumed scraping");
      qc.invalidateQueries({ queryKey: ["job", id] });
      qc.invalidateQueries({ queryKey: ["logs", id] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Resume failed"),
  });

  useEffect(() => () => {/* keep simulator running across navigations */}, []);

  if (job.isLoading) return <div className="p-6">Loading…</div>;
  const j = job.data;
  if (!j) return (
    <div className="p-6">
      <Button variant="ghost" size="sm" onClick={() => navigate("/jobs")}><ArrowLeft className="h-4 w-4" /> Back</Button>
      <EmptyState description="Job not found." />
    </div>
  );

  const handleExport = async (_scope: "all"|"filtered"|"selected", format: "csv"|"xlsx") => {
    const name = await exportJobResults(jobContacts, format);
    qc.invalidateQueries({ queryKey: ["kpis"] });
    toast.success(`Exported ${name}`);
  };

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <Button variant="ghost" size="sm" className="mb-3" onClick={() => navigate("/jobs")}><ArrowLeft className="h-4 w-4" /> All jobs</Button>
      <PageHeader
        title={j.name}
        description={`${j.industry ?? "—"} · ${j.country ?? "—"}`}
        actions={
          <>
            <Button variant="outline" size="sm" disabled={j.status === "running" || resumeScraping.isPending || !!pendingAction} onClick={() => {
              if (j.status === "paused" || j.status === "stopped") {
                resumeScraping.mutate();
              } else {
                updateStatus.mutate("running");
              }
            }}><Play className="h-4 w-4" /> Start</Button>
            <Button variant="outline" size="sm" disabled={j.status !== "running" || !!pendingAction} onClick={() => {
              setPendingAction({ kind: "pausing", startedAt: Date.now(), estimatedWaveMs: estimateWaveMs() });
              updateStatus.mutate("paused");
              toast("Pausing scraper — current batch will finish within ~45s");
            }}><Pause className="h-4 w-4" /> Pause</Button>
            <Button variant="outline" size="sm" disabled={j.status === "stopped" || !!pendingAction} onClick={() => {
              setPendingAction({ kind: "stopping", startedAt: Date.now(), estimatedWaveMs: estimateWaveMs() });
              updateStatus.mutate("stopped");
              toast("Stopping scraper");
            }}><Square className="h-4 w-4" /> Stop</Button>
            <Button variant="outline" size="sm" onClick={() => dup.mutate()}><Copy className="h-4 w-4" /> Duplicate</Button>
            {j.sourceType === "uploaded" && (
              <Button variant="outline" size="sm" onClick={() => resolveDomains.mutate(undefined)} disabled={resolveDomains.isPending}>
                <Search className="h-4 w-4" /> {resolveDomains.isPending ? "Resolving…" : "Resolve domains"}
              </Button>
            )}
            {j.sourceType === "uploaded" && (domainStats.data?.failed ?? 0) > 0 && (
              <Button variant="outline" size="sm" onClick={() => resolveDomains.mutate({ retryFailed: true })} disabled={resolveDomains.isPending}>
                <Search className="h-4 w-4" /> Retry failed ({domainStats.data?.failed})
              </Button>
            )}
            {j.sourceType === "uploaded" && (domainStats.data?.total ?? 0) > 0 && (
              <Button variant="outline" size="sm" onClick={() => resolveDomains.mutate({ reresolveAll: true })} disabled={resolveDomains.isPending}>
                <Search className="h-4 w-4" /> Re-resolve all
              </Button>
            )}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="text-destructive hover:text-destructive">
                  <Trash2 className="h-4 w-4" /> Clear this job's data
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear all data for this job?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete all contacts, people, crawled source pages, and synthetic demo companies generated for this job, and reset its counters to zero. Activity logs are kept. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => clearContacts.mutate()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <ExportButton onExport={handleExport} disableSelected />
          </>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <SectionCard title="Status" className="lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <JobStatusBadge status={j.status} />
              {pendingAction && (() => {
                const elapsed = Date.now() - pendingAction.startedAt;
                const remainingMs = Math.max(0, pendingAction.estimatedWaveMs - elapsed);
                const secs = Math.max(1, Math.ceil(remainingMs / 1000));
                const progress = pendingAction.estimatedWaveMs > 0
                  ? Math.min(1, elapsed / pendingAction.estimatedWaveMs)
                  : 1;
                const label = pendingAction.kind === "pausing" ? "Pausing" : "Stopping";
                const tail = remainingMs > 0 ? `~${secs}s left` : "finishing up…";
                return (
                  <span
                    role="status"
                    aria-live="polite"
                    aria-label={`${label}, ${remainingMs > 0 ? `about ${secs} seconds left` : "finishing up"}`}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium min-w-[160px]",
                      pendingAction.kind === "pausing" ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground"
                    )}
                  >
                    {remainingMs > 0
                      ? <CountdownRing progress={progress} />
                      : <Loader2 className="h-3 w-3 animate-spin" />}
                    <span aria-hidden="true">{label}…</span>
                    <span className="ml-auto tabular-nums opacity-80" aria-hidden="true">{tail}</span>
                  </span>
                );
              })()}
            </div>
            <span className="text-sm text-muted-foreground">{j.progress}% complete</span>
          </div>
          <ProgressBar value={j.progress} />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-5 text-sm">
            <div><p className="text-muted-foreground text-xs">Created</p><p className="font-medium">{fmtDateTime(j.createdAt)}</p></div>
            <div><p className="text-muted-foreground text-xs">Last run</p><p className="font-medium">{fmtRelative(j.lastRunAt)}</p></div>
            <div><p className="text-muted-foreground text-xs">Schedule</p><p className="font-medium">{j.startTime}–{j.endTime}</p></div>
            <div><p className="text-muted-foreground text-xs">Max companies</p><p className="font-medium">{fmtNum(j.maxCompanies)}</p></div>
          </div>
        </SectionCard>

        <SectionCard title="Configuration">
          <ul className="space-y-1.5 text-sm">
            <li className="flex justify-between"><span className="text-muted-foreground">Generic emails</span><span>{j.collectGenericEmails ? "Yes" : "No"}</span></li>
            <li className="flex justify-between"><span className="text-muted-foreground">Person emails</span><span>{j.collectPersonEmails ? "Yes" : "No"}</span></li>
            <li className="flex justify-between"><span className="text-muted-foreground">Phones</span><span>{j.collectPhones ? "Yes" : "No"}</span></li>
            <li className="flex justify-between"><span className="text-muted-foreground">Contact forms</span><span>{j.collectContactForms ? "Yes" : "No"}</span></li>
            <li className="flex justify-between"><span className="text-muted-foreground">Person names</span><span>{j.collectPersonNames ? "Yes" : "No"}</span></li>
            <li className="flex justify-between"><span className="text-muted-foreground">Person roles</span><span>{j.collectPersonRoles ? "Yes" : "No"}</span></li>
            <li className="flex justify-between"><span className="text-muted-foreground">Departments</span><span>{j.collectDepartments ? "Yes" : "No"}</span></li>
            <li className="flex justify-between"><span className="text-muted-foreground">Deduplicate</span><span>{j.deduplicate ? "Yes" : "No"}</span></li>
          </ul>
        </SectionCard>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <KpiCard label="Companies" value={fmtNum(j.companiesFound)} icon={<Building2 className="h-4 w-4" />} />
        <KpiCard label="Contacts" value={fmtNum(j.contactsFound)} icon={<Mail className="h-4 w-4" />} />
        <KpiCard
          label="Person emails"
          value={fmtNum((jobContacts ?? []).filter((c: any) => c.contactType === "person_email").length)}
          icon={<Mail className="h-4 w-4" />}
        />
        <KpiCard label="People" value={fmtNum(j.peopleFound)} icon={<Users className="h-4 w-4" />} />
        <KpiCard label="Pages crawled" value={fmtNum(j.pagesCrawled)} icon={<Globe className="h-4 w-4" />} />
      </div>

      {j.sourceType === "uploaded" && domainStats.data && (
        <div className="mb-3 rounded-md border border-border bg-card px-4 py-3 text-sm flex flex-wrap items-center gap-x-6 gap-y-1">
          <span className="font-medium">Domain resolution</span>
          <span className="text-muted-foreground">{domainStats.data.total} companies</span>
          <span className="text-success">✓ {domainStats.data.resolved} resolved</span>
          <span className="text-warning">… {domainStats.data.unresolved} pending</span>
          <span className="text-destructive">✗ {domainStats.data.failed} no domain found</span>
          {domainStats.data.failed > 0 && (
            <span className="text-xs text-muted-foreground ml-auto">Companies without a real domain are skipped — no fake emails are generated.</span>
          )}
        </div>
      )}

      {pendingAction ? (
        <div className={cn(
          "mb-3 rounded-md border px-4 py-3 text-sm flex items-center gap-2",
          pendingAction.kind === "pausing" ? "border-warning/40 bg-warning/10" : "border-border bg-muted"
        )}>
          <Loader2 className={cn("h-4 w-4 animate-spin", pendingAction.kind === "pausing" ? "text-warning" : "text-muted-foreground")} />
          <span>
            {(() => {
              const remainingMs = Math.max(0, pendingAction.estimatedWaveMs - (Date.now() - pendingAction.startedAt));
              const secs = Math.ceil(remainingMs / 1000);
              const tail = remainingMs > 0 ? `current batch finishing (~${secs}s left)…` : "current batch finishing up…";
              return pendingAction.kind === "pausing" ? `Pausing scraper — ${tail}` : `Stopping scraper — ${tail}`;
            })()}
          </span>
        </div>
      ) : (j.status === "paused" || j.status === "stopped") && (
        <div className={cn(
          "mb-3 rounded-md border px-4 py-3 text-sm flex items-center gap-2",
          j.status === "paused" ? "border-warning/40 bg-warning/10" : "border-border bg-muted"
        )}>
          {j.status === "paused"
            ? <span>Scraper paused. Click <strong>Start</strong> to resume from where it left off.</span>
            : <span>Scraper stopped. Click <strong>Start</strong> to resume.</span>}
        </div>
      )}

      {j.sourceType === "uploaded" && j.status === "running" && domainStats.data && domainStats.data.unresolved > 0 && (
        <div className="mb-3 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-warning" />
          <span>Resolving domains: {domainStats.data.resolved} of {domainStats.data.total} done — scraping continues automatically as domains resolve.</span>
        </div>
      )}

      {j.sourceType === "uploaded" && j.status === "completed" && domainStats.data &&
       (j.companiesFound < domainStats.data.resolved || domainStats.data.unresolved > 0) && (
        <div className="mb-6 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm flex items-center justify-between gap-2">
          <span>
            This job finished early: {j.companiesFound} scraped but {domainStats.data.resolved} have resolved domains
            {domainStats.data.unresolved > 0 ? ` (${domainStats.data.unresolved} still resolving)` : ""}.
          </span>
          <Button size="sm" variant="outline" onClick={() => resumeScraping.mutate()} disabled={resumeScraping.isPending}>
            {resumeScraping.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Resume scraping
          </Button>
        </div>
      )}

      <Tabs defaultValue="timeline">
        <TabsList>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="contacts">Contacts ({jobContacts.length})</TabsTrigger>
          <TabsTrigger value="people">People ({jobPeople.length})</TabsTrigger>
          <TabsTrigger value="pages">Source pages ({(sourcePages.data ?? []).length})</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="timeline">
          <JobTimeline jobId={id} />
        </TabsContent>

        <TabsContent value="contacts">
          <SectionCard title="Contact records" noPadding>
            <div className="flex items-center gap-3 px-5 py-3 border-b border-border">
              <Select value={contactsFilter} onValueChange={setContactsFilter}>
                <SelectTrigger className="w-[280px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={id}>This job</SelectItem>
                  <SelectItem value="all">All jobs</SelectItem>
                  {(allJobs.data ?? []).filter((x) => x.id !== id).map((x) => (
                    <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-sm text-muted-foreground">{jobContacts.length} record{jobContacts.length === 1 ? "" : "s"}</span>
            </div>
            {jobContacts.length === 0 ? <EmptyState description="No contacts yet for this job." /> : (
              <Table>
                <TableHeader><TableRow><TableHead>Company</TableHead><TableHead>Type</TableHead><TableHead>Value</TableHead><TableHead>Source</TableHead><TableHead>Found</TableHead></TableRow></TableHeader>
                <TableBody>
                  {jobContacts.slice(0, 100).map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.companyName}</TableCell>
                      <TableCell><ContactTypeBadge type={c.contactType} /></TableCell>
                      <TableCell className="font-mono text-xs">{c.contactValue}</TableCell>
                      <TableCell className="text-muted-foreground text-xs truncate max-w-[200px]">{c.sourceUrl}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{fmtRelative(c.foundAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionCard>
        </TabsContent>

        <TabsContent value="people">
          <SectionCard title="People records" noPadding>
            {jobPeople.length === 0 ? <EmptyState description="No people records yet for this job." /> : (
              <Table>
                <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Role</TableHead><TableHead>Department</TableHead><TableHead>Company</TableHead><TableHead>Found</TableHead></TableRow></TableHeader>
                <TableBody>
                  {jobPeople.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.fullName}</TableCell>
                      <TableCell>{p.roleTitle ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{p.department ?? "—"}</TableCell>
                      <TableCell>{p.companyName}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{fmtRelative(p.foundAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionCard>
        </TabsContent>

        <TabsContent value="pages">
          <SectionCard title="Source pages crawled" noPadding>
            {(sourcePages.data ?? []).length === 0 ? <EmptyState description="No pages crawled yet." /> : (
              <Table>
                <TableHeader><TableRow><TableHead>URL</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead>Crawled</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(sourcePages.data ?? []).map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-xs truncate max-w-[400px]">{p.url}</TableCell>
                      <TableCell className="text-muted-foreground">{p.pageType}</TableCell>
                      <TableCell className="text-muted-foreground">{p.statusCode ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{fmtRelative(p.crawledAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionCard>
        </TabsContent>

        <TabsContent value="logs">
          <SectionCard title="Activity log" noPadding>
            <div className="divide-y divide-border max-h-[500px] overflow-auto scrollbar-thin font-mono text-xs">
              {(logs.data ?? []).length === 0 && <EmptyState description="No log entries yet." />}
              {(logs.data ?? []).map((l) => (
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
        </TabsContent>
      </Tabs>
    </div>
  );
}

const TIMELINE_EVENT_TYPES: TimelineEventType[] = ["pages_discovered", "page_crawled", "emails_found", "people_extracted", "company_started", "company_finished", "resolve_started", "resolve_deferred", "resolve_completed"];
type FilterKey = "all" | "discovered" | "crawled" | "emails" | "people" | "resolver";
const RESOLVER_EVENTS: TimelineEventType[] = ["resolve_started", "resolve_deferred", "resolve_completed"];
const FILTER_TO_EVENTS: Record<FilterKey, TimelineEventType[]> = {
  all: TIMELINE_EVENT_TYPES,
  discovered: ["pages_discovered"],
  crawled: ["page_crawled"],
  emails: ["emails_found"],
  people: ["people_extracted"],
  resolver: RESOLVER_EVENTS,
};

interface TimelineRow {
  id: string;
  level: string;
  message: string;
  createdAt: string;
  meta: any;
  event: TimelineEventType | null;
}

function rowFromDb(r: any): TimelineRow {
  const ev = r.meta_json?.event;
  return {
    id: r.id,
    level: r.level,
    message: r.message,
    createdAt: r.created_at,
    meta: r.meta_json ?? {},
    event: TIMELINE_EVENT_TYPES.includes(ev) ? ev : null,
  };
}

function JobTimeline({ jobId }: { jobId: string }) {
  const [rows, setRows] = useState<TimelineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [paused, setPaused] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const pendingRef = useRef<TimelineRow[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data } = await supabase
        .from("crawl_logs")
        .select("*")
        .eq("crawl_job_id", jobId)
        .order("created_at", { ascending: false })
        .limit(300);
      if (cancelled) return;
      setRows((data ?? []).map(rowFromDb).filter((r) => r.event !== null));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [jobId]);

  useEffect(() => {
    const channel = supabase
      .channel(`timeline-${jobId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "crawl_logs", filter: `crawl_job_id=eq.${jobId}` }, (payload) => {
        const row = rowFromDb(payload.new);
        if (!row.event) return;
        if (paused) {
          pendingRef.current = [row, ...pendingRef.current];
          setPendingCount(pendingRef.current.length);
        } else {
          setRows((prev) => [row, ...prev].slice(0, 500));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [jobId, paused]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setPaused(el.scrollTop > 60);
  };

  const flushPending = () => {
    setRows((prev) => [...pendingRef.current, ...prev].slice(0, 500));
    pendingRef.current = [];
    setPendingCount(0);
    setPaused(false);
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const filtered = useMemo(() => {
    const allowed = FILTER_TO_EVENTS[filter];
    return rows.filter((r) => r.event && allowed.includes(r.event));
  }, [rows, filter]);

  const counts = useMemo(() => {
    const c = { discovered: 0, crawled: 0, emails: 0, people: 0 };
    for (const r of rows) {
      if (r.event === "pages_discovered") c.discovered += r.meta?.count ?? 0;
      else if (r.event === "page_crawled") c.crawled += 1;
      else if (r.event === "emails_found") c.emails += (r.meta?.person_emails ?? 0) + (r.meta?.generic_emails ?? 0);
      else if (r.event === "people_extracted") c.people += r.meta?.count ?? 0;
    }
    return c;
  }, [rows]);

  const resolverCount = useMemo(() => rows.filter((r) => r.event && RESOLVER_EVENTS.includes(r.event)).length, [rows]);

  const deferred = useMemo(() => {
    // rows are newest-first; find latest resolve_* event
    for (const r of rows) {
      if (r.event === "resolve_completed") return null;
      if (r.event === "resolve_deferred") return r;
      if (r.event === "resolve_started") return null;
    }
    return null;
  }, [rows]);

  const chips: { key: FilterKey; label: string; n?: number }[] = [
    { key: "all", label: "All", n: rows.length },
    { key: "discovered", label: "Discovered" },
    { key: "crawled", label: "Crawled", n: counts.crawled },
    { key: "emails", label: "Emails", n: counts.emails },
    { key: "people", label: "People", n: counts.people },
    { key: "resolver", label: "Resolver", n: resolverCount },
  ];

  return (
    <div className="space-y-4">
      {deferred && (() => {
        const processed = deferred.meta?.processed ?? 0;
        const remaining = deferred.meta?.remaining ?? 0;
        const total = deferred.meta?.total ?? (processed + remaining);
        const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
        return (
          <div className="rounded-md border border-warning/40 bg-warning/5 px-4 py-3">
            <div className="flex items-center gap-2 mb-2">
              <Loader2 className="h-4 w-4 text-warning animate-spin" />
              <span className="font-medium text-sm text-foreground">
                Domain resolution in progress — {remaining} compan{remaining === 1 ? "y" : "ies"} remaining
              </span>
              <span className="ml-auto text-xs text-muted-foreground">{processed}/{total} · {pct}%</span>
            </div>
            <Progress value={pct} className="h-1.5" />
            <p className="text-xs text-muted-foreground mt-2">
              Last batch processed {deferred.meta?.wave_seconds ?? 0}s ago · continuing in background…
            </p>
          </div>
        );
      })()}
      <SectionCard title="Pipeline timeline" description="Live events from the scraping pipeline" noPadding>
      <div className="px-5 py-3 border-b border-border flex flex-wrap items-center gap-2">
        {chips.map((c) => (
          <button
            key={c.key}
            onClick={() => setFilter(c.key)}
            className={cn(
              "text-xs px-2.5 py-1 rounded-full border transition-colors",
              filter === c.key
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground border-border hover:bg-muted",
            )}
          >
            {c.label}{typeof c.n === "number" ? ` · ${c.n}` : ""}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          <span><Globe className="inline h-3 w-3 mr-1" />{counts.discovered} discovered</span>
          <span><Activity className="inline h-3 w-3 mr-1" />{counts.crawled} crawled</span>
          <span><Mail className="inline h-3 w-3 mr-1" />{counts.emails} emails</span>
          <span><Users className="inline h-3 w-3 mr-1" />{counts.people} people</span>
        </div>
      </div>

      {pendingCount > 0 && (
        <div className="sticky top-0 z-10 px-5 py-2 bg-primary/10 border-b border-border flex items-center justify-center">
          <button onClick={flushPending} className="text-xs font-medium text-primary hover:underline">
            ↑ {pendingCount} new event{pendingCount === 1 ? "" : "s"} — click to show
          </button>
        </div>
      )}

      <div ref={scrollRef} onScroll={onScroll} className="divide-y divide-border max-h-[600px] overflow-auto scrollbar-thin">
        {loading ? (
          <div className="px-5 py-8 text-sm text-muted-foreground text-center">Loading timeline…</div>
        ) : filtered.length === 0 ? (
          <EmptyState description="No timeline events yet. Start the job to see the pipeline live." />
        ) : (
          filtered.map((r) => (
            <TimelineEvent key={r.id} event={r.event!} createdAt={r.createdAt} meta={r.meta} level={r.level} />
          ))
        )}
      </div>
    </SectionCard>
    </div>
  );
}
