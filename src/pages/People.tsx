import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Users, Send } from "lucide-react";
import { toast } from "sonner";
import { api, type PersonRow } from "@/lib/api";
import { exportPeople } from "@/lib/exporters";
import { PageHeader } from "@/components/app/PageHeader";
import { EmptyState } from "@/components/app/EmptyState";
import { ExportButton } from "@/components/app/ExportButton";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtRelative } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { useTableFilters } from "@/hooks/useTableFilters";
import { FilterBar, type FilterChip } from "@/components/app/FilterBar";
import { PaginationFooter } from "@/components/app/PaginationFooter";
import { SendToOutreachDialog } from "@/components/outreach/SendToOutreachDialog";

export default function People() {
  const qc = useQueryClient();
  const [outreachOpen, setOutreachOpen] = useState(false);
  const { data: people = [], isLoading } = useQuery({ queryKey: ["people"], queryFn: () => api.listPeople() });
  const { data: jobs = [] } = useQuery({ queryKey: ["jobs"], queryFn: () => api.listJobs() });
  const { data: imports = [] } = useQuery({ queryKey: ["imports"], queryFn: () => api.listImports() });

  const companies = useMemo(() => Array.from(new Set(people.map((p) => p.companyName))).sort(), [people]);
  const roles = useMemo(() => Array.from(new Set(people.map((p) => p.roleTitle).filter(Boolean) as string[])).sort(), [people]);
  const departments = useMemo(() => Array.from(new Set(people.map((p) => p.department).filter(Boolean) as string[])).sort(), [people]);
  const countries = useMemo(() => Array.from(new Set(people.map((p) => p.country).filter(Boolean) as string[])).sort(), [people]);
  const industries = useMemo(() => Array.from(new Set(people.map((p) => p.industry).filter(Boolean) as string[])).sort(), [people]);

  const filterDefs = useMemo(() => ({
    company: (p: PersonRow, v: string) => p.companyName === v,
    role: (p: PersonRow, v: string) => p.roleTitle === v,
    department: (p: PersonRow, v: string) => p.department === v,
    country: (p: PersonRow, v: string) => p.country === v,
    industry: (p: PersonRow, v: string) => p.industry === v,
    jobId: (p: PersonRow, v: string) => p.jobId === v,
    importId: (p: PersonRow, v: string) => p.importId === v,
  }), []);

  const t = useTableFilters({
    rows: people,
    rowId: (p) => p.id,
    filterDefs,
    fromFn: (p, from) => p.foundAt >= from,
    searchFn: (p, q) => p.fullName.toLowerCase().includes(q) || p.companyName.toLowerCase().includes(q),
  });

  const chips: FilterChip[] = [
    { key: "company", placeholder: "Company", width: "w-[170px]", allLabel: "All companies", options: companies.map((x) => ({ value: x, label: x })) },
    { key: "role", placeholder: "Role", width: "w-[170px]", allLabel: "All roles", options: roles.map((x) => ({ value: x, label: x })) },
    { key: "department", placeholder: "Department", allLabel: "All departments", options: departments.map((x) => ({ value: x, label: x })) },
    { key: "country", placeholder: "Country", width: "w-[150px]", options: countries.map((x) => ({ value: x, label: x })) },
    { key: "industry", placeholder: "Industry", width: "w-[150px]", options: industries.map((x) => ({ value: x, label: x })) },
    { key: "jobId", placeholder: "Job", allLabel: "All jobs", options: jobs.map((j) => ({ value: j.id, label: j.name })) },
    { key: "importId", placeholder: "Import", allLabel: "All imports", options: imports.map((i) => ({ value: i.id, label: i.fileName })) },
  ];

  const handleExport = async (scope: "all"|"filtered"|"selected", format: "csv"|"xlsx") => {
    let rows = people;
    if (scope === "filtered") rows = t.filtered;
    else if (scope === "selected") rows = t.filtered.filter((r) => t.selected.has(r.id));
    if (rows.length === 0) return toast.error("Nothing to export");
    const name = await exportPeople(rows, format);
    qc.invalidateQueries({ queryKey: ["kpis"] });
    toast.success(`Exported ${rows.length} rows → ${name}`);
  };

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <PageHeader
        title="People"
        description="Public people metadata only — names, roles, and departments. Personal email addresses appear in Contacts, not here."
        actions={<ExportButton selectedCount={t.selected.size} onExport={handleExport} />}
      />

      <Card className="mb-4 p-3">
        <FilterBar
          search={t.search}
          searchPlaceholder="Search name or company..."
          onSearchChange={t.setSearch}
          chips={chips}
          values={t.filters}
          onChipChange={t.setFilter}
          from={t.from}
          onFromChange={t.setFrom}
          hasActive={t.hasActiveFilters}
          onClear={t.clear}
        />
      </Card>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-9" />)}</div>
        ) : t.filtered.length === 0 ? (
          <EmptyState icon={<Users className="h-5 w-5" />} description="No people records found yet. Run a job or import companies to discover public names, roles, and departments." />
        ) : (
          <>
            <div className="max-h-[calc(100vh-400px)] overflow-auto scrollbar-thin">
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead className="w-10"><Checkbox checked={t.allVisibleSelected} onCheckedChange={t.toggleAllVisible} /></TableHead>
                    <TableHead>Full name</TableHead><TableHead>Role</TableHead><TableHead>Department</TableHead>
                    <TableHead>Company</TableHead><TableHead>Domain</TableHead>
                    <TableHead>Country</TableHead><TableHead>Industry</TableHead>
                    <TableHead>Source</TableHead><TableHead>Found</TableHead><TableHead>Job</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {t.visible.map((p) => (
                    <TableRow key={p.id} data-state={t.selected.has(p.id) ? "selected" : undefined}>
                      <TableCell><Checkbox checked={t.selected.has(p.id)} onCheckedChange={() => t.toggleRow(p.id)} /></TableCell>
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
            <PaginationFooter
              visibleCount={t.visible.length}
              totalCount={t.filtered.length}
              selectedCount={t.selected.size}
              page={t.page}
              totalPages={t.totalPages}
              onPrev={() => t.setPage((p) => p - 1)}
              onNext={() => t.setPage((p) => p + 1)}
            />
          </>
        )}
      </Card>
    </div>
  );
}
