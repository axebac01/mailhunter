import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SectionCard } from "@/components/app/SectionCard";
import { EmptyState } from "@/components/app/EmptyState";
import { ContactTypeBadge } from "@/components/app/StatusBadge";
import { fmtRelative } from "@/lib/format";
import type { ContactRow, JobRow } from "@/lib/api";

interface Props {
  jobId: string;
  contacts: ContactRow[];
  allJobs: JobRow[];
  filter: string;
  onFilterChange: (v: string) => void;
}

export function JobContactsTab({ jobId, contacts, allJobs, filter, onFilterChange }: Props) {
  return (
    <SectionCard title="Contact records" noPadding>
      <div className="flex items-center gap-3 px-5 py-3 border-b border-border">
        <Select value={filter} onValueChange={onFilterChange}>
          <SelectTrigger className="w-[280px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={jobId}>This job</SelectItem>
            <SelectItem value="all">All jobs</SelectItem>
            {allJobs.filter((x) => x.id !== jobId).map((x) => (
              <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{contacts.length} record{contacts.length === 1 ? "" : "s"}</span>
      </div>
      {contacts.length === 0 ? <EmptyState description="No contacts yet for this job." /> : (
        <Table>
          <TableHeader><TableRow><TableHead>Company</TableHead><TableHead>Type</TableHead><TableHead>Value</TableHead><TableHead>Source</TableHead><TableHead>Found</TableHead></TableRow></TableHeader>
          <TableBody>
            {contacts.slice(0, 100).map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.companyName}</TableCell>
                <TableCell><ContactTypeBadge type={c.contactType} /></TableCell>
                <TableCell className="font-mono text-xs">{c.contactValue}</TableCell>
                <TableCell className="text-muted-foreground text-xs truncate max-w-[200px]">{c.sourceUrl}</TableCell>
                <TableCell className="text-muted-foreground text-sm">{fmtRelative(c.foundAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </SectionCard>
  );
}
