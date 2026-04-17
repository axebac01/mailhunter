import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Play, Pause, Square, Copy, Building2, Mail, Users, Globe } from "lucide-react";
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
import { fmtDateTime, fmtRelative, fmtNum } from "@/lib/format";

export default function JobDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const job = useQuery({ queryKey: ["job", id], queryFn: () => api.getJob(id), refetchInterval: 2500 });
  const allContacts = useQuery({ queryKey: ["contacts"], queryFn: () => api.listContacts(), refetchInterval: 2500 });
  const allPeople = useQuery({ queryKey: ["people"], queryFn: () => api.listPeople(), refetchInterval: 2500 });
  const logs = useQuery({ queryKey: ["logs", id], queryFn: () => api.listLogs(id), refetchInterval: 2500 });
  const sourcePages = useQuery({ queryKey: ["sourcePages", id], queryFn: () => api.listSourcePages({ jobId: id }), refetchInterval: 5000 });

  const jobContacts = useMemo(() => (allContacts.data ?? []).filter((c) => c.jobId === id), [allContacts.data, id]);
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
            <Button variant="outline" size="sm" onClick={() => updateStatus.mutate("running")}><Play className="h-4 w-4" /> Start</Button>
            <Button variant="outline" size="sm" onClick={() => updateStatus.mutate("paused")}><Pause className="h-4 w-4" /> Pause</Button>
            <Button variant="outline" size="sm" onClick={() => updateStatus.mutate("stopped")}><Square className="h-4 w-4" /> Stop</Button>
            <Button variant="outline" size="sm" onClick={() => dup.mutate()}><Copy className="h-4 w-4" /> Duplicate</Button>
            <ExportButton onExport={handleExport} disableSelected />
          </>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <SectionCard title="Status" className="lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <JobStatusBadge status={j.status} />
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Companies" value={fmtNum(j.companiesFound)} icon={<Building2 className="h-4 w-4" />} />
        <KpiCard label="Contacts" value={fmtNum(j.contactsFound)} icon={<Mail className="h-4 w-4" />} />
        <KpiCard label="People" value={fmtNum(j.peopleFound)} icon={<Users className="h-4 w-4" />} />
        <KpiCard label="Pages crawled" value={fmtNum(j.pagesCrawled)} icon={<Globe className="h-4 w-4" />} />
      </div>

      <Tabs defaultValue="contacts">
        <TabsList>
          <TabsTrigger value="contacts">Contacts ({jobContacts.length})</TabsTrigger>
          <TabsTrigger value="people">People ({jobPeople.length})</TabsTrigger>
          <TabsTrigger value="pages">Source pages ({(sourcePages.data ?? []).length})</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="contacts">
          <SectionCard title="Contact records" noPadding>
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
