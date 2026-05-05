import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";

type TargetType = "sequence" | "campaign" | "none";
export type OutreachSourceTable = "companies" | "contacts" | "contact_people";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ids: string[];
  sourceTable: OutreachSourceTable;
}

export function SendToOutreachDialog({ open, onOpenChange, ids, sourceTable }: Props) {
  const [targetType, setTargetType] = useState<TargetType>("none");
  const [targetId, setTargetId] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data } = await supabase
        .from("outreach_settings")
        .select("default_target_type, default_target_id")
        .limit(1)
        .maybeSingle();
      if (data) {
        setTargetType((data.default_target_type as TargetType) ?? "none");
        setTargetId(data.default_target_id ?? "");
      }
    })();
  }, [open]);

  const send = async () => {
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-to-outreach", {
        body: {
          ids,
          source_table: sourceTable,
          target: { type: targetType, id: targetType === "none" ? "" : targetId.trim() },
        },
      });
      if (error) throw error;
      const result = data as any;
      if (result?.error) throw new Error(result.error);
      const inserted = result?.inserted ?? 0;
      const skipped = result?.skipped ?? 0;
      const errs = result?.errors ?? [];
      if (errs.length > 0) toast.error(`Skickat ${inserted}, hoppades över ${skipped}, fel: ${errs[0]}`);
      else toast.success(`Skickat ${inserted} leads till Outreach (${skipped} hoppades över)`);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Kunde inte skicka");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Skicka till Outreach</DialogTitle>
          <DialogDescription>
            {ids.length} {ids.length === 1 ? "rad" : "rader"} kommer skickas som leads.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label>Target type</Label>
            <Select value={targetType} onValueChange={(v) => setTargetType(v as TargetType)}>
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="sequence">Sequence</SelectItem>
                <SelectItem value="campaign">Campaign</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {targetType !== "none" && (
            <div>
              <Label htmlFor="tid">Target ID</Label>
              <Input id="tid" className="mt-1.5" value={targetId} onChange={(e) => setTargetId(e.target.value)} />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>Avbryt</Button>
          <Button onClick={send} disabled={sending || ids.length === 0}>
            {sending && <Loader2 className="h-4 w-4 animate-spin" />} Skicka
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
