import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export type ExportScope = "all" | "filtered" | "selected";
export type ExportFormat = "csv" | "xlsx";

interface Props {
  selectedCount?: number;
  onExport: (scope: ExportScope, format: ExportFormat) => void;
  size?: "sm" | "default";
  disableSelected?: boolean;
}

export function ExportButton({ selectedCount = 0, onExport, size = "sm", disableSelected }: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size={size}><Download className="h-4 w-4" /> Export</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>CSV</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => onExport("all", "csv")}>All rows</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onExport("filtered", "csv")}>Filtered rows</DropdownMenuItem>
        <DropdownMenuItem disabled={disableSelected || selectedCount === 0} onClick={() => onExport("selected", "csv")}>
          Selected ({selectedCount})
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>XLSX</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => onExport("all", "xlsx")}>All rows</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onExport("filtered", "xlsx")}>Filtered rows</DropdownMenuItem>
        <DropdownMenuItem disabled={disableSelected || selectedCount === 0} onClick={() => onExport("selected", "xlsx")}>
          Selected ({selectedCount})
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
