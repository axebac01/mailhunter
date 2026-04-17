// Job simulator.
// - Uploaded jobs: a single server-side `scrape-emails-batch` invocation does the
//   work; the client just polls (refreshes queries) while the server updates
//   `crawl_jobs` counters. The tab can be closed without halting work.
// - industry_country jobs: lightweight client-side demo simulator (clearly synthetic).

import { supabase } from "@/integrations/supabase/client";
import { api, isPersonalEmail } from "@/lib/api";

const PREFIXES = ["info", "sales", "contact", "hello", "support", "office"] as const;
const PAGE_TYPES = ["homepage","contact","about","team","people"] as const;
const CONTACT_PAGE_PATHS = ["contact", "contacts"] as const;

const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

const tickers = new Map<string, number>();
const batchInvoked = new Set<string>();

export function startSimulator(jobId: string) {
  if (tickers.has(jobId)) return;
  // Kick off the server batch immediately for uploaded jobs (idempotent guard).
  void maybeKickOffBatch(jobId);
  // Poll every 4s to refresh UI / decide simulator path.
  const id = window.setInterval(() => tick(jobId).catch(() => {}), 4000);
  tickers.set(jobId, id);
}

export function stopSimulator(jobId: string) {
  const id = tickers.get(jobId);
  if (id) { window.clearInterval(id); tickers.delete(jobId); }
}

export function isSimulating(jobId: string) {
  return tickers.has(jobId);
}

async function maybeKickOffBatch(jobId: string) {
  if (batchInvoked.has(jobId)) return;
  const job = await api.getJob(jobId);
  if (!job || job.sourceType !== "uploaded" || job.status !== "running") return;
  batchInvoked.add(jobId);
  // Fire-and-forget. Server function updates progress + counters directly.
  supabase.functions.invoke("scrape-emails-batch", { body: { jobId } }).catch(() => {});
}

async function tick(jobId: string) {
  const job = await api.getJob(jobId);
  if (!job || job.status !== "running") {
    stopSimulator(jobId);
    batchInvoked.delete(jobId);
    return;
  }
  if (job.progress >= 100 || job.companiesFound >= job.maxCompanies) {
    await api.updateJobStatus(jobId, "completed");
    stopSimulator(jobId);
    return;
  }

  // Uploaded jobs: server batch is doing the work. Just ensure it's been kicked off
  // (e.g. if Start was clicked but we missed the initial invoke), then return.
  if (job.sourceType === "uploaded") {
    await maybeKickOffBatch(jobId);
    return;
  }

  // industry_country jobs: lightweight demo simulator (clearly synthetic).
  const { data: companies } = await supabase
    .from("companies")
    .select("id, name, domain, country, industry")
    .not("domain", "is", null)
    .limit(50);
  if (!companies || companies.length === 0) {
    await api.addLog(jobId, "warn", "No companies with resolved domains available.");
    return;
  }
  const target: any = companies[Math.floor(Math.random() * companies.length)];
  if (!target.domain) return;

  const pageType = pick(PAGE_TYPES);
  const urlPath = pageType === "homepage" ? "" : pageType === "contact" ? pick(CONTACT_PAGE_PATHS) : pageType;
  const url = `https://www.${target.domain}/${urlPath}`;
  const logPath = pageType === "homepage" ? "homepage" : `/${urlPath}`;

  await Promise.all([
    api.addLog(jobId, "info", `[demo] Crawled ${logPath} on ${target.domain}`),
    supabase.from("source_pages").insert({
      company_id: target.id, crawl_job_id: jobId, url, page_type: pageType, status_code: 200,
      extracted_summary: `Demo crawl of public ${pageType} page.`,
    }),
  ]);

  let contactsDelta = 0;
  if (Math.random() < 0.5 && job.collectGenericEmails) {
    const value = `${pick(PREFIXES)}@${target.domain}`;
    if (!isPersonalEmail(value)) {
      const { error } = await supabase.from("contacts").insert({
        company_id: target.id, crawl_job_id: jobId, contact_type: "generic_email", value, source_url: url,
      });
      if (!error) { contactsDelta++; await api.addLog(jobId, "success", `[demo] Extracted ${value}`); }
    }
  }

  const newProgress = Math.min(100, job.progress + 1 + Math.floor(Math.random() * 2));
  await api.patchJob(jobId, {
    progress: newProgress,
    companies_found: job.companiesFound + (Math.random() < 0.4 ? 1 : 0),
    contacts_found: job.contactsFound + contactsDelta,
    pages_crawled: job.pagesCrawled + 1,
  });
}

// Auto-resume any jobs that were 'running' on app load
export async function resumeRunningJobs() {
  const { data } = await supabase.from("crawl_jobs").select("id, status").eq("status", "running");
  (data ?? []).forEach((j: any) => startSimulator(j.id));
}
