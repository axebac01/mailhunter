// job-watchdog: server-side keep-alive for running crawl jobs.
// Called every minute by pg_cron. Restarts the batch worker for any job that
// is 'running' but whose worker heartbeat has gone stale, so scraping keeps
// going with the browser tab closed.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STALE_MS = 3 * 60_000;        // heartbeat older than this → worker is gone
const MAX_RESTARTS_PER_HOUR = 6;    // loop guard per job

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const headers = { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };

  try {
    const { data: jobs } = await supabase
      .from("crawl_jobs")
      .select("id, name, status, source_type, meta_json")
      .eq("status", "running");

    const checked = jobs ?? [];
    const restarted: string[] = [];
    const skipped: string[] = [];

    for (const job of checked as any[]) {
      const meta = (job.meta_json as Record<string, any> | null) ?? {};

      // Never touch jobs parked for a reason (credits, user pause, etc.)
      if (meta.paused_reason) { skipped.push(job.id); continue; }

      const hb = meta.worker_heartbeat ? Date.parse(String(meta.worker_heartbeat)) : 0;
      const age = hb ? Date.now() - hb : Number.POSITIVE_INFINITY;
      if (age < STALE_MS) { skipped.push(job.id); continue; }

      // Loop guard: cap restarts per rolling hour, then pause with a reason.
      const history: number[] = Array.isArray(meta.watchdog_restarts) ? meta.watchdog_restarts : [];
      const recent = history.filter((t) => Date.now() - t < 60 * 60_000);
      if (recent.length >= MAX_RESTARTS_PER_HOUR) {
        await supabase.from("crawl_jobs").update({
          status: "paused",
          meta_json: { ...meta, paused_reason: "stalled", paused_at: new Date().toISOString(), watchdog_restarts: recent },
        }).eq("id", job.id);
        await supabase.from("crawl_logs").insert({
          crawl_job_id: job.id, level: "error",
          message: `Watchdog: worker restarted ${recent.length} times in the last hour without finishing — pausing the job. Press Start to try again.`,
          meta_json: { event: "watchdog_paused", restarts: recent.length },
        });
        skipped.push(job.id);
        continue;
      }

      recent.push(Date.now());
      const { worker_id: _w, worker_heartbeat: _h, ...rest } = meta;
      await supabase.from("crawl_jobs").update({
        meta_json: { ...rest, watchdog_restarts: recent, watchdog_last_restart: new Date().toISOString() },
      }).eq("id", job.id);

      await supabase.from("crawl_logs").insert({
        crawl_job_id: job.id, level: "warn",
        message: `Watchdog: no worker heartbeat for ${Number.isFinite(age) ? Math.round(age / 1000) + "s" : "a while"} — restarting the scraper.`,
        meta_json: { event: "watchdog_restart", heartbeat_age_ms: Number.isFinite(age) ? age : null },
      });

      // Kick the resolver too when companies still lack a domain.
      try {
        const { data: stats } = await supabase.rpc("job_domain_stats", { job_id: job.id });
        const row = Array.isArray(stats) ? stats[0] : stats;
        const pending = Number(row?.unresolved ?? 0) + Number(row?.failed ?? 0);
        if (pending > 0) {
          await fetch(`${SUPABASE_URL}/functions/v1/resolve-domains-batch`, {
            method: "POST", headers,
            body: JSON.stringify({ jobId: job.id, retryFailed: true, includeUnresolved: true }),
          });
        }
      } catch (e: any) {
        await supabase.from("crawl_logs").insert({
          crawl_job_id: job.id, level: "error",
          message: `Watchdog: failed to invoke resolver: ${e?.message ?? e}`,
        });
      }

      try {
        await fetch(`${SUPABASE_URL}/functions/v1/scrape-emails-batch`, {
          method: "POST", headers, body: JSON.stringify({ jobId: job.id }),
        });
        restarted.push(job.id);
      } catch (e: any) {
        await supabase.from("crawl_logs").insert({
          crawl_job_id: job.id, level: "error",
          message: `Watchdog: failed to invoke scraper: ${e?.message ?? e}`,
        });
      }
    }

    return new Response(JSON.stringify({ checked: checked.length, restarted, skipped: skipped.length }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
