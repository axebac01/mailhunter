// Realistic-feeling client-side job simulator.
// Periodically inserts logs, source_pages, contacts, and contact_people
// for running jobs, while strictly filtering out person-tied emails.

import { supabase } from "@/integrations/supabase/client";
import { api, isPersonalEmail } from "@/lib/api";

const PREFIXES = ["info", "sales", "contact", "hello", "support", "office"] as const;
const PHONE_POOL = [
  "+1 415 555 0102","+44 20 7946 0123","+49 30 901820","+33 1 42 86 82 00",
  "+46 8 506 100 00","+39 06 6982","+34 91 524 0808","+47 22 00 70 00",
  "+45 33 14 14 00","+358 9 8567 1500","+31 20 521 2121",
];
const NAMES = ["Anna Lindqvist","Marco Rossi","Sophie Martin","Hiro Tanaka","Olivia Brown","Mia Andersen","Liam O'Connor","Felix Müller","Sara Virtanen","Léa Lefebvre","Theo Rossi","Carlos Fernández"];
const ROLES: Array<[string, string]> = [
  ["Head of Marketing","Marketing"],["Sales Director","Sales"],["Operations Manager","Operations"],
  ["VP of Sales","Sales"],["Customer Success Lead","Support"],["Plant Manager","Operations"],
];
const PAGE_TYPES = ["homepage","contact","about","team","people"] as const;
const CONTACT_PATHS = ["contact", "contacts", "contact-us"] as const;
const CONTACT_PAGE_PATHS = ["contact", "contacts"] as const;

const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

const tickers = new Map<string, number>();
const importedCompanyCache = new Map<string, { ids: string[]; ticksSinceRefresh: number }>();

async function getUploadedJobCompanies(jobId: string): Promise<string[] | null> {
  const cached = importedCompanyCache.get(jobId);
  if (cached && cached.ticksSinceRefresh < 10) {
    cached.ticksSinceRefresh++;
    return cached.ids;
  }
  const { data: imports } = await supabase
    .from("imports")
    .select("id")
    .eq("crawl_job_id", jobId);
  const importIds = (imports ?? []).map((i: any) => i.id);
  if (importIds.length === 0) {
    importedCompanyCache.set(jobId, { ids: [], ticksSinceRefresh: 0 });
    return [];
  }
  const { data: rows } = await supabase
    .from("import_rows")
    .select("matched_company_id")
    .in("import_id", importIds)
    .not("matched_company_id", "is", null);
  const ids = Array.from(new Set((rows ?? []).map((r: any) => r.matched_company_id).filter(Boolean)));
  importedCompanyCache.set(jobId, { ids, ticksSinceRefresh: 0 });
  return ids;
}

export function startSimulator(jobId: string) {
  if (tickers.has(jobId)) return;
  // Slower cadence — real Firecrawl scrapes take several seconds per company.
  const id = window.setInterval(() => tick(jobId).catch(() => {}), 6000);
  tickers.set(jobId, id);
}

export function stopSimulator(jobId: string) {
  const id = tickers.get(jobId);
  if (id) { window.clearInterval(id); tickers.delete(jobId); }
}

export function isSimulating(jobId: string) {
  return tickers.has(jobId);
}

// Track which companies are currently being scraped to avoid duplicate work
const inFlight = new Map<string, Set<string>>();

async function tick(jobId: string) {
  const job = await api.getJob(jobId);
  if (!job || job.status !== "running") {
    stopSimulator(jobId);
    return;
  }
  if (job.progress >= 100 || job.companiesFound >= job.maxCompanies) {
    await api.updateJobStatus(jobId, "completed");
    stopSimulator(jobId);
    return;
  }

  // Uploaded jobs: real Firecrawl scrape per resolved company. No fakes.
  if (job.sourceType === "uploaded") {
    const ids = await getUploadedJobCompanies(jobId);
    if (!ids || ids.length === 0) {
      await api.addLog(jobId, "warn", "Waiting for import matches before crawling…");
      return;
    }

    // Find next company to scrape: must have a domain and not be in-flight or already scraped this run
    const inflightSet = inFlight.get(jobId) ?? new Set<string>();
    inFlight.set(jobId, inflightSet);

    const { data: candidates } = await supabase
      .from("companies")
      .select("id, name, domain, domain_status")
      .in("id", ids)
      .limit(200);
    const list = candidates ?? [];
    const next = list.find((c: any) =>
      c.domain && c.domain.length > 0 && !inflightSet.has(c.id)
    );

    if (!next) {
      // Nothing scrapeable remains — log unresolved count then complete
      const unresolved = list.filter((c: any) => !c.domain).length;
      if (unresolved > 0) {
        await api.addLog(jobId, "warn", `${unresolved} companies have no resolved domain — skipping.`);
      }
      await api.addLog(jobId, "info", "All resolvable companies have been processed.");
      await api.updateJobStatus(jobId, "completed");
      stopSimulator(jobId);
      return;
    }

    inflightSet.add(next.id);
    await api.addLog(jobId, "info", `Scraping ${next.name} (${next.domain})…`);

    try {
      const { error } = await supabase.functions.invoke("scrape-emails", {
        body: {
          companyId: next.id,
          domain: next.domain,
          jobId,
          options: {
            genericEmails: job.collectGenericEmails,
            personEmails: job.collectPersonEmails,
            phones: job.collectPhones,
            contactForms: job.collectContactForms,
          },
        },
      });
      if (error) {
        await api.addLog(jobId, "error", `Scrape failed for ${next.domain}: ${error.message}`);
      }
    } catch (e: any) {
      await api.addLog(jobId, "error", `Scrape threw for ${next.domain}: ${e?.message ?? e}`);
    }

    // Refresh counts from DB (scrape function inserted contacts directly)
    const [{ count: contactsCount }, { count: peopleCount }, { count: pagesCount }] = await Promise.all([
      supabase.from("contacts").select("id", { count: "exact", head: true }).eq("crawl_job_id", jobId),
      supabase.from("contact_people").select("id", { count: "exact", head: true }).eq("crawl_job_id", jobId),
      supabase.from("source_pages").select("id", { count: "exact", head: true }).eq("crawl_job_id", jobId),
    ]);
    const totalCompanies = list.filter((c: any) => c.domain).length;
    const scraped = inflightSet.size;
    const newProgress = Math.min(100, Math.round((scraped / Math.max(1, totalCompanies)) * 100));
    await api.patchJob(jobId, {
      progress: newProgress,
      companies_found: scraped,
      contacts_found: contactsCount ?? 0,
      people_found: peopleCount ?? 0,
      pages_crawled: pagesCount ?? 0,
    });
    return;
  }

  // industry_country jobs: keep the lightweight demo simulator (clearly synthetic).
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
  if (!target.domain) return; // hard guard against null

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
