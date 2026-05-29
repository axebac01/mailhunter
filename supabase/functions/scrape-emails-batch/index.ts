// Batch email scraping: invoke once per job, scrapes companies in WAVES as
// their domains resolve. Self re-invokes every ~15s while there are still
// pending domain resolutions OR un-scraped companies. Only marks the job
// completed when both resolution and scraping are fully done.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const CONCURRENCY = 6;
const PER_COMPANY_TIMEOUT_MS = 45_000;
const REINVOKE_DELAY_MS = 15_000;
const STALL_WAVE_LIMIT = 20; // ~5 min of no progress → auto-pause
const RESOLVER_KICK_AFTER_WAVES = 2; // ~30s pending without movement → re-kick resolver

async function runPool<T>(items: T[], worker: (i: T) => Promise<void>, n: number): Promise<void> {
  let idx = 0;
  const runners = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (idx < items.length) {
      const my = idx++;
      try { await worker(items[my]); } catch { /* swallow per-item */ }
    }
  });
  await Promise.all(runners);
}

function scheduleReinvoke(SUPABASE_URL: string, SERVICE_KEY: string, jobId: string) {
  const work = (async () => {
    await new Promise((r) => setTimeout(r, REINVOKE_DELAY_MS));
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/scrape-emails-batch`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
    } catch { /* best effort */ }
  })();
  // @ts-ignore EdgeRuntime
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(work);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
    if (!apiKey) throw new Error("FIRECRAWL_API_KEY is not configured");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const { jobId } = await req.json();
    if (!jobId) {
      return new Response(JSON.stringify({ error: "jobId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: job } = await supabase.from("crawl_jobs").select("*").eq("id", jobId).maybeSingle();
    if (!job) {
      return new Response(JSON.stringify({ error: "Job not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Stop if user paused/stopped the job
    if (job.status !== "running") {
      await supabase.from("crawl_logs").insert({
        crawl_job_id: jobId, level: "info",
        message: `Scraping ${job.status} by user — worker exiting, no re-invoke scheduled.`,
      });
      return new Response(JSON.stringify({ skipped: true, reason: `status=${job.status}` }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Companies linked via this job's imports
    const { data: imports } = await supabase.from("imports").select("id").eq("crawl_job_id", jobId);
    const importIds = (imports ?? []).map((i: any) => i.id);
    if (importIds.length === 0) {
      await supabase.from("crawl_logs").insert({ crawl_job_id: jobId, level: "warn", message: "No imports linked to this job — nothing to scrape." });
      await supabase.from("crawl_jobs").update({ status: "completed", progress: 100 }).eq("id", jobId);
      return new Response(JSON.stringify({ scraped: 0, total: 0 }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Collect all matched company ids for this job's imports
    const allCompanyIds: string[] = [];
    {
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
        for (const r of list as any[]) if (r.matched_company_id) allCompanyIds.push(r.matched_company_id);
        if (list.length < PAGE) break;
        from += PAGE;
      }
    }
    const ids = Array.from(new Set(allCompanyIds));

    if (ids.length === 0) {
      await supabase.from("crawl_logs").insert({ crawl_job_id: jobId, level: "warn", message: "No matched companies for this job — nothing to scrape." });
      await supabase.from("crawl_jobs").update({ status: "completed", progress: 100 }).eq("id", jobId);
      return new Response(JSON.stringify({ scraped: 0, total: 0 }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Batch fetch companies (URL length safety)
    const CHUNK = 100;
    const allCompanies: any[] = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      const { data: chunk } = await supabase.from("companies")
        .select("id, name, domain, domain_status").in("id", slice);
      if (chunk) allCompanies.push(...chunk);
    }

    // Already scraped = has any source_pages row for this job
    const scrapedIds = new Set<string>();
    {
      const PAGE = 1000;
      let from = 0;
      while (true) {
        const { data: page } = await supabase
          .from("source_pages")
          .select("company_id")
          .eq("crawl_job_id", jobId)
          .range(from, from + PAGE - 1);
        const list = page ?? [];
        for (const r of list as any[]) scrapedIds.add(r.company_id);
        if (list.length < PAGE) break;
        from += PAGE;
      }
    }

    const withDomain = allCompanies.filter((c: any) => c.domain);
    const pendingResolution = allCompanies.filter((c: any) => !c.domain && c.domain_status !== "failed");
    const failedResolution = allCompanies.filter((c: any) => !c.domain && c.domain_status === "failed");
    const todo = withDomain.filter((c: any) => !scrapedIds.has(c.id));
    const alreadyScraped = withDomain.length - todo.length;

    await supabase.from("crawl_logs").insert({
      crawl_job_id: jobId, level: "info",
      message: `Wave start: ${todo.length} to scrape (${alreadyScraped} already done), ${pendingResolution.length} awaiting domain resolution, ${failedResolution.length} no domain.`,
    });

    // Refresh counters helper
    const refreshCounters = async (scrapedCountTotal: number) => {
      const [{ count: contactsCount }, { count: peopleCount }, { count: pagesCount }] = await Promise.all([
        supabase.from("contacts").select("id", { count: "exact", head: true }).eq("crawl_job_id", jobId),
        supabase.from("contact_people").select("id", { count: "exact", head: true }).eq("crawl_job_id", jobId),
        supabase.from("source_pages").select("id", { count: "exact", head: true }).eq("crawl_job_id", jobId),
      ]);
      // Progress = scraped / (resolvable companies). If still resolving, cap at 95%.
      const denom = Math.max(1, withDomain.length + pendingResolution.length);
      const stillPending = pendingResolution.length > 0;
      let progress = Math.round((scrapedCountTotal / denom) * 100);
      if (stillPending && progress > 95) progress = 95;
      progress = Math.min(99, progress);
      await supabase.from("crawl_jobs").update({
        progress, companies_found: scrapedCountTotal,
        contacts_found: contactsCount ?? 0,
        people_found: peopleCount ?? 0,
        pages_crawled: pagesCount ?? 0,
      }).eq("id", jobId);
    };

    // Nothing to scrape this wave?
    if (todo.length === 0) {
      if (pendingResolution.length > 0) {
        // Belt-and-suspenders: if the resolver auto-paused for payment, exit
        // even if our cached `job.status` snapshot still says "running".
        const { data: fresh } = await supabase
          .from("crawl_jobs").select("status, meta_json").eq("id", jobId).maybeSingle();
        const meta = (fresh?.meta_json as Record<string, unknown> | null) ?? {};
        const reason = meta.paused_reason;
        if (fresh?.status !== "running" || reason === "firecrawl_payment_required") {
          await supabase.from("crawl_logs").insert({
            crawl_job_id: jobId, level: "warn",
            message: `Worker exiting — job ${fresh?.status ?? "unknown"}${reason ? ` (reason: ${reason})` : ""}. No re-invoke scheduled.`,
          });
          return new Response(JSON.stringify({ skipped: true, reason: String(reason ?? fresh?.status) }), {
            status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Watchdog: track stall + auto-kick resolver when nothing is moving
        const lastPending = Number(meta.watchdog_last_pending ?? -1);
        const idleWaves = Number(meta.watchdog_idle_waves ?? 0);
        const noProgress = lastPending === pendingResolution.length;
        const nextIdleWaves = noProgress ? idleWaves + 1 : 0;

        // Stall protection: auto-pause after STALL_WAVE_LIMIT waves of no progress
        if (nextIdleWaves >= STALL_WAVE_LIMIT) {
          await supabase.from("crawl_jobs").update({
            status: "paused",
            meta_json: { ...meta, paused_reason: "stalled", stalled_at: new Date().toISOString() },
          }).eq("id", jobId);
          await supabase.from("crawl_logs").insert({
            crawl_job_id: jobId, level: "error",
            message: `Auto-paused: no progress for ${STALL_WAVE_LIMIT} waves (~${Math.round(STALL_WAVE_LIMIT * REINVOKE_DELAY_MS / 1000)}s). ${pendingResolution.length} domains still pending. Click Start to retry.`,
          });
          return new Response(JSON.stringify({ stalled: true, pending: pendingResolution.length }), {
            status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Auto-kick resolver if it hasn't been moving the queue
        let kicked = false;
        if (nextIdleWaves >= RESOLVER_KICK_AFTER_WAVES && nextIdleWaves % RESOLVER_KICK_AFTER_WAVES === 0) {
          try {
            await fetch(`${SUPABASE_URL}/functions/v1/resolve-domains-batch`, {
              method: "POST",
              headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
              body: JSON.stringify({ jobId, retryFailed: true }),
            });
            kicked = true;
          } catch (_) { /* best effort */ }
        }

        // Persist watchdog counters
        await supabase.from("crawl_jobs").update({
          meta_json: { ...meta, watchdog_last_pending: pendingResolution.length, watchdog_idle_waves: nextIdleWaves },
        }).eq("id", jobId);

        await supabase.from("crawl_logs").insert({
          crawl_job_id: jobId, level: kicked ? "warn" : "info",
          message: kicked
            ? `Waiting on resolution: ${pendingResolution.length} pending. No movement for ${nextIdleWaves} waves — kicked resolver.`
            : `Waiting on domain resolution: ${pendingResolution.length} of ${allCompanies.length} still pending. Re-checking in ${Math.round(REINVOKE_DELAY_MS / 1000)}s.`,
        });
        await refreshCounters(scrapedIds.size);
        scheduleReinvoke(SUPABASE_URL, SERVICE_KEY, jobId);
        return new Response(JSON.stringify({ waiting: pendingResolution.length, scraped: scrapedIds.size, kickedResolver: kicked }), {
          status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Nothing pending and nothing to scrape → done.
      await refreshCounters(scrapedIds.size);
      await supabase.from("crawl_jobs").update({ status: "completed", progress: 100 }).eq("id", jobId);
      await supabase.from("crawl_logs").insert({ crawl_job_id: jobId, level: "success", message: `Scrape complete: ${scrapedIds.size} companies processed in total.` });
      return new Response(JSON.stringify({ scraped: scrapedIds.size, done: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let scrapedThisWave = 0;
    const totalScrapedSoFar = () => scrapedIds.size + scrapedThisWave;

    const work = (async () => {
      try {
        await runPool(todo, async (c: any) => {
          const { data: cur } = await supabase.from("crawl_jobs").select("status").eq("id", jobId).maybeSingle();
          if (cur?.status !== "running") return;

          await supabase.from("crawl_logs").insert({
            crawl_job_id: jobId, level: "info",
            message: `Starting ${c.name ?? c.domain}`,
            meta_json: { event: "company_started", company: c.name ?? c.domain, company_id: c.id, host: c.domain },
          });

          const startedAt = Date.now();
          let ok = true;
          try {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), PER_COMPANY_TIMEOUT_MS);
            const res = await fetch(`${SUPABASE_URL}/functions/v1/scrape-emails`, {
              method: "POST",
              headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                companyId: c.id, domain: c.domain, jobId,
                options: {
                  genericEmails: job.include_generic_emails,
                  personEmails: job.include_person_emails,
                  phones: job.include_phones,
                  contactForms: job.include_contact_forms,
                  personNames: job.include_contact_person_names,
                },
              }),
              signal: ctrl.signal,
            });
            clearTimeout(timer);
            if (!res.ok) {
              ok = false;
              const text = await res.text().catch(() => "");
              await supabase.from("crawl_logs").insert({
                crawl_job_id: jobId, level: "error",
                message: `Scrape failed for ${c.domain}: ${res.status} ${text.slice(0, 200)}`,
              });
            }
          } catch (e: any) {
            ok = false;
            const aborted = e?.name === "AbortError";
            await supabase.from("crawl_logs").insert({
              crawl_job_id: jobId, level: "error",
              message: aborted ? `Scrape timed out (>${PER_COMPANY_TIMEOUT_MS}ms) for ${c.domain}` : `Scrape threw for ${c.domain}: ${e?.message ?? e}`,
            });
          }
          await supabase.from("crawl_logs").insert({
            crawl_job_id: jobId, level: ok ? "info" : "warn",
            message: `Finished ${c.name ?? c.domain} in ${Math.round((Date.now() - startedAt) / 1000)}s`,
            meta_json: { event: "company_finished", company: c.name ?? c.domain, company_id: c.id, host: c.domain, ok, duration_ms: Date.now() - startedAt },
          });
          scrapedThisWave++;
          if (scrapedThisWave % 10 === 0) await refreshCounters(totalScrapedSoFar());
        }, CONCURRENCY);

        await refreshCounters(totalScrapedSoFar());

        // Re-check job status & whether more work is pending
        const { data: final } = await supabase.from("crawl_jobs").select("status").eq("id", jobId).maybeSingle();
        if (final?.status !== "running") {
          await supabase.from("crawl_logs").insert({
            crawl_job_id: jobId, level: "info",
            message: `Scraping ${final?.status ?? "halted"} by user after wave — not scheduling re-invoke.`,
          });
          return;
        }

        // Are there still companies awaiting domain resolution?
        const { data: stillCompanies } = await supabase
          .from("companies")
          .select("id, domain, domain_status")
          .in("id", ids.slice(0, 1)); // cheap probe; we'll do full check below

        // Full check: look up all companies again in chunks
        const refreshed: any[] = [];
        for (let i = 0; i < ids.length; i += CHUNK) {
          const { data: chunk } = await supabase.from("companies")
            .select("id, domain, domain_status").in("id", ids.slice(i, i + CHUNK));
          if (chunk) refreshed.push(...chunk);
        }
        const stillPending = refreshed.filter((c: any) => !c.domain && c.domain_status !== "failed").length;
        const resolvedNow = refreshed.filter((c: any) => c.domain).length;

        // Refresh scraped set
        const scrapedNow = new Set<string>();
        {
          const PAGE = 1000;
          let from = 0;
          while (true) {
            const { data: page } = await supabase
              .from("source_pages")
              .select("company_id")
              .eq("crawl_job_id", jobId)
              .range(from, from + PAGE - 1);
            const list = page ?? [];
            for (const r of list as any[]) scrapedNow.add(r.company_id);
            if (list.length < PAGE) break;
            from += PAGE;
          }
        }
        const unscrapedResolved = refreshed.filter((c: any) => c.domain && !scrapedNow.has(c.id)).length;

        if (stillPending > 0 || unscrapedResolved > 0) {
          await supabase.from("crawl_logs").insert({
            crawl_job_id: jobId, level: "info",
            message: `Wave done. Re-invoking in ${Math.round(REINVOKE_DELAY_MS / 1000)}s — ${unscrapedResolved} resolved+unscraped, ${stillPending} still resolving.`,
          });
          scheduleReinvoke(SUPABASE_URL, SERVICE_KEY, jobId);
        } else {
          await supabase.from("crawl_jobs").update({ status: "completed", progress: 100, companies_found: scrapedNow.size }).eq("id", jobId);
          await supabase.from("crawl_logs").insert({
            crawl_job_id: jobId, level: "success",
            message: `Scrape complete: ${scrapedNow.size} of ${refreshed.length} companies processed (${refreshed.length - resolvedNow} had no resolvable domain).`,
          });
        }
      } catch (e: any) {
        await supabase.from("crawl_logs").insert({
          crawl_job_id: jobId, level: "error",
          message: `Batch worker crashed: ${e?.message ?? e}`,
        });
        // Try to recover by re-invoking
        scheduleReinvoke(SUPABASE_URL, SERVICE_KEY, jobId);
      }
    })();

    // @ts-ignore EdgeRuntime
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(work);
    }

    return new Response(JSON.stringify({ queued: todo.length, jobId, pendingResolution: pendingResolution.length }), {
      status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
