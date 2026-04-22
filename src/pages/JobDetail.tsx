import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Play, Pause, Square, Copy, Building2, Mail, Users, Globe, Trash2, Search, Activity, Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { api, type JobStatus, type JobMetaJson } from "@/lib/api";
import { startSimulator, stopSimulator } from "@/lib/jobSimulator";
import { exportJobResults } from "@/lib/exporters";
import { PageHeader } from "@/components/app/PageHeader";
import { SectionCard } from "@/components/app/SectionCard";
import { JobStatusBadge } from "@/components/app/StatusBadge";
import { ProgressBar } from "@/components/app/ProgressBar";
import { KpiCard } from "@/components/app/KpiCard";
import { EmptyState } from "@/components/app/EmptyState";
import { ExportButton } from "@/components/app/ExportButton";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { fmtDateTime, fmtRelative, fmtNum } from "@/lib/format";
import { TimelineEvent, type TimelineEventType } from "@/components/app/TimelineEvent";
import { supabase } from "@/integrations/supabase/client";
import { usePendingAction, estimateWaveMsFromLogs } from "@/hooks/usePendingAction";
import { PendingActionPill, PendingActionBanner } from "@/components/jobDetail/PendingActionBanner";
import { JobStatusBanners } from "@/components/jobDetail/JobStatusBanners";
import { JobLogsPanel } from "@/components/jobDetail/JobLogsPanel";
import { JobContactsTab } from "@/components/jobDetail/JobContactsTab";
import { JobPeopleTab } from "@/components/jobDetail/JobPeopleTab";
import { JobSourcePagesTab } from "@/components/jobDetail/JobSourcePagesTab";
import { DomainStatsError } from "@/components/jobDetail/DomainStatsError";
import { useRef } from "react";
import { cn } from "@/lib/utils";

interface DomainStats { total: number; resolved: number; unresolved: number; failed: number }
interface DomainStatsResult { stats: DomainStats | null; companyIdCount: number }

export default function JobDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const job = useQuery({ queryKey: ["job", id], queryFn: () => api.getJob(id), refetchInterval: 2500 });
  const allJobs = useQuery({ queryKey: ["jobs"], queryFn: () => api.listJobs() });
  const logs = useQuery({ queryKey: ["logs", id], queryFn: () => api.listLogs(id), refetchInterval: 2500 });
  const sourcePages = useQuery({ queryKey: ["sourcePages", id], queryFn: () => api.listSourcePages({ jobId: id }), refetchInterval: 5000 });

  const { pendingAction, setPendingAction } = usePendingAction(id);

  const [contactsFilter, setContactsFilter] = useState<string>(id);
  useEffect(() => { setContactsFilter(id); }, [id]);

  // Server-side scoped queries
  const jobContactsQuery = useQuery({
    queryKey: ["contacts", { jobId: contactsFilter === "all" ? null : contactsFilter }],
    queryFn: () => api.listContacts(contactsFilter === "all" ? {} : { jobId: contactsFilter }),
    refetchInterval: 2500,
  });
  const jobPeopleQuery = useQuery({
    queryKey: ["people", { jobId: id }],
    queryFn: () => api.listPeople({ jobId: id }),
    refetchInterval: 2500,
  });

  const jobContacts = jobContactsQuery.data ?? [];
  const jobPeople = jobPeopleQuery.data ?? [];

  const domainStats = useQuery<DomainStatsResult>({
    queryKey: ["domainStats", id],
    queryFn: async () => {
      const { data: imports, error: impErr } = await supabase.from("imports").select("id").eq("crawl_job_id", id);
      if (impErr) {
        console.error("[domainStats] imports lookup failed", { jobId: id, error: impErr });
        throw impErr;
      }
      const importIds = (imports ?? []).map((i) => i.id);
      if (importIds.length === 0) return { stats: null, companyIdCount: 0 };
      const { data: rows, error: rowsErr } = await supabase.from("import_rows").select("matched_company_id").in("import_id", importIds).not("matched_company_id", "is", null);
      if (rowsErr) {
        console.error("[domainStats] import_rows lookup failed", { jobId: id, error: rowsErr });
        throw rowsErr;
      }
      const companyIds = Array.from(new Set((rows ?? []).map((r) => r.matched_company_id).filter(Boolean) as string[]));
      const companyIdCount = companyIds.length;
      if (companyIdCount === 0) return { stats: { total: 0, resolved: 0, unresolved: 0, failed: 0 }, companyIdCount: 0 };
      const { data: companies, error: compErr } = await supabase.from("companies").select("id, domain, domain_status").in("id", companyIds);
      if (compErr) {
        console.error("[domainStats] query failed", { jobId: id, companyIdCount, error: compErr });
        throw compErr;
      }
      const list = companies ?? [];
      if (list.length < companyIdCount) {
        console.warn("[domainStats] partial response", { jobId: id, requested: companyIdCount, received: list.length });
      }
      return {
        stats: {
          total: list.length,
          resolved: list.filter((c) => c.domain).length,
          unresolved: list.filter((c) => !c.domain && (c.domain_status === "unresolved" || !c.domain_status)).length,
          failed: list.filter((c) => !c.domain && c.domain_status === "failed").length,
        },
        companyIdCount,
      };
    },
    refetchInterval: 5000,
    enabled: !!id,
    retry: false,
  });
  const domainStatsData = domainStats.data?.stats ?? null;
  const domainStatsCompanyIdCount = domainStats.data?.companyIdCount ?? 0;

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
    onError: (e: Error) => toast.error(e?.message ?? "Failed to clear"),
  });

  interface ResolveResult { resolved: number; failed: number; total: number; paymentRequired?: boolean }
  const resolveDomains = useMutation({
    mutationFn: async (vars?: { retryFailed?: boolean; reresolveAll?: boolean }) => {
      const { data, error } = await supabase.functions.invoke("resolve-domains-batch", {
        body: { jobId: id, retryFailed: vars?.retryFailed ?? false, reresolveAll: vars?.reresolveAll ?? false },
      });
      if (error) throw error;
      return data as ResolveResult;
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
    onError: (e: Error) => toast.error(e?.message ?? "Resolve domains failed"),
  });

  const resumeScraping = useMutation({
    mutationFn: async () => {
      const currentMeta = (job.data?.metaJson ?? {}) as JobMetaJson;
      const { paused_reason: _r, paused_at: _a, ...rest } = currentMeta;
      await api.patchJob(id, { status: "running", meta_json: rest as never });
      const { data, error } = await supabase.functions.invoke("scrape-emails-batch", { body: { jobId: id } });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Resumed scraping");
      qc.invalidateQueries({ queryKey: ["job", id] });
      qc.invalidateQueries({ queryKey: ["logs", id] });
    },
    onError: (e: Error) => toast.error(e?.message ?? "Resume failed"),
  });

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

  const personEmailCount = jobContacts.filter((c) => c.contactType === "person_email").length;

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <Button variant="ghost" size="sm" className="mb-3" onClick={() => navigate("/jobs")}><ArrowLeft className="h-4 w-4" /> All jobs</Button>
      <PageHeader
        title={j.name}
        description={`${j.industry ?? "—"} · ${j.country ?? "—"}`}
        actions={
          <>
            <Button variant="outline" size="sm" disabled={j.status === "running" || resumeScraping.isPending || !!pendingAction} onClick={() => {
              if (j.status === "paused" || j.status === "stopped") resumeScraping.mutate();
              else updateStatus.mutate("running");
            }}><Play className="h-4 w-4" /> Start</Button>
            <Button variant="outline" size="sm" disabled={j.status !== "running" || !!pendingAction} onClick={() => {
              setPendingAction({ kind: "pausing", startedAt: Date.now(), estimatedWaveMs: estimateWaveMsFromLogs(logs.data) });
              updateStatus.mutate("paused");
              toast("Pausing scraper — current batch will finish within ~45s");
            }}><Pause className="h-4 w-4" /> Pause</Button>
            <Button variant="outline" size="sm" disabled={j.status === "stopped" || !!pendingAction} onClick={() => {
              setPendingAction({ kind: "stopping", startedAt: Date.now(), estimatedWaveMs: estimateWaveMsFromLogs(logs.data) });
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
                  <AlertDialogAction onClick={() => clearContacts.mutate()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
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
              {pendingAction && <PendingActionPill pendingAction={pendingAction} />}
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
        <KpiCard label="Person emails" value={fmtNum(personEmailCount)} icon={<Mail className="h-4 w-4" />} />
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

      {pendingAction
        ? <PendingActionBanner pendingAction={pendingAction} />
        : <JobStatusBanners job={j} domainStats={domainStats.data} resumePending={resumeScraping.isPending} onResume={() => resumeScraping.mutate()} />}

      <Tabs defaultValue="timeline">
        <TabsList>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="contacts">Contacts ({jobContacts.length})</TabsTrigger>
          <TabsTrigger value="people">People ({jobPeople.length})</TabsTrigger>
          <TabsTrigger value="pages">Source pages ({(sourcePages.data ?? []).length})</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="timeline"><JobTimeline jobId={id} /></TabsContent>
        <TabsContent value="contacts">
          <JobContactsTab jobId={id} contacts={jobContacts} allJobs={allJobs.data ?? []} filter={contactsFilter} onFilterChange={setContactsFilter} />
        </TabsContent>
        <TabsContent value="people"><JobPeopleTab people={jobPeople} /></TabsContent>
        <TabsContent value="pages"><JobSourcePagesTab pages={sourcePages.data ?? []} /></TabsContent>
        <TabsContent value="logs"><JobLogsPanel logs={logs.data ?? []} /></TabsContent>
      </Tabs>
    </div>
  );
}

// ---------- Timeline (kept inline; tightly coupled to realtime channel) ----------
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
  meta: Record<string, unknown>;
  event: TimelineEventType | null;
}

function rowFromDb(r: { id: string; level: string; message: string; created_at: string; meta_json: Record<string, unknown> | null }): TimelineRow {
  const ev = (r.meta_json as { event?: string } | null)?.event;
  return {
    id: r.id,
    level: r.level,
    message: r.message,
    createdAt: r.created_at,
    meta: (r.meta_json ?? {}) as Record<string, unknown>,
    event: TIMELINE_EVENT_TYPES.includes(ev as TimelineEventType) ? (ev as TimelineEventType) : null,
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
      setRows((data ?? []).map((r) => rowFromDb(r as never)).filter((r) => r.event !== null));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [jobId]);

  useEffect(() => {
    const channel = supabase
      .channel(`timeline-${jobId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "crawl_logs", filter: `crawl_job_id=eq.${jobId}` }, (payload) => {
        const row = rowFromDb(payload.new as never);
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
      const m = r.meta as { count?: number; person_emails?: number; generic_emails?: number };
      if (r.event === "pages_discovered") c.discovered += m.count ?? 0;
      else if (r.event === "page_crawled") c.crawled += 1;
      else if (r.event === "emails_found") c.emails += (m.person_emails ?? 0) + (m.generic_emails ?? 0);
      else if (r.event === "people_extracted") c.people += m.count ?? 0;
    }
    return c;
  }, [rows]);

  const resolverCount = useMemo(() => rows.filter((r) => r.event && RESOLVER_EVENTS.includes(r.event)).length, [rows]);

  const deferred = useMemo(() => {
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
        const m = deferred.meta as { processed?: number; remaining?: number; total?: number; wave_seconds?: number };
        const processed = m.processed ?? 0;
        const remaining = m.remaining ?? 0;
        const total = m.total ?? (processed + remaining);
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
              Last batch processed {m.wave_seconds ?? 0}s ago · continuing in background…
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
