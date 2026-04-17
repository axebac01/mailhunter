import { useMemo, useState } from "react";
import { Search, Download, Mail } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "@/store/useStore";
import { PageHeader } from "@/components/app/PageHeader";
import { ContactTypeBadge, ImportStatusBadge } from "@/components/app/StatusBadge";
import { EmptyState } from "@/components/app/EmptyState";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { exportRows } from "@/lib/exporters";
import { fmtRelative } from "@/lib/format";
import type { ContactType } from "@/types";

const PAGE_SIZE = 25;

export default function Contacts() {
  const { contacts, incExports } = useStore();
  const [search, setSearch] = useState("");
  const [type, setType] = useState<string>("all");
  const [country, setCountry] = useState<string>("all");
  const [industry, setIndustry] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const countries = useMemo(() => Array.from(new Set(contacts.map((c) => c.country))).sort(), [contacts]);
  const industries = useMemo(() => Array.from(new Set(contacts.map((c) => c.industry))).sort(), [contacts]);

  const filtered = useMemo(() => contacts.filter((c) =>
    (type === "all" || c.contactType === type) &&
    (country === "all" || c.country === country) &&
    (industry === "all" || c.industry === industry) &&
    (search === "" || c.companyName.toLowerCase().includes(search.toLowerCase()) || c.contactValue.toLowerCase().includes(search.toLowerCase())),
  ), [contacts, type, country, industry, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleExport = (mode: "visible" | "filtered" | "selected") => {
    let rows = visible;
    if (mode === "filtered") rows = filtered;
    if (mode === "selected") rows = filtered.filter((r) => selected.has(r.id));
    if (rows.length === 0) return toast.error("Nothing to export");
    exportRows(rows as unknown as Record<string, unknown>[], `contacts_${mode}`, "csv");
    incExports();
    toast.success(`Exported ${rows.length} rows`);
  };

  const allSelected = visible.length > 0 && visible.every((r) => selected.has(r.id));
  const toggleAll = () => {
    const next = new Set(selected);
    if (allSelected) visible.forEach((r) => next.delete(r.id));
    else visible.forEach((r) => next.add(r.id));
    setSelected(next);
  };

  const clearFilters = () => { setType("all"); setCountry("all"); setIndustry("all"); setSearch(""); setPage(1); };

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <PageHeader
        title="Contacts"
        description="Public company contact records only — generic emails, phone numbers, and contact form URLs."
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button size="sm"><Download className="h-4 w-4" /> Export</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleExport("visible")}>Export visible rows</DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport("filtered")}>Export filtered rows</DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport("selected")}>Export selected ({selected.size})</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search company or value..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <Select value={type} onValueChange={(v) => { setType(v); setPage(1); }}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {(["generic_email", "phone", "contact_form"] as ContactType[]).map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={country} onValueChange={(v) => { setCountry(v); setPage(1); }}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All countries</SelectItem>
              {countries.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={industry} onValueChange={(v) => { setIndustry(v); setPage(1); }}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All industries</SelectItem>
              {industries.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          {(type !== "all" || country !== "all" || industry !== "all" || search) && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>Clear filters</Button>
          )}
        </div>
      </Card>

      <Card className="overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState icon={<Mail className="h-5 w-5" />} description="No contacts found yet. Run a job or import companies to populate results." />
        ) : (
          <>
            <div className="max-h-[calc(100vh-360px)] overflow-auto scrollbar-thin">
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead className="w-10"><Checkbox checked={allSelected} onCheckedChange={toggleAll} /></TableHead>
                    <TableHead>Company</TableHead><TableHead>Domain</TableHead>
                    <TableHead>Country</TableHead><TableHead>Industry</TableHead>
                    <TableHead>Type</TableHead><TableHead>Value</TableHead>
                    <TableHead>Source</TableHead><TableHead>Found</TableHead>
                    <TableHead>Job</TableHead><TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((c) => (
                    <TableRow key={c.id} data-state={selected.has(c.id) ? "selected" : undefined}>
                      <TableCell><Checkbox checked={selected.has(c.id)} onCheckedChange={(v) => { const n = new Set(selected); if (v) n.add(c.id); else n.delete(c.id); setSelected(n); }} /></TableCell>
                      <TableCell className="font-medium">{c.companyName}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{c.domain}</TableCell>
                      <TableCell className="text-sm">{c.country}</TableCell>
                      <TableCell className="text-sm">{c.industry}</TableCell>
                      <TableCell><ContactTypeBadge type={c.contactType} /></TableCell>
                      <TableCell className="font-mono text-xs">{c.contactValue}</TableCell>
                      <TableCell className="text-muted-foreground text-xs truncate max-w-[160px]">{c.sourceUrl}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{fmtRelative(c.foundAt)}</TableCell>
                      <TableCell className="text-muted-foreground text-sm truncate max-w-[160px]">{c.jobName ?? "—"}</TableCell>
                      <TableCell><ImportStatusBadge status={c.importStatus} /></TableCell>
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
