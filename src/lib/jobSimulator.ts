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
  const id = window.setInterval(() => tick(jobId).catch(() => {}), 1700);
  tickers.set(jobId, id);
}

export function stopSimulator(jobId: string) {
  const id = tickers.get(jobId);
  if (id) { window.clearInterval(id); tickers.delete(jobId); }
}

export function isSimulating(jobId: string) {
  return tickers.has(jobId);
}

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

  // Pick a "crawl" target — for uploaded jobs, only from the import file's matched companies
  let target: any = null;
  if (job.sourceType === "uploaded") {
    const ids = await getUploadedJobCompanies(jobId);
    if (!ids || ids.length === 0) {
      await api.addLog(jobId, "warn", "Waiting for import matches before crawling…");
      return;
    }
    const pickedId = ids[Math.floor(Math.random() * ids.length)];
    const { data: company } = await supabase
      .from("companies")
      .select("id, name, domain, country, industry")
      .eq("id", pickedId)
      .maybeSingle();
    if (!company) return;
    target = company;
  } else {
    const { data: companies } = await supabase.from("companies").select("id, name, domain, country, industry").limit(50);
    if (!companies || companies.length === 0) return;
    target = companies[Math.floor(Math.random() * companies.length)];
  }

  const pageType = pick(PAGE_TYPES);
  const urlPath = pageType === "homepage"
    ? ""
    : pageType === "contact"
      ? pick(CONTACT_PAGE_PATHS)
      : pageType;
  const url = `https://www.${target.domain}/${urlPath}`;
  const logPath = pageType === "homepage" ? "homepage" : `/${urlPath}`;

  // Always: log + source_page
  await Promise.all([
    api.addLog(jobId, "info", `Crawled ${logPath} page on ${target.domain}`),
    supabase.from("source_pages").insert({
      company_id: target.id, crawl_job_id: jobId, url, page_type: pageType, status_code: 200,
      extracted_summary: `Public ${pageType} page; extracted allowed contact data.`,
    }),
  ]);

  let contactsDelta = 0;
  let peopleDelta = 0;

  // Maybe a contact
  if (Math.random() < 0.7) {
    const r = Math.random();
    if (r < 0.6 && job.collectGenericEmails) {
      const value = `${pick(PREFIXES)}@${target.domain}`;
      if (!isPersonalEmail(value)) {
        const { error } = await supabase.from("contacts").insert({
          company_id: target.id, crawl_job_id: jobId, contact_type: "generic_email",
          value, source_url: url,
        });
        if (!error) {
          contactsDelta++;
          await api.addLog(jobId, "success", `Extracted generic email ${value}`);
        }
      } else {
        await api.addLog(jobId, "warn", `Discarded person-tied email candidate on ${target.domain}`);
      }
    } else if (r < 0.85 && job.collectPhones) {
      const { error } = await supabase.from("contacts").insert({
        company_id: target.id, crawl_job_id: jobId, contact_type: "phone",
        value: pick(PHONE_POOL), source_url: url,
      });
      if (!error) { contactsDelta++; await api.addLog(jobId, "success", `Extracted public phone number`); }
    } else if (job.collectContactForms) {
      const formUrl = `https://www.${target.domain}/${pick(CONTACT_PATHS)}`;
      const { error } = await supabase.from("contacts").insert({
        company_id: target.id, crawl_job_id: jobId, contact_type: "contact_form",
        value: formUrl, source_url: url,
      });
      if (!error) { contactsDelta++; await api.addLog(jobId, "success", `Found public contact form URL`); }
    }
  }

  // Maybe a person (and optionally a person-tied email)
  if (Math.random() < 0.35 && (job.collectPersonNames || job.collectPersonRoles || job.collectDepartments || job.collectPersonEmails)) {
    const [role, dept] = pick(ROLES);
    const fullName = pick(NAMES);
    const teamUrl = `https://www.${target.domain}/team`;
    const { error } = await supabase.from("contact_people").insert({
      company_id: target.id, crawl_job_id: jobId,
      full_name: job.collectPersonNames ? fullName : "Public contact",
      role_title: job.collectPersonRoles ? role : null,
      department: job.collectDepartments ? dept : null,
      source_url: teamUrl,
    });
    if (!error) { peopleDelta++; await api.addLog(jobId, "info", `Extracted public team member metadata`); }

    if (job.collectPersonEmails) {
      const local = fullName.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z\s]/g, "").trim().split(/\s+/).join(".");
      const value = `${local}@${target.domain}`;
      const { error: e2 } = await supabase.from("contacts").insert({
        company_id: target.id, crawl_job_id: jobId, contact_type: "person_email" as any,
        value, source_url: teamUrl,
      });
      if (!e2) { contactsDelta++; await api.addLog(jobId, "success", `Extracted public person email ${value}`); }
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

// Auto-resume any jobs that were 'running' on app load
export async function resumeRunningJobs() {
  const { data } = await supabase.from("crawl_jobs").select("id, status").eq("status", "running");
  (data ?? []).forEach((j: any) => startSimulator(j.id));
}
