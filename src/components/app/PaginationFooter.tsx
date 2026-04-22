import { Button } from "@/components/ui/button";

interface Props {
  visibleCount: number;
  totalCount: number;
  selectedCount?: number;
  page: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
}

export function PaginationFooter({ visibleCount, totalCount, selectedCount = 0, page, totalPages, onPrev, onNext }: Props) {
  return (
    <div className="flex items-center justify-between p-3 border-t border-border text-sm">
      <span className="text-muted-foreground">
        Showing {visibleCount} of {totalCount} ({selectedCount} selected)
      </span>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={page === 1} onClick={onPrev}>Previous</Button>
        <span className="text-muted-foreground">Page {page} of {totalPages}</span>
        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={onNext}>Next</Button>
      </div>
    </div>
  );
}
