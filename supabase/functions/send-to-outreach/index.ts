import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type SourceTable = "companies" | "contacts" | "contact_people";
type TargetType = "sequence" | "campaign" | "none";

interface ReqBody {
  ids: string[];
  source_table: SourceTable;
  target?: { type: TargetType; id?: string };
}

interface Lead {
  email?: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  role?: string;
  phone?: string;
  website?: string;
  linkedin_url?: string;
  notes?: string;
}

function splitName(full: string | null | undefined): { first: string; last: string } {
  if (!full) return { first: "", last: "" };
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = (await req.json()) as ReqBody;
    if (!body || !Array.isArray(body.ids) || !body.source_table) {
      return jsonResponse({ error: "Invalid body. Expected { ids, source_table, target? }" }, 400);
    }
    if (!["companies", "contacts", "contact_people"].includes(body.source_table)) {
      return jsonResponse({ error: "Invalid source_table" }, 400);
    }

    const apiKey = Deno.env.get("OUTREACH_API_KEY");
    if (!apiKey) return jsonResponse({ error: "OUTREACH_API_KEY is not configured" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Load settings
    const { data: settings, error: settingsErr } = await supabase
      .from("outreach_settings")
      .select("endpoint_url, default_target_type, default_target_id")
      .limit(1)
      .maybeSingle();
    if (settingsErr) return jsonResponse({ error: `Settings load failed: ${settingsErr.message}` }, 500);
    if (!settings?.endpoint_url) return jsonResponse({ error: "Outreach endpoint URL is not configured in Settings" }, 400);

    const target = body.target ?? {
      type: (settings.default_target_type ?? "none") as TargetType,
      id: settings.default_target_id ?? undefined,
    };

    // Build leads
    let leads: Lead[] = [];
    let skipped = 0;

    if (body.ids.length > 0) {
      if (body.source_table === "contacts") {
        const { data, error } = await supabase
          .from("contacts")
          .select("id, value, contact_type, source_url, company_id, companies(name, website, domain)")
          .in("id", body.ids)
          .eq("contact_type", "generic_email");
        if (error) return jsonResponse({ error: `contacts query failed: ${error.message}` }, 500);
        skipped += body.ids.length - (data?.length ?? 0);
        leads = (data ?? []).map((c: any) => ({
          email: c.value,
          company: c.companies?.name,
          website: c.companies?.website ?? undefined,
          notes: `Generic email from ${c.companies?.name ?? ""}`.trim(),
        }));
      } else if (body.source_table === "contact_people") {
        const { data, error } = await supabase
          .from("contact_people")
          .select("id, full_name, role_title, source_url, company_id, companies(name, website, domain)")
          .in("id", body.ids);
        if (error) return jsonResponse({ error: `contact_people query failed: ${error.message}` }, 500);
        leads = (data ?? []).map((p: any) => {
          const { first, last } = splitName(p.full_name);
          return {
            full_name: p.full_name,
            first_name: first,
            last_name: last,
            role: p.role_title ?? undefined,
            company: p.companies?.name,
            website: p.companies?.website ?? undefined,
          };
        });
      } else {
        // companies → first generic email per company
        const { data: comps, error: cErr } = await supabase
          .from("companies")
          .select("id, name, website")
          .in("id", body.ids);
        if (cErr) return jsonResponse({ error: `companies query failed: ${cErr.message}` }, 500);
        const { data: emails, error: eErr } = await supabase
          .from("contacts")
          .select("company_id, value, found_at")
          .in("company_id", body.ids)
          .eq("contact_type", "generic_email")
          .order("found_at", { ascending: true });
        if (eErr) return jsonResponse({ error: `email lookup failed: ${eErr.message}` }, 500);
        const firstByCompany = new Map<string, string>();
        for (const e of emails ?? []) {
          if (!firstByCompany.has(e.company_id)) firstByCompany.set(e.company_id, e.value);
        }
        for (const c of comps ?? []) {
          const email = firstByCompany.get(c.id);
          if (!email && target.type !== "none") { skipped++; continue; }
          leads.push({ email, company: c.name, website: c.website ?? undefined });
        }
      }
    }

    // POST in batches of 500
    const batches: Lead[][] = [];
    if (leads.length === 0) {
      batches.push([]); // ping
    } else {
      for (let i = 0; i < leads.length; i += 500) batches.push(leads.slice(i, i + 500));
    }

    let inserted = 0;
    const errors: string[] = [];
    let lastResponse: any = null;

    for (const batch of batches) {
      try {
        const res = await fetch(settings.endpoint_url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            source: "company-intel-hub",
            target: { type: target.type, id: target.id ?? "" },
            leads: batch,
          }),
        });
        const text = await res.text();
        let parsed: any = null;
        try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
        lastResponse = parsed ?? { status: res.status };
        if (!res.ok) {
          errors.push(`HTTP ${res.status}: ${text.slice(0, 200)}`);
        } else {
          inserted += typeof parsed?.inserted === "number" ? parsed.inserted : batch.length;
        }
      } catch (e: any) {
        errors.push(e?.message ?? String(e));
      }
    }

    // Log
    await supabase.from("outreach_send_log").insert({
      source_table: body.source_table,
      count: leads.length,
      inserted,
      skipped,
      errors: errors.length,
      target_type: target.type,
      target_id: target.id ?? null,
      response_summary: { lastResponse, errors: errors.slice(0, 5) },
    });

    return jsonResponse({ inserted, skipped, errors, sent: leads.length });
  } catch (e: any) {
    console.error("[send-to-outreach] fatal", e);
    return jsonResponse({ error: e?.message ?? "Unknown error" }, 500);
  }
});
