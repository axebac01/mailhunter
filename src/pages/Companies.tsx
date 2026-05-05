import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Building2, XCircle, Send } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { downloadRows } from "@/lib/exporters";
import { PageHeader } from "@/components/app/PageHeader";
import { EmptyState } from "@/components/app/EmptyState";
import { ExportButton } from "@/components/app/ExportButton";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, fmtRelative } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { SendToOutreachDialog } from "@/components/outreach/SendToOutreachDialog";

export default function Companies() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: companies = [], isLoading } = useQuery({ queryKey: ["companies"], queryFn: () => api.listCompanies() });
  const { data: contacts = [] } = useQuery({ queryKey: ["contacts"], queryFn: () => api.listContacts() });
  const { data: people = [] } = useQuery({ queryKey: ["people"], queryFn: () => api.listPeople() });

  const [search, setSearch] = useState("");
  const [country, setCountry] = useState<string>("all");
  const [industry, setIndustry] = useState<string>("all");

  const countries = useMemo(() => Array.from(new Set(companies.map((c) => c.country).filter(Boolean) as string[])).sort(), [companies]);
  const industries = useMemo(() => Array.from(new Set(companies.map((c) => c.industry).filter(Boolean) as string[])).sort(), [companies]);

  const counts = useMemo(() => {
    const cMap = new Map<string, number>(); contacts.forEach((c) => cMap.set(c.companyId, (cMap.get(c.companyId) ?? 0) + 1));
    const pMap = new Map<string, number>(); people.forEach((p) => pMap.set(p.companyId, (pMap.get(p.companyId) ?? 0) + 1));
    return { c: cMap, p: pMap };
  }, [contacts, people]);

  const filtered = companies.filter((c) =>
    (country === "all" || c.country === country) &&
    (industry === "all" || c.industry === industry) &&
    (search === "" || c.name.toLowerCase().includes(search.toLowerCase()) || (c.domain ?? "").toLowerCase().includes(search.toLowerCase()))
  );

  const handleExport = async (scope: "all"|"filtered"|"selected", format: "csv"|"xlsx") => {
    const rows = (scope === "all" ? companies : filtered).map((c) => ({
      name: c.name, website: c.website, domain: c.domain, country: c.country, industry: c.industry,
      source_url: c.sourceUrl, created_at: c.createdAt, updated_at: c.updatedAt,
      contacts_count: counts.c.get(c.id) ?? 0, people_count: counts.p.get(c.id) ?? 0,
    }));
    const today = new Date().toISOString().slice(0, 10);
    downloadRows(rows, `companies_export_${today}`, format);
    await api.recordExport({ export_type: "contacts", file_format: format, file_name: `companies_export_${today}.${format}`, row_count: rows.length });
    qc.invalidateQueries({ queryKey: ["kpis"] });
    toast.success(`Exported ${rows.length} companies`);
  };

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <PageHeader
        title="Companies"
        description="All companies discovered or imported. Click a row to see contacts, people, and source pages."
        actions={<ExportButton onExport={handleExport} disableSelected />}
      />

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search by name or domain..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={country} onValueChange={setCountry}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All countries</SelectItem>{countries.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={industry} onValueChange={setIndustry}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All industries</SelectItem>{industries.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={<Building2 className="h-5 w-5" />} description="No companies match your filters." />
        ) : (
          <div className="max-h-[calc(100vh-340px)] overflow-auto scrollbar-thin">
            <Table>
              <TableHeader className="sticky top-0 bg-card z-10">
                <TableRow>
                  <TableHead>Company</TableHead><TableHead>Website</TableHead><TableHead>Domain</TableHead>
                  <TableHead>Country</TableHead><TableHead>Industry</TableHead>
                  <TableHead>Source</TableHead><TableHead>Created</TableHead>
                  <TableHead className="text-right">Contacts</TableHead><TableHead className="text-right">People</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((c) => (
                  <TableRow key={c.id} className="cursor-pointer" onClick={() => navigate(`/companies/${c.id}`)}>
                    <TableCell className="font-medium"><Link to={`/companies/${c.id}`}>{c.name}</Link></TableCell>
                    <TableCell className="text-xs text-primary truncate max-w-[180px]">{c.website ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{c.domain ?? "—"}</TableCell>
                    <TableCell className="text-sm">{c.country ?? "—"}</TableCell>
                    <TableCell className="text-sm">{c.industry ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground text-xs truncate max-w-[160px]">{c.sourceUrl ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{fmtDate(c.createdAt)}</TableCell>
                    <TableCell className="text-right tabular-nums">{counts.c.get(c.id) ?? 0}</TableCell>
                    <TableCell className="text-right tabular-nums">{counts.p.get(c.id) ?? 0}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{fmtRelative(c.updatedAt)}</TableCell>
                    <TableCell className="text-right">
                      {c.domain && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive h-7 px-2"
                          onClick={async (e) => {
                            e.stopPropagation();
                            const wrongHost = c.domain!;
                            try {
                              await supabase.from("domain_blocklist").insert({ company_id: c.id, host: wrongHost, reason: "user marked wrong" } as any);
                              await supabase.from("companies").update({ domain: null, website: null, source_url: null, domain_status: "failed" }).eq("id", c.id);
                              toast.success(`Marked ${wrongHost} as wrong — re-resolve to find a better one.`);
                              qc.invalidateQueries({ queryKey: ["companies"] });
                            } catch (err: any) {
                              toast.error(err?.message ?? "Failed to mark wrong");
                            }
                          }}
                          title="Mark this domain as incorrect"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
