import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { TITLE_GROUPS, filterPeopleForExport, type PeopleFilterOptions } from "@/lib/exporters";
import type { PersonRow } from "@/lib/api";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (opts: PeopleFilterOptions) => void;
  /** When provided (single-job export), shows a live count of matching rows. */
  people?: PersonRow[];
}

// Options dialog shown before exporting people: title filter + max one per company.
export function PeopleExportOptionsDialog({ open, onOpenChange, onConfirm, people }: Props) {
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [includeUntitled, setIncludeUntitled] = useState(true);
  const [maxOne, setMaxOne] = useState(false);

  // Reset to defaults each time the dialog opens
  useEffect(() => {
    if (open) {
      setSelectedGroups(new Set());
      setIncludeUntitled(true);
      setMaxOne(false);
    }
  }, [open]);

  const opts: PeopleFilterOptions = {
    titleGroupIds: Array.from(selectedGroups),
    includeUntitled,
    maxOnePerCompany: maxOne,
  };
  const matchCount = people ? filterPeopleForExport(people, opts).length : null;
  const anyGroupSelected = selectedGroups.size > 0;

  const toggle = (id: string, checked: boolean) => {
    setSelectedGroups((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>People export options</DialogTitle>
          <DialogDescription>
            Choose which people to include. With no title selected, everyone is exported.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Filter by title</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setSelectedGroups(new Set(TITLE_GROUPS.map((g) => g.id)))}
            >
              Decision-makers only
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-2">
            {TITLE_GROUPS.map((g) => (
              <div key={g.id} className="flex items-center gap-2">
                <Checkbox
                  id={`tg-${g.id}`}
                  checked={selectedGroups.has(g.id)}
                  onCheckedChange={(v) => toggle(g.id, v === true)}
                />
                <Label htmlFor={`tg-${g.id}`} className="text-sm font-normal cursor-pointer">{g.label}</Label>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <Checkbox
                id="tg-untitled"
                checked={!anyGroupSelected || includeUntitled}
                disabled={!anyGroupSelected}
                onCheckedChange={(v) => setIncludeUntitled(v === true)}
              />
              <Label htmlFor="tg-untitled" className="text-sm font-normal cursor-pointer text-muted-foreground">
                Include people without a title (found via email address)
              </Label>
            </div>
          </div>

          <div className="border-t border-border" />

          <div className="flex items-start gap-2">
            <Checkbox id="max-one" checked={maxOne} onCheckedChange={(v) => setMaxOne(v === true)} className="mt-0.5" />
            <div>
              <Label htmlFor="max-one" className="text-sm font-normal cursor-pointer">Max one person per company</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Keeps the best match per company: decision-maker first, then people with an email, then highest email confidence.
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          {matchCount !== null && (
            <span className="text-xs text-muted-foreground mr-auto">{matchCount} people will be exported</span>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => onConfirm(opts)}>Export</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
