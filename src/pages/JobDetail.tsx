import { useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Play, Pause, Square, Copy, Download, Building2, Mail, Users, Globe } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "@/store/useStore";
import { PageHeader } from "@/components/app/PageHeader";
import { SectionCard } from "@/components/app/SectionCard";
import { JobStatusBadge, ContactTypeBadge, ImportStatusBadge } from "@/components/app/StatusBadge";
import { ProgressBar } from "@/components/app/ProgressBar";
import { KpiCard } from "@/components/app/KpiCard";
import { EmptyState } from "@/components/app/EmptyState";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { exportRows } from "@/lib/exporters";
import { fmtDateTime, fmtRelative, fmtNum } from "@/lib/format";

export default function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { jobs, contacts, people, companies, logs, updateJobStatus, duplicateJob, incExports } = useStore();
  const job = jobs.find((j) => j.id === id);

  const jobContacts = useMemo(() => contacts.filter((c) => c.jobId === id), [contacts, id]);
  const jobPeople = useMemo(() => people.filter((p) => p.jobId === id), [people, id]);
  const jobCompanies = useMemo(() => companies.filter((c) => c.jobIds.includes(id ?? "")), [companies, id]);
  const jobLogs = useMemo(() => logs.filter((l) => l.jobId === id), [logs, id]);

  if (!job) {
    return (
      <div className="p-6">
        <Button variant="ghost" size="sm" onClick={() => navigate("/jobs")}><ArrowLeft className="h-4 w-4" /> Back</Button>
        <EmptyState description="Job not found." />
      </div>
    );
  }

  const handleExport = (format: "csv" | "xlsx") => {
    exportRows(jobContacts as unknown as Record<string, unknown>[], `job_${job.name.replace(/\s+/g, "_")}_contacts`, format);
    incExports();
    toast.success(`Export generated: ${format.toUpperCase()}`);
  };

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <Button variant="ghost" size="sm" className="mb-3" onClick={() => navigate("/jobs")}><ArrowLeft className="h-4 w-4" /> All jobs</Button>
      <PageHeader
        title={job.name}
        description={`${job.industry} · ${job.country}`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => { updateJobStatus(job.id, "running"); toast.success("Job started"); }}><Play className="h-4 w-4" /> Start</Button>
            <Button variant="outline" size="sm" onClick={() => { updateJobStatus(job.id, "paused"); toast.success("Job paused"); }}><Pause className="h-4 w-4" /> Pause</Button>
            <Button variant="outline" size="sm" onClick={() => { updateJobStatus(job.id, "stopped"); toast.success("Job stopped"); }}><Square className="h-4 w-4" /> Stop</Button>
            <Button variant="outline" size="sm" onClick={() => { const n = duplicateJob(job.id); if (n) { toast.success("Duplicated"); navigate(`/jobs/${n}`); } }}><Copy className="h-4 w-4" /> Duplicate</Button>
            <Button variant="outline" size="sm" onClick={() => handleExport("csv")}><Download className="h-4 w-4" /> CSV</Button>
            <Button size="sm" onClick={() => handleExport("xlsx")}><Download className="h-4 w-4" /> XLSX</Button>
          </>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <SectionCard title="Status" className="lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <JobStatusBadge status={job.status} />
            <span className="text-sm text-muted-foreground">{job.progress}% complete</span>
          </div>
          <ProgressBar value={job.progress} />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-5 text-sm">
            <div><p className="text-muted-foreground text-xs">Created</p><p className="font-medium">{fmtDateTime(job.createdAt)}</p></div>
            <div><p className="text-muted-foreground text-xs">Last run</p><p className="font-medium">{fmtRelative(job.lastRunAt)}</p></div>
            <div><p className="text-muted-foreground text-xs">Schedule</p><p className="font-medium">{job.startTime}–{job.endTime}</p></div>
            <div><p className="text-muted-foreground text-xs">Max companies</p><p className="font-medium">{fmtNum(job.maxCompanies)}</p></div>
          </div>
        </SectionCard>

        <SectionCard title="Configuration">
          <ul className="space-y-1.5 text-sm">
            <li className="flex justify-between"><span className="text-muted-foreground">Generic emails</span><span>{job.collectGenericEmails ? "Yes" : "No"}</span></li>
            <li className="flex justify-between"><span className="text-muted-foreground">Phones</span><span>{job.collectPhones ? "Yes" : "No"}</span></li>
            <li className="flex justify-between"><span className="text-muted-foreground">Contact forms</span><span>{job.collectContactForms ? "Yes" : "No"}</span></li>
            <li className="flex justify-between"><span className="text-muted-foreground">Person names</span><span>{job.collectPersonNames ? "Yes" : "No"}</span></li>
            <li className="flex justify-between"><span className="text-muted-foreground">Person roles</span><span>{job.collectPersonRoles ? "Yes" : "No"}</span></li>
            <li className="flex justify-between"><span className="text-muted-foreground">Departments</span><span>{job.collectDepartments ? "Yes" : "No"}</span></li>
            <li className="flex justify-between"><span className="text-muted-foreground">Deduplicate</span><span>{job.deduplicate ? "Yes" : "No"}</span></li>
          </ul>
        </SectionCard>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Companies" value={fmtNum(job.companiesFound)} icon={<Building2 className="h-4 w-4" />} />
        <KpiCard label="Contacts" value={fmtNum(job.contactsFound)} icon={<Mail className="h-4 w-4" />} />
        <KpiCard label="People" value={fmtNum(job.peopleFound)} icon={<Users className="h-4 w-4" />} />
        <KpiCard label="Pages crawled" value={fmtNum(job.pagesCrawled)} icon={<Globe className="h-4 w-4" />} />
      </div>

      <Tabs defaultValue="contacts">
        <TabsList>
          <TabsTrigger value="contacts">Contacts ({jobContacts.length})</TabsTrigger>
          <TabsTrigger value="people">People ({jobPeople.length})</TabsTrigger>
          <TabsTrigger value="companies">Companies ({jobCompanies.length})</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="contacts">
          <SectionCard title="Contact records" noPadding>
            <Table>
              <TableHeader><TableRow><TableHead>Company</TableHead><TableHead>Type</TableHead><TableHead>Value</TableHead><TableHead>Source</TableHead><TableHead>Found</TableHead></TableRow></TableHeader>
              <TableBody>
                {jobContacts.slice(0, 50).map((c) => (
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
          </SectionCard>
        </TabsContent>

        <TabsContent value="people">
          <SectionCard title="People records" noPadding>
            <Table>
              <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Role</TableHead><TableHead>Department</TableHead><TableHead>Company</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {jobPeople.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.fullName}</TableCell>
                    <TableCell>{p.roleTitle}</TableCell>
                    <TableCell className="text-muted-foreground">{p.department}</TableCell>
                    <TableCell>{p.companyName}</TableCell>
                    <TableCell><ImportStatusBadge status={p.importStatus} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </SectionCard>
        </TabsContent>

        <TabsContent value="companies">
          <SectionCard title="Companies" noPadding>
            <Table>
              <TableHeader><TableRow><TableHead>Company</TableHead><TableHead>Domain</TableHead><TableHead>Country</TableHead><TableHead>Industry</TableHead><TableHead className="text-right">Pages crawled</TableHead></TableRow></TableHeader>
              <TableBody>
                {jobCompanies.map((c) => (
                  <TableRow key={c.id} className="cursor-pointer" onClick={() => navigate(`/companies/${c.id}`)}>
                    <TableCell className="font-medium"><Link to={`/companies/${c.id}`}>{c.name}</Link></TableCell>
                    <TableCell className="font-mono text-xs">{c.domain}</TableCell>
                    <TableCell>{c.country}</TableCell>
                    <TableCell>{c.industry}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.pagesCrawled}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </SectionCard>
        </TabsContent>

        <TabsContent value="logs">
          <SectionCard title="Activity log" noPadding>
            <div className="divide-y divide-border max-h-[500px] overflow-auto scrollbar-thin font-mono text-xs">
              {jobLogs.length === 0 && <EmptyState description="No log entries yet." />}
              {jobLogs.map((l) => (
                <div key={l.id} className="px-5 py-2 flex items-start gap-3">
                  <span className={
                    l.level === "error" ? "text-destructive" :
                    l.level === "warn" ? "text-warning" :
                    l.level === "success" ? "text-success" : "text-muted-foreground"
                  }>[{l.level}]</span>
                  <span className="text-muted-foreground">{fmtRelative(l.timestamp)}</span>
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
