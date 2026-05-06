import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search, Database, Send, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PaginationFooter } from "@/components/app/PaginationFooter";

const PAGE_SIZE = 50;

interface SeCompanyRow {
  org_nr: string;
  name: string;
  sni_code: string | null;
  sni_text: string | null;
  revenue_ksek: number | null;
  employees: number | null;
  county: string | null;
  municipality: string | null;
  website: string | null;
}

export default function SeCompanies() {
  const [search, setSearch] = useState("");
  const [sniPrefix, setSniPrefix] = useState("");
  const [county, setCounty] = useState("");
  const [municipality, setMunicipality] = useState("");
  const [revMin, setRevMin] = useState("");
  const [revMax, setRevMax] = useState("");
  const [empMin, setEmpMin] = useState("");
  const [empMax, setEmpMax] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);

  // Reset page on filter change
  useEffect(() => { setPage(0); setSelected(new Set()); }, [search, sniPrefix, county, municipality, revMin, revMax, empMin, empMax]);

  const filters = useMemo(() => ({
    search: search.trim(),
    sniPrefix: sniPrefix.trim(),
    county: county.trim(),
    municipality: municipality.trim(),
    revMin: revMin ? Number(revMin) : null,
    revMax: revMax ? Number(revMax) : null,
    empMin: empMin ? Number(empMin) : null,
    empMax: empMax ? Number(empMax) : null,
  }), [search, sniPrefix, county, municipality, revMin, revMax, empMin, empMax]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["se_companies", filters, page],
    queryFn: async () => {
      let q = supabase
        .from("se_companies")
        .select("org_nr, name, sni_code, sni_text, revenue_ksek, employees, county, municipality, website", { count: "exact" });

      if (filters.search) q = q.ilike("name", `%${filters.search}%`);
      if (filters.sniPrefix) q = q.like("sni_code", `${filters.sniPrefix}%`);
      if (filters.county) q = q.ilike("county", filters.county);
      if (filters.municipality) q = q.ilike("municipality", filters.municipality);
      if (filters.revMin !== null) q = q.gte("revenue_ksek", filters.revMin);
      if (filters.revMax !== null) q = q.lte("revenue_ksek", filters.revMax);
      if (filters.empMin !== null) q = q.gte("employees", filters.empMin);
      if (filters.empMax !== null) q = q.lte("employees", filters.empMax);

      q = q.order("revenue_ksek", { ascending: false, nullsFirst: false })
           .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: (data ?? []) as SeCompanyRow[], total: count ?? 0 };
    },
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.org_nr));

  const toggleAll = () => {
    const next = new Set(selected);
    if (allSelected) rows.forEach((r) => next.delete(r.org_nr));
    else rows.forEach((r) => next.add(r.org_nr));
    setSelected(next);
  };

  const toggle = (orgNr: string) => {
    const next = new Set(selected);
    next.has(orgNr) ? next.delete(orgNr) : next.add(orgNr);
    setSelected(next);
  };

  const importSelected = async () => {
    setImporting(true);
    try {
      const orgNrs = Array.from(selected);
      const { data, error } = await supabase.functions.invoke("import-se-companies", {
        body: { org_nrs: orgNrs },
      });
      if (error) throw error;
      const r = data as any;
      if (r?.error) throw new Error(r.error);
      toast.success(`Importerade ${r.inserted} bolag (${r.skipped} fanns redan) · ${r.peopleInserted ?? 0} styrelseledamöter`);
      setSelected(new Set());
    } catch (e: any) {
      toast.error(e?.message ?? "Import misslyckades");
    } finally {
      setImporting(false);
    }
  };

  const fmtNum = (n: number | null) => n?.toLocaleString("sv-SE") ?? "—";
  const fmtRevenue = (ksek: number | null) => {
    if (ksek === null || ksek === undefined) return "—";
    if (Math.abs(ksek) >= 1000) {
      return `${(ksek / 1000).toLocaleString("sv-SE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} Mkr`;
    }
    return `${ksek.toLocaleString("sv-SE")} tkr`;
  };

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <PageHeader
        title="SE Bolagsregister"
        description="Sök i hela det svenska bolagsregistret. Markera bolag och importera till Companies för att köra crawl-jobb."
        actions={
          <Button onClick={importSelected} disabled={selected.size === 0 || importing}>
            {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Importera till Companies ({selected.size})
          </Button>
        }
      />

      <Card className="mb-4 p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3">
          <div>
            <Label>Sök i namn</Label>
            <div className="relative mt-1.5">
              <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-8" placeholder="Företagsnamn…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>SNI-kod (prefix)</Label>
            <Input className="mt-1.5" placeholder="t.ex. 47 eller 47.11" value={sniPrefix} onChange={(e) => setSniPrefix(e.target.value)} />
          </div>
          <div>
            <Label>Län</Label>
            <Input className="mt-1.5" placeholder="t.ex. Stockholm" value={county} onChange={(e) => setCounty(e.target.value)} />
          </div>
          <div>
            <Label>Kommun</Label>
            <Input className="mt-1.5" placeholder="t.ex. Solna" value={municipality} onChange={(e) => setMunicipality(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Oms. min (tkr)</Label>
              <Input className="mt-1.5" type="number" value={revMin} onChange={(e) => setRevMin(e.target.value)} />
            </div>
            <div>
              <Label>Oms. max (tkr)</Label>
              <Input className="mt-1.5" type="number" value={revMax} onChange={(e) => setRevMax(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Anst. min</Label>
              <Input className="mt-1.5" type="number" value={empMin} onChange={(e) => setEmpMin(e.target.value)} />
            </div>
            <div>
              <Label>Anst. max</Label>
              <Input className="mt-1.5" type="number" value={empMax} onChange={(e) => setEmpMax(e.target.value)} />
            </div>
          </div>
        </div>
      </Card>

      <Card>
        {isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            <Database className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p>Inga bolag matchar filtren.</p>
            <p className="text-xs mt-1">Tips: tom databas? Be Lovable importera dumpen först.</p>
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
                  </TableHead>
                  <TableHead>Namn</TableHead>
                  <TableHead>Org.nr</TableHead>
                  <TableHead>SNI</TableHead>
                  <TableHead className="text-right">Omsättning</TableHead>
                  <TableHead className="text-right">Anst.</TableHead>
                  <TableHead>Kommun</TableHead>
                  <TableHead>Webb</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.org_nr} className={selected.has(r.org_nr) ? "bg-accent/40" : ""}>
                    <TableCell>
                      <Checkbox checked={selected.has(r.org_nr)} onCheckedChange={() => toggle(r.org_nr)} />
                    </TableCell>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{r.org_nr}</TableCell>
                    <TableCell className="text-xs">
                      {r.sni_code && <span className="font-mono">{r.sni_code}</span>}
                      {r.sni_text && <div className="text-muted-foreground line-clamp-1">{r.sni_text}</div>}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">{fmtNum(r.revenue_ksek)}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{fmtNum(r.employees)}</TableCell>
                    <TableCell className="text-xs">{r.municipality ?? "—"}</TableCell>
                    <TableCell className="text-xs">
                      {r.website ? <a href={r.website.startsWith("http") ? r.website : `https://${r.website}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">{r.website}</a> : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <PaginationFooter
              visibleCount={rows.length}
              totalCount={total}
              selectedCount={selected.size}
              page={page + 1}
              totalPages={Math.max(1, Math.ceil(total / PAGE_SIZE))}
              onPrev={() => setPage((p) => Math.max(0, p - 1))}
              onNext={() => setPage((p) => p + 1)}
            />
          </>
        )}
      </Card>
    </div>
  );
}
