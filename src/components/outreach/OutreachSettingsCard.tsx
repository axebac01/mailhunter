import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { SectionCard } from "@/components/app/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Send } from "lucide-react";

type TargetType = "sequence" | "campaign" | "none";

export function OutreachSettingsCard() {
  const [id, setId] = useState<string | null>(null);
  const [endpointUrl, setEndpointUrl] = useState("");
  const [targetType, setTargetType] = useState<TargetType>("none");
  const [targetId, setTargetId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("outreach_settings")
        .select("id, endpoint_url, default_target_type, default_target_id")
        .limit(1)
        .maybeSingle();
      if (data) {
        setId(data.id);
        setEndpointUrl(data.endpoint_url ?? "");
        setTargetType((data.default_target_type as TargetType) ?? "none");
        setTargetId(data.default_target_id ?? "");
      }
      setLoading(false);
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        endpoint_url: endpointUrl.trim() || null,
        default_target_type: targetType,
        default_target_id: targetType === "none" ? null : targetId.trim() || null,
      };
      if (id) {
        const { error } = await supabase.from("outreach_settings").update(payload).eq("id", id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("outreach_settings").insert(payload).select("id").single();
        if (error) throw error;
        setId(data.id);
      }
      toast.success("Outreach-inställningar sparade");
    } catch (e: any) {
      toast.error(e?.message ?? "Kunde inte spara");
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-to-outreach", {
        body: { ids: [], source_table: "companies", target: { type: "none" } },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const errs = (data as any)?.errors ?? [];
      if (errs.length > 0) toast.error(`Test misslyckades: ${errs[0]}`);
      else toast.success("Anslutning OK ✔");
    } catch (e: any) {
      toast.error(e?.message ?? "Test misslyckades");
    } finally {
      setTesting(false);
    }
  };

  return (
    <SectionCard
      title="Outreach integration"
      description="Skicka leads till din andra Lovable-app. API-nyckeln lagras säkert som en backend-secret (OUTREACH_API_KEY)."
    >
      {loading ? (
        <p className="text-sm text-muted-foreground">Laddar…</p>
      ) : (
        <div className="space-y-4">
          <div>
            <Label htmlFor="endpoint">Endpoint URL</Label>
            <Input
              id="endpoint"
              className="mt-1.5"
              placeholder="https://din-outreach.lovable.app/functions/v1/ingest-leads"
              value={endpointUrl}
              onChange={(e) => setEndpointUrl(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Default target type</Label>
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
                <Label htmlFor="targetId">Default target ID</Label>
                <Input id="targetId" className="mt-1.5" value={targetId} onChange={(e) => setTargetId(e.target.value)} />
              </div>
            )}
          </div>
          <div className="flex gap-2 pt-2">
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Spara
            </Button>
            <Button variant="outline" onClick={testConnection} disabled={testing || !endpointUrl}>
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Testa anslutning
            </Button>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
