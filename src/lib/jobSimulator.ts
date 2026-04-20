// Job simulator.
// - Uploaded jobs: a single server-side `scrape-emails-batch` invocation does the
//   work; the client just polls (refreshes queries) while the server updates
//   `crawl_jobs` counters. The tab can be closed without halting work.
// - industry_country jobs: lightweight client-side demo simulator (clearly synthetic),
//   including demo company contacts, person emails, and people metadata.

import { supabase } from "@/integrations/supabase/client";
import { api } from "@/lib/api";

const PREFIXES = ["info", "sales", "contact", "hello", "support", "office"] as const;
const PAGE_TYPES = ["homepage", "contact", "about", "team", "people"] as const;
const CONTACT_PAGE_PATHS = ["contact", "contacts"] as const;
const FIRST_NAMES = ["Anna", "Erik", "Sara", "Johan", "Emma", "Lina", "Karl", "Maja"] as const;
const LAST_NAMES = ["Andersson", "Berg", "Nilsson", "Lindberg", "Svensson", "Dahl", "Larsson", "Ekman"] as const;
const ROLE_TITLES = ["CEO", "Sales Manager", "Marketing Lead", "Operations Manager", "Founder", "Business Development Manager"] as const;
const DEPARTMENTS = ["Sales", "Marketing", "Operations", "Leadership"] as const;

const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
const tickers = new Map<string, number>();
const batchInvoked = new Set<string>();

function slugPart(value: string) {
  return value.toLowerCase().replace(/[^a-z]/g, "");
}

function buildDemoPersonEmail(domain: string, first: string, last: string) {
  const firstSlug = slugPart(first);
  const lastSlug = slugPart(last);
  const variants = [
    `${firstSlug}.${lastSlug}@${domain}`,
    `${firstSlug[0]}${lastSlug}@${domain}`,
    `${firstSlug}@${domain}`,
  ].filter((value) => !value.includes("@undefined") && !value.includes(".@"));

  return pick(variants);
}

export function startSimulator(jobId: string) {
  if (tickers.has(jobId)) return;
  void maybeKickOffBatch(jobId);
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

  if (job.sourceType === "uploaded") {
    await maybeKickOffBatch(jobId);
    return;
  }

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
      company_id: target.id,
      crawl_job_id: jobId,
      url,
      page_type: pageType,
      status_code: 200,
      extracted_summary: `Demo crawl of public ${pageType} page.`,
    }),
  ]);

  let contactsDelta = 0;
  let peopleDelta = 0;

  if (Math.random() < 0.5 && job.collectGenericEmails) {
    const value = `${pick(PREFIXES)}@${target.domain}`;
    const { error } = await supabase.from("contacts").insert({
      company_id: target.id,
      crawl_job_id: jobId,
      contact_type: "generic_email",
      value,
      source_url: url,
    });
    if (!error) {
      contactsDelta++;
      await api.addLog(jobId, "success", `[demo] Extracted ${value}`);
    }
  }

  const firstName = pick(FIRST_NAMES);
  const lastName = pick(LAST_NAMES);
  const fullName = `${firstName} ${lastName}`;
  const roleTitle = pick(ROLE_TITLES);
  const department = pick(DEPARTMENTS);

  if (job.collectPersonEmails && Math.random() < 0.4) {
    const value = buildDemoPersonEmail(target.domain, firstName, lastName);
    const { error } = await supabase.from("contacts").insert({
      company_id: target.id,
      crawl_job_id: jobId,
      contact_type: "person_email",
      value,
      source_url: url,
    });
    if (!error) {
      contactsDelta++;
      await api.addLog(jobId, "success", `[demo] Extracted personal email ${value}`);
    }
  }

  if ((job.collectPersonNames || job.collectPersonRoles || job.collectDepartments) && Math.random() < 0.45) {
    const { error } = await supabase.from("contact_people").insert({
      company_id: target.id,
      crawl_job_id: jobId,
      full_name: fullName,
      role_title: job.collectPersonRoles ? roleTitle : null,
      department: job.collectDepartments ? department : null,
      source_url: url,
    });
    if (!error) {
      peopleDelta++;
      await api.addLog(jobId, "success", `[demo] Added person ${fullName}`);
    }
  }

  const newProgress = Math.min(100, job.progress + 1 + Math.floor(Math.random() * 2));
  await api.patchJob(jobId, {
    progress: newProgress,
    companies_found: job.companiesFound + (Math.random() < 0.4 ? 1 : 0),
    contacts_found: job.contactsFound + contactsDelta,
    people_found: job.peopleFound + peopleDelta,
    pages_crawled: job.pagesCrawled + 1,
  });
}

export async function resumeRunningJobs() {
  const { data } = await supabase.from("crawl_jobs").select("id, status").eq("status", "running");
  (data ?? []).forEach((j: any) => startSimulator(j.id));
}
