import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Mail } from "lucide-react";
import { toast } from "sonner";
import { api, type ContactType } from "@/lib/api";
import { exportContacts } from "@/lib/exporters";
import { PageHeader } from "@/components/app/PageHeader";
import { ContactTypeBadge } from "@/components/app/StatusBadge";
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

export default function Contacts() {
  const qc = useQueryClient();
  const { data: contacts = [], isLoading } = useQuery({ queryKey: ["contacts"], queryFn: () => api.listContacts() });
  const { data: jobs = [] } = useQuery({ queryKey: ["jobs"], queryFn: () => api.listJobs() });
  const { data: imports = [] } = useQuery({ queryKey: ["imports"], queryFn: () => api.listImports() });

  const [search, setSearch] = useState("");
  const [type, setType] = useState<string>("all");
  const [country, setCountry] = useState<string>("all");
  const [industry, setIndustry] = useState<string>("all");
  const [jobId, setJobId] = useState<string>("all");
  const [importId, setImportId] = useState<string>("all");
  const [from, setFrom] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const countries = useMemo(() => Array.from(new Set(contacts.map((c) => c.country).filter(Boolean) as string[])).sort(), [contacts]);
  const industries = useMemo(() => Array.from(new Set(contacts.map((c) => c.industry).filter(Boolean) as string[])).sort(), [contacts]);

  const filtered = useMemo(() => contacts.filter((c) =>
    (type === "all" || c.contactType === type) &&
    (country === "all" || c.country === country) &&
    (industry === "all" || c.industry === industry) &&
    (jobId === "all" || c.jobId === jobId) &&
    (importId === "all" || c.importId === importId) &&
    (!from || c.foundAt >= from) &&
    (search === "" || c.companyName.toLowerCase().includes(search.toLowerCase()) || c.contactValue.toLowerCase().includes(search.toLowerCase()))
  ), [contacts, type, country, industry, jobId, importId, from, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleExport = async (scope: "all"|"filtered"|"selected", format: "csv"|"xlsx") => {
    let rows = contacts;
    if (scope === "filtered") rows = filtered;
    else if (scope === "selected") rows = filtered.filter((r) => selected.has(r.id));
    if (rows.length === 0) return toast.error("Nothing to export");
    const name = await exportContacts(rows, format);
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

  const clearFilters = () => { setType("all"); setCountry("all"); setIndustry("all"); setJobId("all"); setImportId("all"); setFrom(""); setSearch(""); setPage(1); };

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <PageHeader
        title="Contacts"
        description="Public company contact records only — generic emails, phone numbers, and contact form URLs."
        actions={<ExportButton selectedCount={selected.size} onExport={handleExport} />}
      />

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search company or value..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <Select value={type} onValueChange={(v) => { setType(v); setPage(1); }}>
            <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {(["generic_email","phone","contact_form"] as ContactType[]).map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={country} onValueChange={(v) => { setCountry(v); setPage(1); }}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Country" /></SelectTrigger>
            <SelectContent><SelectItem value="all">All countries</SelectItem>{countries.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={industry} onValueChange={(v) => { setIndustry(v); setPage(1); }}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Industry" /></SelectTrigger>
            <SelectContent><SelectItem value="all">All industries</SelectItem>{industries.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={jobId} onValueChange={(v) => { setJobId(v); setPage(1); }}>
            <SelectTrigger className="w-[170px]"><SelectValue placeholder="Job" /></SelectTrigger>
            <SelectContent><SelectItem value="all">All jobs</SelectItem>{jobs.map((j) => <SelectItem key={j.id} value={j.id}>{j.name}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={importId} onValueChange={(v) => { setImportId(v); setPage(1); }}>
            <SelectTrigger className="w-[170px]"><SelectValue placeholder="Import" /></SelectTrigger>
            <SelectContent><SelectItem value="all">All imports</SelectItem>{imports.map((i) => <SelectItem key={i.id} value={i.id}>{i.fileName}</SelectItem>)}</SelectContent>
          </Select>
          <Input type="date" className="w-[150px]" value={from.slice(0,10)} onChange={(e) => { setFrom(e.target.value ? e.target.value + "T00:00:00.000Z" : ""); setPage(1); }} />
          {(type !== "all" || country !== "all" || industry !== "all" || jobId !== "all" || importId !== "all" || search || from) && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>Clear filters</Button>
          )}
        </div>
      </Card>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-9" />)}</div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={<Mail className="h-5 w-5" />} description="No contacts found yet. Run a job or import companies to populate results." />
        ) : (
          <>
            <div className="max-h-[calc(100vh-400px)] overflow-auto scrollbar-thin">
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead className="w-10"><Checkbox checked={allSelected} onCheckedChange={toggleAll} /></TableHead>
                    <TableHead>Company</TableHead><TableHead>Domain</TableHead>
                    <TableHead>Country</TableHead><TableHead>Industry</TableHead>
                    <TableHead>Type</TableHead><TableHead>Value</TableHead>
                    <TableHead>Source</TableHead><TableHead>Found</TableHead>
                    <TableHead>Job</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((c) => (
                    <TableRow key={c.id} data-state={selected.has(c.id) ? "selected" : undefined}>
                      <TableCell><Checkbox checked={selected.has(c.id)} onCheckedChange={(v) => { const n = new Set(selected); if (v) n.add(c.id); else n.delete(c.id); setSelected(n); }} /></TableCell>
                      <TableCell className="font-medium">{c.companyName}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{c.domain ?? "—"}</TableCell>
                      <TableCell className="text-sm">{c.country ?? "—"}</TableCell>
                      <TableCell className="text-sm">{c.industry ?? "—"}</TableCell>
                      <TableCell><ContactTypeBadge type={c.contactType} /></TableCell>
                      <TableCell className="font-mono text-xs">{c.contactValue}</TableCell>
                      <TableCell className="text-muted-foreground text-xs truncate max-w-[160px]">{c.sourceUrl}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{fmtRelative(c.foundAt)}</TableCell>
                      <TableCell className="text-muted-foreground text-sm truncate max-w-[160px]">{c.jobName ?? "—"}</TableCell>
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
