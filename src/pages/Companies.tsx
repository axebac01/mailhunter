import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Search, Building2, Download } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "@/store/useStore";
import { PageHeader } from "@/components/app/PageHeader";
import { EmptyState } from "@/components/app/EmptyState";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, fmtRelative } from "@/lib/format";
import { exportRows } from "@/lib/exporters";

export default function Companies() {
  const navigate = useNavigate();
  const { companies, incExports } = useStore();
  const [search, setSearch] = useState("");
  const [country, setCountry] = useState<string>("all");
  const [industry, setIndustry] = useState<string>("all");

  const countries = useMemo(() => Array.from(new Set(companies.map((c) => c.country))).sort(), [companies]);
  const industries = useMemo(() => Array.from(new Set(companies.map((c) => c.industry))).sort(), [companies]);

  const filtered = companies.filter((c) =>
    (country === "all" || c.country === country) &&
    (industry === "all" || c.industry === industry) &&
    (search === "" || c.name.toLowerCase().includes(search.toLowerCase()) || c.domain.toLowerCase().includes(search.toLowerCase())),
  );

  const handleExport = () => {
    exportRows(filtered as unknown as Record<string, unknown>[], "companies", "csv");
    incExports();
    toast.success("Companies exported");
  };

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <PageHeader
        title="Companies"
        description="All companies discovered or imported. Click a row to see contacts, people, and source pages."
        actions={<Button size="sm" onClick={handleExport}><Download className="h-4 w-4" /> Export</Button>}
      />

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search by name or domain..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={country} onValueChange={setCountry}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All countries</SelectItem>
              {countries.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={industry} onValueChange={setIndustry}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All industries</SelectItem>
              {industries.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState icon={<Building2 className="h-5 w-5" />} description="No companies match your filters." />
        ) : (
          <div className="max-h-[calc(100vh-320px)] overflow-auto scrollbar-thin">
            <Table>
              <TableHeader className="sticky top-0 bg-card z-10">
                <TableRow>
                  <TableHead>Company</TableHead><TableHead>Website</TableHead><TableHead>Domain</TableHead>
                  <TableHead>Country</TableHead><TableHead>Industry</TableHead>
                  <TableHead>Source</TableHead><TableHead>Created</TableHead>
                  <TableHead className="text-right">Contacts</TableHead><TableHead className="text-right">People</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((c) => (
                  <TableRow key={c.id} className="cursor-pointer" onClick={() => navigate(`/companies/${c.id}`)}>
                    <TableCell className="font-medium"><Link to={`/companies/${c.id}`}>{c.name}</Link></TableCell>
                    <TableCell className="text-xs text-primary truncate max-w-[180px]">{c.website}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{c.domain}</TableCell>
                    <TableCell className="text-sm">{c.country}</TableCell>
                    <TableCell className="text-sm">{c.industry}</TableCell>
                    <TableCell className="text-muted-foreground text-xs truncate max-w-[160px]">{c.sourceUrl}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{fmtDate(c.createdAt)}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.contactsCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.peopleCount}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{fmtRelative(c.updatedAt)}</TableCell>
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
