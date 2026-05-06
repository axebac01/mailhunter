import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-import-token",
};

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status: s,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const expected = Deno.env.get("SE_IMPORT_KEY");
    if (!expected) return json({ error: "SE_IMPORT_KEY not configured" }, 500);
    const token = req.headers.get("x-import-token");
    if (token !== expected) return json({ error: "Unauthorized" }, 401);

    const body = await req.json();
    const kind = body?.kind as string;
    const rows = body?.rows;
    if (!Array.isArray(rows) || rows.length === 0) return json({ error: "rows required" }, 400);
    if (rows.length > 2000) return json({ error: "Max 2000 rows per request" }, 400);

    const fnMap: Record<string, string> = {
      companies: "ingest_se_companies",
      bokslut: "ingest_se_bokslut",
      board: "ingest_se_board",
    };
    const rpc = fnMap[kind];
    if (!rpc) return json({ error: `unknown kind: ${kind}` }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data, error } = await supabase.rpc(rpc, { p: rows });
    if (error) return json({ error: error.message }, 500);
    return json({ kind, affected: data ?? 0, received: rows.length });
  } catch (e: any) {
    return json({ error: e?.message ?? "unknown" }, 500);
  }
});
