import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FileText, Filter, Search, Briefcase, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, type ImportStatus } from "@/lib/api";
import { exportImportResults } from "@/lib/exporters";
import { PageHeader } from "@/components/app/PageHeader";
import { SectionCard } from "@/components/app/SectionCard";
import { EmptyState } from "@/components/app/EmptyState";
import { ImportStatusBadge } from "@/components/app/StatusBadge";
import { ExportButton, type ExportScope, type ExportFormat } from "@/components/app/ExportButton";
import { KpiCard } from "@/components/app/KpiCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtNum, fmtRelative } from "@/lib/format";

const STATUS_OPTIONS: ImportStatus[] = ["pending", "matched", "partial_match", "not_found", "duplicate", "failed", "processing", "completed"];

export default function ImportDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const importQ = useQuery({
    queryKey: ["import", id],
    queryFn: () => api.getImport(id),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data?.status === "processing" ? 3000 : false),
  });
  const rowsQ = useQuery({
    queryKey: ["importRows", id],
    queryFn: () => api.listImportRows(id),
    enabled: !!id,
    refetchInterval: (q) => (importQ.data?.status === "processing" ? 3000 : false),
  });

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const allRows = rowsQ.data ?? [];
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return allRows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (!s) return true;
      return (
        r.companyName.toLowerCase().includes(s) ||
        (r.website ?? "").toLowerCase().includes(s) ||
        (r.country ?? "").toLowerCase().includes(s)
      );
    });
  }, [allRows, statusFilter, search]);

  const toggleAllVisible = (checked: boolean) => {
    const next = new Set(selected);
    filtered.forEach((r) => (checked ? next.add(r.id) : next.delete(r.id)));
    setSelected(next);
  };
  const toggleOne = (rowId: string, checked: boolean) => {
    const next = new Set(selected);
    checked ? next.add(rowId) : next.delete(rowId);
    setSelected(next);
  };

  const handleExport = async (scope: ExportScope, format: ExportFormat) => {
    let source = allRows;
    if (scope === "filtered") source = filtered;
    if (scope === "selected") source = allRows.filter((r) => selected.has(r.id));
    if (source.length === 0) {
      toast.error("Nothing to export");
      return;
    }
    const rows = source.map((r) => ({
      company_name: r.companyName,
      country: r.country ?? "",
      website: r.website ?? "",
      industry: r.industry ?? "",
      notes: r.notes ?? "",
      status: r.status,
      matched_domain: r.matchedDomain ?? "",
      error: r.errorMessage ?? "",
    }));
    const name = await exportImportResults(rows, format);
    qc.invalidateQueries({ queryKey: ["kpis"] });
    qc.invalidateQueries({ queryKey: ["exports"] });
    toast.success(`Exported ${name}`);
  };

  if (importQ.isLoading) {
    return <div className="p-6 max-w-[1600px] mx-auto"><p className="text-sm text-muted-foreground">Loading…</p></div>;
  }
  if (!importQ.data) {
    return (
      <div className="p-6 max-w-[1600px] mx-auto">
        <EmptyState icon={<FileText className="h-5 w-5" />} description="Import not found." />
        <Button variant="outline" className="mt-4" onClick={() => navigate("/imports")}><ArrowLeft className="h-4 w-4" /> Back to imports</Button>
      </div>
    );
  }

  const imp = importQ.data;
  const visibleIds = filtered.map((r) => r.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <Button variant="ghost" size="sm" className="mb-3 -ml-2" onClick={() => navigate("/imports")}>
        <ArrowLeft className="h-4 w-4" /> Back to imports
      </Button>

      <PageHeader
        title={imp.fileName}
        description={`Uploaded ${fmtRelative(imp.createdAt)} · ${imp.fileType.toUpperCase()}`}
        actions={
          <div className="flex items-center gap-2">
            <ImportStatusBadge status={imp.status} />
            {imp.crawlJobId && (
              <Button variant="outline" size="sm" asChild>
                <Link to={`/jobs/${imp.crawlJobId}`}><Briefcase className="h-4 w-4" /> View job</Link>
              </Button>
            )}
            <ExportButton selectedCount={selected.size} onExport={handleExport} />
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <KpiCard label="Total" value={fmtNum(imp.totalRows)} />
        <KpiCard label="Processed" value={fmtNum(imp.processedRows)} />
        <KpiCard label="Matched" value={fmtNum(imp.matchedRows)} />
        <KpiCard label="Failed" value={fmtNum(imp.failedRows)} />
        <KpiCard label="Contacts" value={fmtNum(imp.contactsFound)} />
        <KpiCard label="People" value={fmtNum(imp.peopleFound)} />
      </div>

      <SectionCard title="Rows" description={`${filtered.length} of ${allRows.length} shown`} noPadding>
        <div className="flex flex-wrap items-center gap-2 p-4 border-b border-border">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search company, website, country" className="pl-9" />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {selected.size > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear selection ({selected.size})</Button>
          )}
        </div>

        {allRows.length === 0 ? (
          <EmptyState icon={<FileText className="h-5 w-5" />} description="No rows in this import yet." />
        ) : filtered.length === 0 ? (
          <EmptyState icon={<Filter className="h-5 w-5" />} description="No rows match the current filters." />
        ) : (
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox checked={allVisibleSelected} onCheckedChange={(v) => toggleAllVisible(!!v)} />
                  </TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Website</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead>Industry</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Matched company</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell><Checkbox checked={selected.has(r.id)} onCheckedChange={(v) => toggleOne(r.id, !!v)} /></TableCell>
                    <TableCell className="font-medium">{r.companyName}</TableCell>
                    <TableCell className="text-xs text-muted-foreground truncate max-w-[200px]">{r.website ?? "—"}</TableCell>
                    <TableCell className="text-sm">{r.country ?? "—"}</TableCell>
                    <TableCell className="text-sm">{r.industry ?? "—"}</TableCell>
                    <TableCell><ImportStatusBadge status={r.status} /></TableCell>
                    <TableCell className="text-sm">
                      {r.matchedCompanyId ? (
                        <Link to={`/companies/${r.matchedCompanyId}`} className="text-primary hover:underline">
                          {r.matchedDomain ?? "View"}
                        </Link>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-destructive max-w-[260px] truncate">{r.errorMessage ?? ""}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
