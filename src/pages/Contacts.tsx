import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail } from "lucide-react";
import { toast } from "sonner";
import { api, type ContactRow, type ContactType } from "@/lib/api";
import { exportContacts } from "@/lib/exporters";
import { PageHeader } from "@/components/app/PageHeader";
import { ContactTypeBadge } from "@/components/app/StatusBadge";
import { EmptyState } from "@/components/app/EmptyState";
import { ExportButton } from "@/components/app/ExportButton";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtRelative } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { useTableFilters } from "@/hooks/useTableFilters";
import { FilterBar, type FilterChip } from "@/components/app/FilterBar";
import { PaginationFooter } from "@/components/app/PaginationFooter";

const CONTACT_TYPES: ContactType[] = ["generic_email", "person_email", "phone", "contact_form"];

export default function Contacts() {
  const qc = useQueryClient();
  const { data: contacts = [], isLoading } = useQuery({ queryKey: ["contacts"], queryFn: () => api.listContacts() });
  const { data: jobs = [] } = useQuery({ queryKey: ["jobs"], queryFn: () => api.listJobs() });
  const { data: imports = [] } = useQuery({ queryKey: ["imports"], queryFn: () => api.listImports() });

  const countries = useMemo(() => Array.from(new Set(contacts.map((c) => c.country).filter(Boolean) as string[])).sort(), [contacts]);
  const industries = useMemo(() => Array.from(new Set(contacts.map((c) => c.industry).filter(Boolean) as string[])).sort(), [contacts]);

  const filterDefs = useMemo(() => ({
    type: (c: ContactRow, v: string) => c.contactType === v,
    country: (c: ContactRow, v: string) => c.country === v,
    industry: (c: ContactRow, v: string) => c.industry === v,
    jobId: (c: ContactRow, v: string) => c.jobId === v,
    importId: (c: ContactRow, v: string) => c.importId === v,
  }), []);

  const t = useTableFilters({
    rows: contacts,
    rowId: (c) => c.id,
    filterDefs,
    fromFn: (c, from) => c.foundAt >= from,
    searchFn: (c, q) => c.companyName.toLowerCase().includes(q) || c.contactValue.toLowerCase().includes(q),
  });

  const chips: FilterChip[] = [
    { key: "type", placeholder: "Type", width: "w-[150px]", allLabel: "All types", options: CONTACT_TYPES.map((x) => ({ value: x, label: x })) },
    { key: "country", placeholder: "Country", options: countries.map((x) => ({ value: x, label: x })) },
    { key: "industry", placeholder: "Industry", options: industries.map((x) => ({ value: x, label: x })) },
    { key: "jobId", placeholder: "Job", width: "w-[170px]", allLabel: "All jobs", options: jobs.map((j) => ({ value: j.id, label: j.name })) },
    { key: "importId", placeholder: "Import", width: "w-[170px]", allLabel: "All imports", options: imports.map((i) => ({ value: i.id, label: i.fileName })) },
  ];

  const handleExport = async (scope: "all"|"filtered"|"selected", format: "csv"|"xlsx") => {
    let rows = contacts;
    if (scope === "filtered") rows = t.filtered;
    else if (scope === "selected") rows = t.filtered.filter((r) => t.selected.has(r.id));
    if (rows.length === 0) return toast.error("Nothing to export");
    const name = await exportContacts(rows, format);
    qc.invalidateQueries({ queryKey: ["kpis"] });
    toast.success(`Exported ${rows.length} rows → ${name}`);
  };

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <PageHeader
        title="Contacts"
        description="Public contact records only — generic emails, personal emails, phone numbers, and contact form URLs."
        actions={<ExportButton selectedCount={t.selected.size} onExport={handleExport} />}
      />

      <Card className="mb-4 p-3">
        <FilterBar
          search={t.search}
          searchPlaceholder="Search company or value..."
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
          <EmptyState icon={<Mail className="h-5 w-5" />} description="No contacts found yet. Run a job or import companies to populate results." />
        ) : (
          <>
            <div className="max-h-[calc(100vh-400px)] overflow-auto scrollbar-thin">
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead className="w-10"><Checkbox checked={t.allVisibleSelected} onCheckedChange={t.toggleAllVisible} /></TableHead>
                    <TableHead>Company</TableHead><TableHead>Domain</TableHead>
                    <TableHead>Country</TableHead><TableHead>Industry</TableHead>
                    <TableHead>Type</TableHead><TableHead>Value</TableHead>
                    <TableHead>Source</TableHead><TableHead>Found</TableHead>
                    <TableHead>Job</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {t.visible.map((c) => (
                    <TableRow key={c.id} data-state={t.selected.has(c.id) ? "selected" : undefined}>
                      <TableCell><Checkbox checked={t.selected.has(c.id)} onCheckedChange={() => t.toggleRow(c.id)} /></TableCell>
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
