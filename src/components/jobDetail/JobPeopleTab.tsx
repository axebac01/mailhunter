import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SectionCard } from "@/components/app/SectionCard";
import { EmptyState } from "@/components/app/EmptyState";
import { Badge } from "@/components/ui/badge";
import { fmtRelative } from "@/lib/format";
import type { PersonRow } from "@/lib/api";

function emailBadge(p: PersonRow) {
  if (!p.email) return null;
  const statusLabel = p.emailStatus === "verified" ? "verifierad" : "overifierad";
  const typeLabel = p.emailType === "role" ? "roll" : null;
  return (
    <>
      <Badge variant={p.emailStatus === "verified" ? "secondary" : "outline"} className="ml-2 text-[10px] px-1.5 py-0">{statusLabel}</Badge>
      {typeLabel && <Badge variant="outline" className="ml-1 text-[10px] px-1.5 py-0">{typeLabel}</Badge>}
    </>
  );
}

export function JobPeopleTab({ people }: { people: PersonRow[] }) {
  return (
    <SectionCard title="People records" noPadding>
      {people.length === 0 ? <EmptyState description="No people records yet for this job." /> : (
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Role</TableHead><TableHead>Email</TableHead><TableHead>Phone</TableHead><TableHead>Company</TableHead><TableHead>Found</TableHead></TableRow></TableHeader>
          <TableBody>
            {people.map((p) => (
              <TableRow key={p.id} className={!p.email ? "opacity-70" : undefined}>
                <TableCell className="font-medium">{p.fullName}</TableCell>
                <TableCell>{p.roleTitle ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs">
                  {p.email ? <>{p.email}{emailBadge(p)}</> : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="font-mono text-xs">{p.phone ?? <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell>{p.companyName}</TableCell>
                <TableCell className="text-muted-foreground text-sm">{fmtRelative(p.foundAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </SectionCard>
  );
}
