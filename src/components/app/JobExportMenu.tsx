import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { ExportFormat, JobExportDataset } from "@/lib/exporters";

interface Props {
  onExport: (dataset: JobExportDataset, format: ExportFormat) => void;
  size?: "sm" | "default";
  disabled?: boolean;
  label?: string;
}

// Export menu for job results: lets the user pick which dataset(s) to export.
// People = contact persons (name, role, personal email, phone).
// Company contacts = generic emails, phones, contact forms.
export function JobExportMenu({ onExport, size = "sm", disabled, label = "Export" }: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size={size} disabled={disabled}><Download className="h-4 w-4" /> {label}</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>People (names, roles, emails)</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => onExport("people", "csv")}>CSV</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onExport("people", "xlsx")}>XLSX</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Company contacts</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => onExport("contacts", "csv")}>CSV</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onExport("contacts", "xlsx")}>XLSX</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Both (zip, two files per job)</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => onExport("both", "csv")}>CSV</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onExport("both", "xlsx")}>XLSX</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
