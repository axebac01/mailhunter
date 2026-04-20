// Job simulator.
// - Uploaded jobs: a single server-side `scrape-emails-batch` invocation does the
//   work; the client just polls (refreshes queries) while the server updates
//   `crawl_jobs` counters. The tab can be closed without halting work.
// - industry_country jobs: lightweight client-side demo simulator (clearly synthetic).
//   Generates its OWN synthetic companies scoped to the job (created_by_job_id),
//   so it never touches companies that came from imports or other jobs.

import { supabase } from "@/integrations/supabase/client";
import { api } from "@/lib/api";

const PREFIXES = ["info", "sales", "contact", "hello", "support", "office"] as const;
const PAGE_TYPES = ["homepage", "contact", "about", "team", "people"] as const;
const CONTACT_PAGE_PATHS = ["contact", "contacts"] as const;
const FIRST_NAMES = ["Anna", "Erik", "Sara", "Johan", "Emma", "Lina", "Karl", "Maja"] as const;
const LAST_NAMES = ["Andersson", "Berg", "Nilsson", "Lindberg", "Svensson", "Dahl", "Larsson", "Ekman"] as const;
const ROLE_TITLES = ["CEO", "Sales Manager", "Marketing Lead", "Operations Manager", "Founder", "Business Development Manager"] as const;
const DEPARTMENTS = ["Sales", "Marketing", "Operations", "Leadership"] as const;

const COUNTRY_TLDS: Record<string, string> = {
  Sweden: "se", Norway: "no", Denmark: "dk", Finland: "fi",
  Germany: "de", France: "fr", "United Kingdom": "co.uk", UK: "co.uk",
  Netherlands: "nl", Spain: "es", Italy: "it", Poland: "pl",
  "United States": "com", USA: "com", Ireland: "ie", Belgium: "be",
};

const COUNTRY_CITY_PREFIX: Record<string, string[]> = {
  Sweden: ["Stockholm", "Göteborg", "Malmö", "Uppsala", "Nordic", "Skandia"],
  Norway: ["Oslo", "Bergen", "Nordic", "Fjord"],
  Denmark: ["Copenhagen", "Aarhus", "Nordic"],
  Finland: ["Helsinki", "Tampere", "Nordic"],
  Germany: ["Berlin", "Munich", "Hamburg", "Rhein"],
  France: ["Paris", "Lyon", "Marseille"],
  "United Kingdom": ["London", "Manchester", "Bristol"],
  Netherlands: ["Amsterdam", "Rotterdam", "Utrecht"],
};

const INDUSTRY_WORDS: Record<string, string[]> = {
  Media: ["Press", "Media", "Publishing", "Broadcast", "News"],
  Dental: ["Dental", "Dent", "Smile", "Oral"],
  Technology: ["Tech", "Soft", "Digital", "Cloud", "Data"],
  Finance: ["Capital", "Finans", "Invest", "Bank"],
  Healthcare: ["Care", "Health", "Medic", "Vital"],
  Retail: ["Retail", "Shop", "Trade", "Market"],
  Manufacturing: ["Industri", "Works", "Mfg", "Production"],
  Construction: ["Bygg", "Build", "Construct"],
};

const SUFFIXES = ["AB", "Group", "Co", "Partners", "Holding", "Studio"];

const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
const tickers = new Map<string, number>();
const batchInvoked = new Set<string>();

function slugPart(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
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

function genSyntheticCompany(industry: string | null, country: string | null) {
  const tld = (country && COUNTRY_TLDS[country]) || "com";
  const cities = (country && COUNTRY_CITY_PREFIX[country]) || ["Nordic", "Euro", "Global"];
  const words = (industry && INDUSTRY_WORDS[industry]) || [industry?.split(/\s+/)[0] || "Group"];
  const city = pick(cities);
  const word = pick(words);
  const suffix = pick(SUFFIXES);
  const name = `${city} ${word} ${suffix}`;
  const domainBase = `${slugPart(city)}${slugPart(word)}`;
  const domain = `${domainBase}-${Math.floor(Math.random() * 9000 + 1000)}.${tld}`;
  return { name, domain };
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

  // industry_country: only operate on companies created by THIS job.
  const { data: ownCompanies } = await supabase
    .from("companies")
    .select("id, name, domain")
    .eq("created_by_job_id", jobId)
    .not("domain", "is", null);

  let pool = (ownCompanies ?? []) as Array<{ id: string; name: string; domain: string }>;

  // Seed a new synthetic company if pool is below max and we still have headroom.
  let newCompanyInserted = false;
  if (pool.length < job.maxCompanies && Math.random() < 0.6) {
    const { name, domain } = genSyntheticCompany(job.industry, job.country);
    const { data: inserted, error } = await supabase
      .from("companies")
      .insert({
        name,
        domain,
        website: `https://www.${domain}`,
        country: job.country,
        industry: job.industry,
        domain_status: "resolved",
        created_by_job_id: jobId,
        notes: "[demo] generated by industry_country simulator",
      } as any)
      .select("id, name, domain")
      .single();
    if (!error && inserted) {
      pool = [...pool, inserted as any];
      newCompanyInserted = true;
      await api.addLog(jobId, "info", `[demo] Discovered ${name} (${domain})`);
    }
  }

  if (pool.length === 0) {
    await api.addLog(jobId, "info", "[demo] Seeding initial company pool…");
    return;
  }

  const target = pool[Math.floor(Math.random() * pool.length)];

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
    companies_found: job.companiesFound + (newCompanyInserted ? 1 : 0),
    contacts_found: job.contactsFound + contactsDelta,
    people_found: job.peopleFound + peopleDelta,
    pages_crawled: job.pagesCrawled + 1,
  });
}

export async function resumeRunningJobs() {
  const { data } = await supabase.from("crawl_jobs").select("id, status").eq("status", "running");
  (data ?? []).forEach((j: any) => startSimulator(j.id));
}
