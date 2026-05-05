import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

function domainFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const orgNrs: string[] = Array.isArray(body?.org_nrs) ? body.org_nrs.filter((x: any) => typeof x === "string") : [];
    if (orgNrs.length === 0) return json({ error: "org_nrs required" }, 400);
    if (orgNrs.length > 5000) return json({ error: "Max 5000 per request" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: source, error: sErr } = await supabase
      .from("se_companies")
      .select("org_nr, name, website, sni_text, county, municipality")
      .in("org_nr", orgNrs);
    if (sErr) return json({ error: `se_companies query failed: ${sErr.message}` }, 500);

    // Hämta styrelseledamöter för dessa bolag
    const { data: board } = await supabase
      .from("se_board_members")
      .select("org_nr, name, role")
      .in("org_nr", orgNrs);
    const boardByOrg = new Map<string, { name: string; role: string | null }[]>();
    for (const b of board ?? []) {
      if (!boardByOrg.has(b.org_nr)) boardByOrg.set(b.org_nr, []);
      boardByOrg.get(b.org_nr)!.push({ name: b.name, role: b.role });
    }

    let inserted = 0;
    let skipped = 0;
    let peopleInserted = 0;
    const errors: string[] = [];

    for (const row of source ?? []) {
      const domain = domainFromUrl(row.website);
      try {
        let companyId: string | null = null;
        if (domain) {
          const { data: dup } = await supabase
            .from("companies")
            .select("id")
            .eq("domain", domain)
            .limit(1)
            .maybeSingle();
          if (dup) companyId = dup.id;
        }
        if (!companyId) {
          const { data: ins, error: iErr } = await supabase.from("companies").insert({
            name: row.name,
            website: row.website ?? null,
            domain,
            country: "Sverige",
            industry: row.sni_text ?? null,
            domain_status: domain ? "resolved" : "unresolved",
            notes: `org.nr: ${row.org_nr}${row.municipality ? ` · ${row.municipality}` : ""}`,
          }).select("id").single();
          if (iErr) throw iErr;
          companyId = ins.id;
          inserted++;
        } else {
          skipped++;
        }

        // Lägg till styrelseledamöter som contact_people
        const members = boardByOrg.get(row.org_nr) ?? [];
        if (members.length && companyId) {
          const peopleRows = members.slice(0, 50).map((m) => ({
            company_id: companyId,
            full_name: m.name,
            role_title: m.role,
            source_url: `bolagsverket://${row.org_nr}`,
          }));
          const { error: pErr } = await supabase.from("contact_people").insert(peopleRows);
          if (!pErr) peopleInserted += peopleRows.length;
        }
      } catch (e: any) {
        errors.push(`${row.org_nr}: ${e?.message ?? e}`);
      }
    }

    return json({ inserted, skipped, peopleInserted, errors, requested: orgNrs.length, found: source?.length ?? 0 });
  } catch (e: any) {
    return json({ error: e?.message ?? "Unknown error" }, 500);
  }
});
