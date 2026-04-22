import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SectionCard } from "@/components/app/SectionCard";
import { EmptyState } from "@/components/app/EmptyState";
import { fmtRelative } from "@/lib/format";
import type { SourcePageRow } from "@/lib/api";

export function JobSourcePagesTab({ pages }: { pages: SourcePageRow[] }) {
  return (
    <SectionCard title="Source pages crawled" noPadding>
      {pages.length === 0 ? <EmptyState description="No pages crawled yet." /> : (
        <Table>
          <TableHeader><TableRow><TableHead>URL</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead>Crawled</TableHead></TableRow></TableHeader>
          <TableBody>
            {pages.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-mono text-xs truncate max-w-[400px]">{p.url}</TableCell>
                <TableCell className="text-muted-foreground">{p.pageType}</TableCell>
                <TableCell className="text-muted-foreground">{p.statusCode ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground text-sm">{fmtRelative(p.crawledAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </SectionCard>
  );
}
