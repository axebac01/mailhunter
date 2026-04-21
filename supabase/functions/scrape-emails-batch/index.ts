// Batch email scraping: invoke once per job, scrapes all resolved companies
// linked to that job's imports with bounded concurrency. Updates crawl_jobs
// counters as it progresses so the UI just polls.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const CONCURRENCY = 6;
const PER_COMPANY_TIMEOUT_MS = 45_000;

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

    // Companies linked via this job's imports
    const { data: imports } = await supabase.from("imports").select("id").eq("crawl_job_id", jobId);
    const importIds = (imports ?? []).map((i: any) => i.id);
    if (importIds.length === 0) {
      await supabase.from("crawl_logs").insert({ crawl_job_id: jobId, level: "warn", message: "No imports linked to this job — nothing to scrape." });
      await supabase.from("crawl_jobs").update({ status: "completed", progress: 100 }).eq("id", jobId);
      return new Response(JSON.stringify({ scraped: 0, total: 0 }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { data: rows } = await supabase.from("import_rows")
      .select("matched_company_id").in("import_id", importIds).not("matched_company_id", "is", null);
    const ids = Array.from(new Set((rows ?? []).map((r: any) => r.matched_company_id).filter(Boolean)));
    // Batch the company fetch — Postgrest .in() with hundreds of UUIDs can exceed
    // URL length limits and silently return zero rows.
    const CHUNK = 100;
    const allCompanies: any[] = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      const { data: chunk } = await supabase.from("companies")
        .select("id, name, domain").in("id", slice);
      if (chunk) allCompanies.push(...chunk);
    }
    const todo = allCompanies.filter((c: any) => c.domain);
    const skipped = allCompanies.length - todo.length;

    await supabase.from("crawl_logs").insert({
      crawl_job_id: jobId, level: "info",
      message: `Starting scrape: ${todo.length} companies with resolved domains${skipped ? `, ${skipped} skipped (no domain)` : ""} (concurrency ${CONCURRENCY}).`,
    });

    if (todo.length === 0) {
      await supabase.from("crawl_jobs").update({ status: "completed", progress: 100 }).eq("id", jobId);
      return new Response(JSON.stringify({ scraped: 0, total: 0 }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let scraped = 0;
    const refreshCounters = async () => {
      const [{ count: contactsCount }, { count: peopleCount }, { count: pagesCount }] = await Promise.all([
        supabase.from("contacts").select("id", { count: "exact", head: true }).eq("crawl_job_id", jobId),
        supabase.from("contact_people").select("id", { count: "exact", head: true }).eq("crawl_job_id", jobId),
        supabase.from("source_pages").select("id", { count: "exact", head: true }).eq("crawl_job_id", jobId),
      ]);
      const progress = Math.min(100, Math.round((scraped / todo.length) * 100));
      await supabase.from("crawl_jobs").update({
        progress, companies_found: scraped,
        contacts_found: contactsCount ?? 0,
        people_found: peopleCount ?? 0,
        pages_crawled: pagesCount ?? 0,
      }).eq("id", jobId);
    };

    // Run scraping in the background so the HTTP response returns immediately
    // (avoids the 150s edge function idle timeout for large jobs).
    const work = (async () => {
      try {
        await runPool(todo, async (c: any) => {
          const { data: cur } = await supabase.from("crawl_jobs").select("status").eq("id", jobId).maybeSingle();
          if (cur?.status !== "running") return;

          try {
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
                },
              }),
            });
            if (!res.ok) {
              const text = await res.text().catch(() => "");
              await supabase.from("crawl_logs").insert({
                crawl_job_id: jobId, level: "error",
                message: `Scrape failed for ${c.domain}: ${res.status} ${text.slice(0, 200)}`,
              });
            }
          } catch (e: any) {
            await supabase.from("crawl_logs").insert({
              crawl_job_id: jobId, level: "error",
              message: `Scrape threw for ${c.domain}: ${e?.message ?? e}`,
            });
          }
          scraped++;
          if (scraped % 2 === 0 || scraped === todo.length) await refreshCounters();
        }, CONCURRENCY);

        await refreshCounters();
        const { data: final } = await supabase.from("crawl_jobs").select("status").eq("id", jobId).maybeSingle();
        if (final?.status === "running") {
          await supabase.from("crawl_jobs").update({ status: "completed", progress: 100 }).eq("id", jobId);
          await supabase.from("crawl_logs").insert({ crawl_job_id: jobId, level: "success", message: `Scrape complete: ${scraped} companies processed.` });
        }
      } catch (e: any) {
        await supabase.from("crawl_logs").insert({
          crawl_job_id: jobId, level: "error",
          message: `Batch worker crashed: ${e?.message ?? e}`,
        });
      }
    })();

    // @ts-ignore - EdgeRuntime is provided by Supabase Edge runtime
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(work);
    }

    return new Response(JSON.stringify({ queued: todo.length, jobId }), {
      status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
