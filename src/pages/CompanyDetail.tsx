import { useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ExternalLink, Globe, Building2 } from "lucide-react";
import { useStore } from "@/store/useStore";
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
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { companies, contacts, people, jobs } = useStore();
  const company = companies.find((c) => c.id === id);
  const relContacts = useMemo(() => contacts.filter((c) => c.companyId === id), [contacts, id]);
  const relPeople = useMemo(() => people.filter((p) => p.companyId === id), [people, id]);
  const relJobs = useMemo(() => jobs.filter((j) => company?.jobIds.includes(j.id)), [jobs, company]);

  if (!company) {
    return (
      <div className="p-6">
        <Button variant="ghost" size="sm" onClick={() => navigate("/companies")}><ArrowLeft className="h-4 w-4" /> Back</Button>
        <EmptyState description="Company not found." />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <Button variant="ghost" size="sm" className="mb-3" onClick={() => navigate("/companies")}><ArrowLeft className="h-4 w-4" /> All companies</Button>
      <PageHeader
        title={company.name}
        description={`${company.industry} · ${company.country}`}
        actions={
          <Button variant="outline" size="sm" asChild><a href={company.website} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" /> Visit website</a></Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <SectionCard title="Profile" className="lg:col-span-2">
          <dl className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div><dt className="text-muted-foreground text-xs">Website</dt><dd className="text-primary truncate">{company.website}</dd></div>
            <div><dt className="text-muted-foreground text-xs">Domain</dt><dd className="font-mono text-xs">{company.domain}</dd></div>
            <div><dt className="text-muted-foreground text-xs">Country</dt><dd>{company.country}</dd></div>
            <div><dt className="text-muted-foreground text-xs">Industry</dt><dd>{company.industry}</dd></div>
            <div><dt className="text-muted-foreground text-xs">Source URL</dt><dd className="text-muted-foreground text-xs truncate">{company.sourceUrl}</dd></div>
            <div><dt className="text-muted-foreground text-xs">Created</dt><dd>{fmtDate(company.createdAt)}</dd></div>
            <div><dt className="text-muted-foreground text-xs">Last updated</dt><dd>{fmtRelative(company.updatedAt)}</dd></div>
            <div><dt className="text-muted-foreground text-xs">Pages crawled</dt><dd>{company.pagesCrawled}</dd></div>
          </dl>
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
          <TabsTrigger value="pages">Source pages</TabsTrigger>
        </TabsList>

        <TabsContent value="contacts">
          <SectionCard title="Contact records" noPadding>
            {relContacts.length === 0 ? <EmptyState description="No contacts for this company yet." /> : (
              <Table>
                <TableHeader><TableRow><TableHead>Type</TableHead><TableHead>Value</TableHead><TableHead>Source</TableHead><TableHead>Found</TableHead></TableRow></TableHeader>
                <TableBody>
                  {relContacts.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell><ContactTypeBadge type={c.contactType} /></TableCell>
                      <TableCell className="font-mono text-xs">{c.contactValue}</TableCell>
                      <TableCell className="text-muted-foreground text-xs truncate max-w-[260px]">{c.sourceUrl}</TableCell>
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
            {relPeople.length === 0 ? <EmptyState description="No people for this company yet." /> : (
              <Table>
                <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Role</TableHead><TableHead>Department</TableHead><TableHead>Source</TableHead></TableRow></TableHeader>
                <TableBody>
                  {relPeople.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.fullName}</TableCell>
                      <TableCell>{p.roleTitle}</TableCell>
                      <TableCell className="text-muted-foreground">{p.department}</TableCell>
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
          <SectionCard title="Source pages crawled">
            <ul className="space-y-2 text-sm font-mono text-muted-foreground">
              {Array.from({ length: Math.min(8, company.pagesCrawled) }).map((_, i) => (
                <li key={i} className="flex items-center gap-2"><Globe className="h-3.5 w-3.5" /> {company.website}/{["", "about", "contact", "team", "imprint", "press", "careers", "support"][i]}</li>
              ))}
            </ul>
          </SectionCard>
        </TabsContent>
      </Tabs>
    </div>
  );
}
