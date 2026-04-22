import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface FilterChip {
  key: string;
  placeholder: string;
  width?: string;
  options: { value: string; label: string }[];
  allLabel?: string;
}

interface FilterBarProps {
  search: string;
  searchPlaceholder?: string;
  onSearchChange: (v: string) => void;
  chips: FilterChip[];
  values: Record<string, string>;
  onChipChange: (key: string, value: string) => void;
  from?: string;
  onFromChange?: (v: string) => void;
  hasActive: boolean;
  onClear: () => void;
}

export function FilterBar({
  search,
  searchPlaceholder = "Search...",
  onSearchChange,
  chips,
  values,
  onChipChange,
  from,
  onFromChange,
  hasActive,
  onClear,
}: FilterBarProps) {
  return (
    <div className="flex flex-wrap gap-3 items-center">
      <div className="relative flex-1 min-w-[220px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder={searchPlaceholder}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
      {chips.map((c) => (
        <Select key={c.key} value={values[c.key] ?? "all"} onValueChange={(v) => onChipChange(c.key, v)}>
          <SelectTrigger className={c.width ?? "w-[160px]"}>
            <SelectValue placeholder={c.placeholder} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{c.allLabel ?? `All ${c.placeholder.toLowerCase()}`}</SelectItem>
            {c.options.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ))}
      {onFromChange && (
        <Input
          type="date"
          className="w-[150px]"
          value={(from ?? "").slice(0, 10)}
          onChange={(e) => onFromChange(e.target.value ? e.target.value + "T00:00:00.000Z" : "")}
        />
      )}
      {hasActive && (
        <Button variant="ghost" size="sm" onClick={onClear}>Clear filters</Button>
      )}
    </div>
  );
}
