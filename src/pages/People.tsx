import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Users } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { exportPeople } from "@/lib/exporters";
import { PageHeader } from "@/components/app/PageHeader";
import { EmptyState } from "@/components/app/EmptyState";
import { ExportButton } from "@/components/app/ExportButton";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtRelative } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";

const PAGE_SIZE = 25;

export default function People() {
  const qc = useQueryClient();
  const { data: people = [], isLoading } = useQuery({ queryKey: ["people"], queryFn: () => api.listPeople() });
  const { data: jobs = [] } = useQuery({ queryKey: ["jobs"], queryFn: () => api.listJobs() });
  const { data: imports = [] } = useQuery({ queryKey: ["imports"], queryFn: () => api.listImports() });

  const [search, setSearch] = useState("");
  const [company, setCompany] = useState<string>("all");
  const [role, setRole] = useState<string>("all");
  const [department, setDepartment] = useState<string>("all");
  const [country, setCountry] = useState<string>("all");
  const [industry, setIndustry] = useState<string>("all");
  const [jobId, setJobId] = useState<string>("all");
  const [importId, setImportId] = useState<string>("all");
  const [from, setFrom] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const companies = useMemo(() => Array.from(new Set(people.map((p) => p.companyName))).sort(), [people]);
  const roles = useMemo(() => Array.from(new Set(people.map((p) => p.roleTitle).filter(Boolean) as string[])).sort(), [people]);
  const departments = useMemo(() => Array.from(new Set(people.map((p) => p.department).filter(Boolean) as string[])).sort(), [people]);
  const countries = useMemo(() => Array.from(new Set(people.map((p) => p.country).filter(Boolean) as string[])).sort(), [people]);
  const industries = useMemo(() => Array.from(new Set(people.map((p) => p.industry).filter(Boolean) as string[])).sort(), [people]);

  const filtered = useMemo(() => people.filter((p) =>
    (company === "all" || p.companyName === company) &&
    (role === "all" || p.roleTitle === role) &&
    (department === "all" || p.department === department) &&
    (country === "all" || p.country === country) &&
    (industry === "all" || p.industry === industry) &&
    (jobId === "all" || p.jobId === jobId) &&
    (importId === "all" || p.importId === importId) &&
    (!from || p.foundAt >= from) &&
    (search === "" || p.fullName.toLowerCase().includes(search.toLowerCase()) || p.companyName.toLowerCase().includes(search.toLowerCase()))
  ), [people, company, role, department, country, industry, jobId, importId, from, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleExport = async (scope: "all"|"filtered"|"selected", format: "csv"|"xlsx") => {
    let rows = people;
    if (scope === "filtered") rows = filtered;
    else if (scope === "selected") rows = filtered.filter((r) => selected.has(r.id));
    if (rows.length === 0) return toast.error("Nothing to export");
    const name = await exportPeople(rows, format);
    qc.invalidateQueries({ queryKey: ["kpis"] });
    toast.success(`Exported ${rows.length} rows → ${name}`);
  };

  const allSelected = visible.length > 0 && visible.every((r) => selected.has(r.id));
  const toggleAll = () => {
    const next = new Set(selected);
    if (allSelected) visible.forEach((r) => next.delete(r.id));
    else visible.forEach((r) => next.add(r.id));
    setSelected(next);
  };

  const clearFilters = () => { setCompany("all"); setRole("all"); setDepartment("all"); setCountry("all"); setIndustry("all"); setJobId("all"); setImportId("all"); setFrom(""); setSearch(""); setPage(1); };

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <PageHeader
        title="People"
        description="Public people metadata only — names, roles, and departments. Personal email addresses appear in Contacts, not here."
        actions={<ExportButton selectedCount={selected.size} onExport={handleExport} />}
      />

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search name or company..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <Select value={company} onValueChange={(v) => { setCompany(v); setPage(1); }}>
            <SelectTrigger className="w-[170px]"><SelectValue placeholder="Company" /></SelectTrigger>
            <SelectContent><SelectItem value="all">All companies</SelectItem>{companies.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={role} onValueChange={(v) => { setRole(v); setPage(1); }}>
            <SelectTrigger className="w-[170px]"><SelectValue placeholder="Role" /></SelectTrigger>
            <SelectContent><SelectItem value="all">All roles</SelectItem>{roles.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={department} onValueChange={(v) => { setDepartment(v); setPage(1); }}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Department" /></SelectTrigger>
            <SelectContent><SelectItem value="all">All departments</SelectItem>{departments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={country} onValueChange={(v) => { setCountry(v); setPage(1); }}>
            <SelectTrigger className="w-[150px]"><SelectValue placeholder="Country" /></SelectTrigger>
            <SelectContent><SelectItem value="all">All countries</SelectItem>{countries.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={industry} onValueChange={(v) => { setIndustry(v); setPage(1); }}>
            <SelectTrigger className="w-[150px]"><SelectValue placeholder="Industry" /></SelectTrigger>
            <SelectContent><SelectItem value="all">All industries</SelectItem>{industries.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={jobId} onValueChange={(v) => { setJobId(v); setPage(1); }}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Job" /></SelectTrigger>
            <SelectContent><SelectItem value="all">All jobs</SelectItem>{jobs.map((j) => <SelectItem key={j.id} value={j.id}>{j.name}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={importId} onValueChange={(v) => { setImportId(v); setPage(1); }}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Import" /></SelectTrigger>
            <SelectContent><SelectItem value="all">All imports</SelectItem>{imports.map((i) => <SelectItem key={i.id} value={i.id}>{i.fileName}</SelectItem>)}</SelectContent>
          </Select>
          <Input type="date" className="w-[150px]" value={from.slice(0,10)} onChange={(e) => { setFrom(e.target.value ? e.target.value + "T00:00:00.000Z" : ""); setPage(1); }} />
          {(company !== "all" || role !== "all" || department !== "all" || country !== "all" || industry !== "all" || jobId !== "all" || importId !== "all" || search || from) && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>Clear filters</Button>
          )}
        </div>
      </Card>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-9" />)}</div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={<Users className="h-5 w-5" />} description="No people records found yet. Run a job or import companies to discover public names, roles, and departments." />
        ) : (
          <>
            <div className="max-h-[calc(100vh-400px)] overflow-auto scrollbar-thin">
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead className="w-10"><Checkbox checked={allSelected} onCheckedChange={toggleAll} /></TableHead>
                    <TableHead>Full name</TableHead><TableHead>Role</TableHead><TableHead>Department</TableHead>
                    <TableHead>Company</TableHead><TableHead>Domain</TableHead>
                    <TableHead>Country</TableHead><TableHead>Industry</TableHead>
                    <TableHead>Source</TableHead><TableHead>Found</TableHead><TableHead>Job</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((p) => (
                    <TableRow key={p.id} data-state={selected.has(p.id) ? "selected" : undefined}>
                      <TableCell><Checkbox checked={selected.has(p.id)} onCheckedChange={(v) => { const n = new Set(selected); if (v) n.add(p.id); else n.delete(p.id); setSelected(n); }} /></TableCell>
                      <TableCell className="font-medium">{p.fullName}</TableCell>
                      <TableCell className="text-sm">{p.roleTitle ?? "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{p.department ?? "—"}</TableCell>
                      <TableCell>{p.companyName}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{p.domain ?? "—"}</TableCell>
                      <TableCell className="text-sm">{p.country ?? "—"}</TableCell>
                      <TableCell className="text-sm">{p.industry ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground text-xs truncate max-w-[160px]">{p.sourceUrl}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{fmtRelative(p.foundAt)}</TableCell>
                      <TableCell className="text-muted-foreground text-sm truncate max-w-[140px]">{p.jobName ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex items-center justify-between p-3 border-t border-border text-sm">
              <span className="text-muted-foreground">Showing {visible.length} of {filtered.length} ({selected.size} selected)</span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                <span className="text-muted-foreground">Page {page} of {totalPages}</span>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
