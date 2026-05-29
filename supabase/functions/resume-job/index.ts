// resume-job: centralized, idempotent restart of ONE crawl job.
// - clears paused state, sets status = running
// - resets failed/unresolved domains for this job's companies
// - kicks off resolve-domains-batch (retryFailed) and scrape-emails-batch
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const { jobId } = await req.json();
    if (!jobId) {
      return new Response(JSON.stringify({ error: "jobId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: job, error: jobErr } = await supabase
      .from("crawl_jobs").select("*").eq("id", jobId).maybeSingle();
    if (jobErr || !job) {
      return new Response(JSON.stringify({ error: "Job not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1) Clear paused_reason in meta_json, set status = running
    const currentMeta = (job.meta_json ?? {}) as Record<string, unknown>;
    const { paused_reason: _r, paused_at: _a, stalled_at: _s, ...restMeta } = currentMeta;

    await supabase.from("crawl_jobs").update({
      status: "running",
      last_run_at: new Date().toISOString(),
      meta_json: restMeta,
    }).eq("id", jobId);

    // 2) Find this job's companies via imports → import_rows → matched_company_id
    const { data: imports } = await supabase.from("imports").select("id").eq("crawl_job_id", jobId);
    const importIds = (imports ?? []).map((i: any) => i.id);

    let resetCount = 0;
    let pendingCount = 0;

    if (importIds.length > 0) {
      const companyIds: string[] = [];
      const PAGE = 1000;
      let from = 0;
      while (true) {
        const { data: page } = await supabase
          .from("import_rows")
          .select("matched_company_id")
          .in("import_id", importIds)
          .not("matched_company_id", "is", null)
          .range(from, from + PAGE - 1);
        const list = page ?? [];
        for (const r of list as any[]) if (r.matched_company_id) companyIds.push(r.matched_company_id);
        if (list.length < PAGE) break;
        from += PAGE;
      }
      const unique = Array.from(new Set(companyIds));

      // Reset failed → unresolved (chunked)
      const CHUNK = 200;
      for (let i = 0; i < unique.length; i += CHUNK) {
        const slice = unique.slice(i, i + CHUNK);
        const { data: updated } = await supabase
          .from("companies")
          .update({ domain_status: "unresolved" })
          .in("id", slice)
          .is("domain", null)
          .eq("domain_status", "failed")
          .select("id");
        resetCount += (updated ?? []).length;
      }

      // Count companies still without domain (pending resolution)
      for (let i = 0; i < unique.length; i += CHUNK) {
        const slice = unique.slice(i, i + CHUNK);
        const { data: pending } = await supabase
          .from("companies")
          .select("id")
          .in("id", slice)
          .is("domain", null);
        pendingCount += (pending ?? []).length;
      }
    }

    await supabase.from("crawl_logs").insert({
      crawl_job_id: jobId, level: "info",
      message: `Resume: reset ${resetCount} failed domains, ${pendingCount} pending resolution. Starting resolver + scraper.`,
      meta_json: { event: "job_resumed", reset: resetCount, pending: pendingCount },
    });

    // 3) Fire-and-forget: resolver (with retryFailed), then scraper
    const headers = { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };

    const work = (async () => {
      // Kick the resolver first (only if there's anything to resolve)
      if (pendingCount > 0) {
        try {
          await fetch(`${SUPABASE_URL}/functions/v1/resolve-domains-batch`, {
            method: "POST", headers,
            body: JSON.stringify({ jobId, retryFailed: true }),
          });
        } catch (e: any) {
          await supabase.from("crawl_logs").insert({
            crawl_job_id: jobId, level: "error",
            message: `resume-job: failed to invoke resolver: ${e?.message ?? e}`,
          });
        }
      }
      // Always start the scraper — it polls for newly resolved domains
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/scrape-emails-batch`, {
          method: "POST", headers, body: JSON.stringify({ jobId }),
        });
      } catch (e: any) {
        await supabase.from("crawl_logs").insert({
          crawl_job_id: jobId, level: "error",
          message: `resume-job: failed to invoke scraper: ${e?.message ?? e}`,
        });
      }
    })();

    // @ts-ignore EdgeRuntime
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(work);
    }

    return new Response(JSON.stringify({
      jobId, status: "running", resetFailed: resetCount, pendingResolution: pendingCount,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
