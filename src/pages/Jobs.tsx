import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ProgressBar } from "@/components/app/ProgressBar";
import { Plus, Search, Play, Pause, Square, Copy, Trash2, Eye, MoreHorizontal, Briefcase } from "lucide-react";
import { toast } from "sonner";
import { api, type JobStatus } from "@/lib/api";
import { exportJobsZip, type ExportFormat, type JobExportDataset } from "@/lib/exporters";
import { JobExportMenu } from "@/components/app/JobExportMenu";
import { startSimulator, stopSimulator } from "@/lib/jobSimulator";
import { PageHeader } from "@/components/app/PageHeader";
import { JobStatusBadge } from "@/components/app/StatusBadge";
import { EmptyState } from "@/components/app/EmptyState";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { fmtDate, fmtRelative, fmtNum } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";

const STATUSES: JobStatus[] = ["draft","scheduled","running","paused","completed","failed","stopped"];

export default function Jobs() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: jobs = [], isLoading } = useQuery({ queryKey: ["jobs"], queryFn: () => api.listJobs() });
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [country, setCountry] = useState<string>("all");
  const [industry, setIndustry] = useState<string>("all");
  const [createdFrom, setCreatedFrom] = useState("");
  const [lastRunFrom, setLastRunFrom] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const channel = supabase
      .channel("crawl_jobs_progress")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "crawl_jobs" }, () => {
        qc.invalidateQueries({ queryKey: ["jobs"] });
        qc.invalidateQueries({ queryKey: ["kpis"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc]);

  const countries = useMemo(() => Array.from(new Set(jobs.map((j) => j.country).filter(Boolean) as string[])).sort(), [jobs]);
  const industries = useMemo(() => Array.from(new Set(jobs.map((j) => j.industry).filter(Boolean) as string[])).sort(), [jobs]);

  const filtered = jobs.filter((j) =>
    (status === "all" || j.status === status) &&
    (country === "all" || j.country === country) &&
    (industry === "all" || j.industry === industry) &&
    (search === "" || j.name.toLowerCase().includes(search.toLowerCase())) &&
    (!createdFrom || j.createdAt >= createdFrom) &&
    (!lastRunFrom || (j.lastRunAt && j.lastRunAt >= lastRunFrom))
  );

  const updateStatus = useMutation({
    mutationFn: ({ id, s }: { id: string; s: JobStatus }) => api.updateJobStatus(id, s),
    onSuccess: (_d, v) => {
      if (v.s === "running") startSimulator(v.id);
      else stopSimulator(v.id);
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["kpis"] });
    },
  });

  const dup = useMutation({
    mutationFn: (id: string) => api.duplicateJob(id),
    onSuccess: (j) => { qc.invalidateQueries({ queryKey: ["jobs"] }); toast.success("Job duplicated"); navigate(`/jobs/${j.id}`); },
  });

  const del = useMutation({
    mutationFn: (id: string) => api.deleteJob(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["jobs"] }); qc.invalidateQueries({ queryKey: ["kpis"] }); toast.success("Job deleted"); },
  });

  const clearFilters = () => { setStatus("all"); setCountry("all"); setIndustry("all"); setSearch(""); setCreatedFrom(""); setLastRunFrom(""); };

  const toggleSelected = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  };

  const allFilteredSelected = filtered.length > 0 && filtered.every((j) => selected.has(j.id));
  const someFilteredSelected = filtered.some((j) => selected.has(j.id));

  const toggleSelectAllFiltered = (checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) filtered.forEach((j) => next.add(j.id));
      else filtered.forEach((j) => next.delete(j.id));
      return next;
    });
  };

  const handleBulkExport = async (dataset: JobExportDataset, format: ExportFormat) => {
    const chosen = jobs.filter((j) => selected.has(j.id));
    if (chosen.length === 0 || exporting) return;
    setExporting(true);
    const toastId = "jobs-bulk-export";
    try {
      toast.loading(`Exporting job 1 of ${chosen.length}…`, { id: toastId });
      const { zipName, totalRows } = await exportJobsZip(chosen, format, dataset, (done, total) => {
        if (done < total) toast.loading(`Exporting job ${done + 1} of ${total}…`, { id: toastId });
      });
      toast.success(`Exported ${chosen.length} job${chosen.length === 1 ? "" : "s"} (${fmtNum(totalRows)} rows) to ${zipName}`, { id: toastId });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed", { id: toastId });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <PageHeader
        title="Jobs"
        description="Manage research jobs that discover public company contact data."
        actions={<Button asChild size="sm"><Link to="/jobs/new"><Plus className="h-4 w-4" /> Create job</Link></Button>}
      />

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search by job name..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={country} onValueChange={setCountry}>
            <SelectTrigger className="w-[170px]"><SelectValue placeholder="Country" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All countries</SelectItem>
              {countries.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={industry} onValueChange={setIndustry}>
            <SelectTrigger className="w-[170px]"><SelectValue placeholder="Industry" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All industries</SelectItem>
              {industries.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <div>
            <Input type="date" className="w-[160px]" value={createdFrom.slice(0,10)} onChange={(e) => setCreatedFrom(e.target.value ? e.target.value + "T00:00:00.000Z" : "")} placeholder="Created from" />
          </div>
          <div>
            <Input type="date" className="w-[160px]" value={lastRunFrom.slice(0,10)} onChange={(e) => setLastRunFrom(e.target.value ? e.target.value + "T00:00:00.000Z" : "")} placeholder="Last run from" />
          </div>
          {(status !== "all" || country !== "all" || industry !== "all" || search || createdFrom || lastRunFrom) && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>Clear filters</Button>
          )}
          {selected.size > 0 && (
            <JobExportMenu
              disabled={exporting}
              label={`Export selected (${selected.size})`}
              onExport={handleBulkExport}
            />
          )}
        </div>
      </Card>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Briefcase className="h-5 w-5" />}
            title="No jobs"
            description="No jobs yet. Create your first research job to begin discovering public company contacts."
            action={<Button asChild><Link to="/jobs/new"><Plus className="h-4 w-4" /> Create job</Link></Button>}
          />
        ) : (
          <div className="max-h-[calc(100vh-360px)] overflow-auto scrollbar-thin">
            <Table>
              <TableHeader className="sticky top-0 bg-card z-10">
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allFilteredSelected ? true : someFilteredSelected ? "indeterminate" : false}
                      onCheckedChange={(c) => toggleSelectAllFiltered(c === true)}
                      aria-label="Select all filtered jobs"
                    />
                  </TableHead>
                  <TableHead>Job name</TableHead><TableHead>Industry</TableHead><TableHead>Country</TableHead>
                  <TableHead>Status</TableHead><TableHead>Created</TableHead><TableHead>Last run</TableHead>
                  <TableHead>Schedule</TableHead>
                  <TableHead className="min-w-[240px]">Progress</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((j) => {
                  const isActive = j.status === "running" || j.status === "scheduled" || j.status === "paused";
                  return (
                  <TableRow key={j.id} className="cursor-pointer" data-state={selected.has(j.id) ? "selected" : undefined} onClick={() => navigate(`/jobs/${j.id}`)}>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selected.has(j.id)}
                        onCheckedChange={(c) => toggleSelected(j.id, c === true)}
                        aria-label={`Select ${j.name}`}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{j.name}</TableCell>
                    <TableCell className="text-muted-foreground">{j.industry ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{j.country ?? "—"}</TableCell>
                    <TableCell><JobStatusBadge status={j.status} /></TableCell>
                    <TableCell className="text-muted-foreground text-sm">{fmtDate(j.createdAt)}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{fmtRelative(j.lastRunAt)}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{j.startTime}–{j.endTime}</TableCell>
                    <TableCell className="min-w-[240px]">
                      {isActive ? (
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2">
                            <ProgressBar value={j.progress} className="flex-1" />
                            <span className="text-xs tabular-nums text-muted-foreground w-9 text-right">{Math.round(j.progress)}%</span>
                          </div>
                          <div className="text-xs text-muted-foreground tabular-nums">
                            {fmtNum(j.companiesFound)}/{fmtNum(j.maxCompanies)} companies · {fmtNum(j.contactsFound)} contacts · {fmtNum(j.pagesCrawled)} pages
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm text-muted-foreground tabular-nums">
                          {fmtNum(j.companiesFound)} companies · {fmtNum(j.contactsFound)} contacts · {fmtNum(j.pagesCrawled)} pages
                        </div>
                      )}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => navigate(`/jobs/${j.id}`)}><Eye className="h-4 w-4" /> View</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => updateStatus.mutate({ id: j.id, s: "running" })}><Play className="h-4 w-4" /> Start</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => updateStatus.mutate({ id: j.id, s: "paused" })}><Pause className="h-4 w-4" /> Pause</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => updateStatus.mutate({ id: j.id, s: "stopped" })}><Square className="h-4 w-4" /> Stop</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => dup.mutate(j.id)}><Copy className="h-4 w-4" /> Duplicate</DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive" onClick={() => setConfirmDelete(j.id)}><Trash2 className="h-4 w-4" /> Delete</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );})}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete job?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone. The job and its run history will be removed.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (confirmDelete) { del.mutate(confirmDelete); setConfirmDelete(null); } }}
            >Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
