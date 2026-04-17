import { useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, Globe, Building2 } from "lucide-react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/app/PageHeader";
import { SectionCard } from "@/components/app/SectionCard";
import { EmptyState } from "@/components/app/EmptyState";
import { ContactTypeBadge, JobStatusBadge } from "@/components/app/StatusBadge";
import { KpiCard } from "@/components/app/KpiCard";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, fmtRelative, fmtNum } from "@/lib/format";

export default function CompanyDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const company = useQuery({ queryKey: ["company", id], queryFn: () => api.getCompany(id) });
  const contacts = useQuery({ queryKey: ["contacts"], queryFn: () => api.listContacts() });
  const people = useQuery({ queryKey: ["people"], queryFn: () => api.listPeople() });
  const jobs = useQuery({ queryKey: ["jobs"], queryFn: () => api.listJobs() });
  const sourcePages = useQuery({ queryKey: ["sourcePages", id, "company"], queryFn: () => api.listSourcePages({ companyId: id }) });

  const c = company.data;
  const relContacts = useMemo(() => (contacts.data ?? []).filter((x) => x.companyId === id), [contacts.data, id]);
  const relPeople = useMemo(() => (people.data ?? []).filter((x) => x.companyId === id), [people.data, id]);
  const jobIds = new Set([...relContacts, ...relPeople].map((r) => r.jobId).filter(Boolean) as string[]);
  const relJobs = (jobs.data ?? []).filter((j) => jobIds.has(j.id));

  if (company.isLoading) return <div className="p-6">Loading…</div>;
  if (!c) return (
    <div className="p-6">
      <Button variant="ghost" size="sm" onClick={() => navigate("/companies")}><ArrowLeft className="h-4 w-4" /> Back</Button>
      <EmptyState description="Company not found." />
    </div>
  );

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <Button variant="ghost" size="sm" className="mb-3" onClick={() => navigate("/companies")}><ArrowLeft className="h-4 w-4" /> All companies</Button>
      <PageHeader
        title={c.name}
        description={`${c.industry ?? "—"} · ${c.country ?? "—"}`}
        actions={c.website ? (
          <Button variant="outline" size="sm" asChild><a href={c.website} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" /> Visit website</a></Button>
        ) : undefined}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <SectionCard title="Profile" className="lg:col-span-2">
          <dl className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div><dt className="text-muted-foreground text-xs">Website</dt><dd className="text-primary truncate">{c.website ?? "—"}</dd></div>
            <div><dt className="text-muted-foreground text-xs">Domain</dt><dd className="font-mono text-xs">{c.domain ?? "—"}</dd></div>
            <div><dt className="text-muted-foreground text-xs">Country</dt><dd>{c.country ?? "—"}</dd></div>
            <div><dt className="text-muted-foreground text-xs">Industry</dt><dd>{c.industry ?? "—"}</dd></div>
            <div><dt className="text-muted-foreground text-xs">Source URL</dt><dd className="text-muted-foreground text-xs truncate">{c.sourceUrl ?? "—"}</dd></div>
            <div><dt className="text-muted-foreground text-xs">Created</dt><dd>{fmtDate(c.createdAt)}</dd></div>
            <div><dt className="text-muted-foreground text-xs">Last updated</dt><dd>{fmtRelative(c.updatedAt)}</dd></div>
            <div><dt className="text-muted-foreground text-xs">Pages crawled</dt><dd>{(sourcePages.data ?? []).length}</dd></div>
          </dl>
          {c.notes && <p className="mt-4 text-sm text-muted-foreground">{c.notes}</p>}
        </SectionCard>
        <div className="grid grid-cols-2 gap-4">
          <KpiCard label="Contacts" value={fmtNum(relContacts.length)} icon={<Building2 className="h-4 w-4" />} />
          <KpiCard label="People" value={fmtNum(relPeople.length)} icon={<Globe className="h-4 w-4" />} />
        </div>
      </div>

      <Tabs defaultValue="contacts">
        <TabsList>
          <TabsTrigger value="contacts">Contacts ({relContacts.length})</TabsTrigger>
          <TabsTrigger value="people">People ({relPeople.length})</TabsTrigger>
          <TabsTrigger value="jobs">Jobs ({relJobs.length})</TabsTrigger>
          <TabsTrigger value="pages">Source pages ({(sourcePages.data ?? []).length})</TabsTrigger>
        </TabsList>

        <TabsContent value="contacts">
          <SectionCard title="Contact records" noPadding>
            {relContacts.length === 0 ? <EmptyState description="No contacts for this company yet." /> : (
              <Table>
                <TableHeader><TableRow><TableHead>Type</TableHead><TableHead>Value</TableHead><TableHead>Source</TableHead><TableHead>Found</TableHead></TableRow></TableHeader>
                <TableBody>
                  {relContacts.map((x) => (
                    <TableRow key={x.id}>
                      <TableCell><ContactTypeBadge type={x.contactType} /></TableCell>
                      <TableCell className="font-mono text-xs">{x.contactValue}</TableCell>
                      <TableCell className="text-muted-foreground text-xs truncate max-w-[260px]">{x.sourceUrl}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{fmtRelative(x.foundAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionCard>
        </TabsContent>

        <TabsContent value="people">
          <SectionCard title="People records" noPadding>
            {relPeople.length === 0 ? <EmptyState description="No people for this company yet." /> : (
              <Table>
                <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Role</TableHead><TableHead>Department</TableHead><TableHead>Source</TableHead></TableRow></TableHeader>
                <TableBody>
                  {relPeople.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.fullName}</TableCell>
                      <TableCell>{p.roleTitle ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{p.department ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground text-xs truncate max-w-[260px]">{p.sourceUrl}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionCard>
        </TabsContent>

        <TabsContent value="jobs">
          <SectionCard title="Related jobs" noPadding>
            {relJobs.length === 0 ? <EmptyState description="No related jobs." /> : (
              <Table>
                <TableHeader><TableRow><TableHead>Job</TableHead><TableHead>Status</TableHead><TableHead>Last run</TableHead></TableRow></TableHeader>
                <TableBody>
                  {relJobs.map((j) => (
                    <TableRow key={j.id} className="cursor-pointer" onClick={() => navigate(`/jobs/${j.id}`)}>
                      <TableCell className="font-medium"><Link to={`/jobs/${j.id}`}>{j.name}</Link></TableCell>
                      <TableCell><JobStatusBadge status={j.status} /></TableCell>
                      <TableCell className="text-muted-foreground text-sm">{fmtRelative(j.lastRunAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionCard>
        </TabsContent>

        <TabsContent value="pages">
          <SectionCard title="Source pages crawled" noPadding>
            {(sourcePages.data ?? []).length === 0 ? <EmptyState description="No pages crawled for this company yet." /> : (
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
      </Tabs>
    </div>
  );
}
