import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SectionCard } from "@/components/app/SectionCard";
import { EmptyState } from "@/components/app/EmptyState";
import { fmtRelative } from "@/lib/format";
import type { PersonRow } from "@/lib/api";

export function JobPeopleTab({ people }: { people: PersonRow[] }) {
  return (
    <SectionCard title="People records" noPadding>
      {people.length === 0 ? <EmptyState description="No people records yet for this job." /> : (
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Role</TableHead><TableHead>Department</TableHead><TableHead>Company</TableHead><TableHead>Found</TableHead></TableRow></TableHeader>
          <TableBody>
            {people.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.fullName}</TableCell>
                <TableCell>{p.roleTitle ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">{p.department ?? "—"}</TableCell>
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
