// Centralized Supabase data layer for mailhunter.ai
// Returns normalized row shapes that mirror the UI's expected camelCase fields.

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type DB = Database["public"]["Tables"];

export type JobStatus = Database["public"]["Enums"]["job_status"];
export type ImportStatus = Database["public"]["Enums"]["import_status"];
export type ContactType = Database["public"]["Enums"]["contact_type"];
export type Weekday = Database["public"]["Enums"]["weekday"];

// ---------- Personal-email guard ----------
const PERSONAL_EMAIL_RE = /^[a-z]+[._-][a-z]+@/i;
export const isPersonalEmail = (v: string) => PERSONAL_EMAIL_RE.test(v);

// ---------- Typed metaJson shape ----------
export interface LogMetaJson {
  event?: string;
  duration_ms?: number;
  reason?: string;
  count?: number;
  processed?: number;
  remaining?: number;
  total?: number;
  wave_seconds?: number;
  person_emails?: number;
  generic_emails?: number;
  [k: string]: unknown;
}

export interface JobMetaJson {
  paused_reason?: string;
  paused_at?: string;
  [k: string]: unknown;
}

// ---------- Normalized row types ----------
export interface JobRow {
  id: string;
  name: string;
  industry: string | null;
  country: string | null;
  status: JobStatus;
  maxCompanies: number;
  startTime: string;
  endTime: string;
  allowedDays: Weekday[];
  collectGenericEmails: boolean;
  collectPersonEmails: boolean;
  collectPhones: boolean;
  collectContactForms: boolean;
  collectPersonNames: boolean;
  collectPersonRoles: boolean;
  collectDepartments: boolean;
  deduplicate: boolean;
  notes: string | null;
  progress: number;
  companiesFound: number;
  contactsFound: number;
  peopleFound: number;
  pagesCrawled: number;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  sourceType: Database["public"]["Enums"]["source_type"];
  metaJson: JobMetaJson | null;
}

export interface CompanyRow {
  id: string;
  name: string;
  domain: string | null;
  website: string | null;
  country: string | null;
  industry: string | null;
  sourceUrl: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContactRow {
  id: string;
  companyId: string;
  companyName: string;
  domain: string | null;
  country: string | null;
  industry: string | null;
  contactType: ContactType;
  contactValue: string;
  sourceUrl: string;
  foundAt: string;
  jobId: string | null;
  jobName: string | null;
  importId: string | null;
}

export interface PersonRow {
  id: string;
  companyId: string;
  companyName: string;
  domain: string | null;
  country: string | null;
  industry: string | null;
  fullName: string;
  roleTitle: string | null;
  department: string | null;
  sourceUrl: string;
  foundAt: string;
  jobId: string | null;
  jobName: string | null;
  importId: string | null;
}

export interface ImportRow {
  id: string;
  fileName: string;
  fileType: string;
  status: ImportStatus;
  totalRows: number;
  processedRows: number;
  matchedRows: number;
  failedRows: number;
  contactsFound: number;
  peopleFound: number;
  crawlJobId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ImportRowDetail {
  id: string;
  importId: string;
  companyName: string;
  country: string | null;
  website: string | null;
  industry: string | null;
  notes: string | null;
  matchedCompanyId: string | null;
  matchedDomain: string | null;
  status: ImportStatus;
  errorMessage: string | null;
}

export interface CrawlLogRow {
  id: string;
  jobId: string;
  level: Database["public"]["Enums"]["crawl_log_level"];
  message: string;
  createdAt: string;
  metaJson: LogMetaJson | null;
}

export interface SourcePageRow {
  id: string;
  companyId: string;
  jobId: string | null;
  url: string;
  pageType: Database["public"]["Enums"]["page_type"];
  statusCode: number | null;
  crawledAt: string;
}

export interface ExportRow {
  id: string;
  exportType: Database["public"]["Enums"]["export_type"];
  fileFormat: Database["public"]["Enums"]["file_format"];
  fileName: string;
  rowCount: number;
  createdAt: string;
}

// ---------- Mappers ----------
const mapJob = (r: DB["crawl_jobs"]["Row"]): JobRow => ({
  id: r.id,
  name: r.name,
  industry: r.industry,
  country: r.country,
  status: r.status,
  maxCompanies: r.max_companies,
  startTime: r.allowed_start_time?.slice(0, 5) ?? "09:00",
  endTime: r.allowed_end_time?.slice(0, 5) ?? "18:00",
  allowedDays: r.allowed_days ?? [],
  collectGenericEmails: r.include_generic_emails,
  collectPersonEmails: r.include_person_emails ?? false,
  collectPhones: r.include_phones,
  collectContactForms: r.include_contact_forms,
  collectPersonNames: r.include_contact_person_names,
  collectPersonRoles: r.include_contact_person_roles,
  collectDepartments: r.include_departments,
  deduplicate: r.deduplicate,
  notes: r.notes,
  progress: r.progress,
  companiesFound: r.companies_found,
  contactsFound: r.contacts_found,
  peopleFound: r.people_found,
  pagesCrawled: r.pages_crawled,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  lastRunAt: r.last_run_at,
  sourceType: r.source_type,
  metaJson: (r.meta_json ?? null) as JobMetaJson | null,
});

const mapCompany = (r: DB["companies"]["Row"]): CompanyRow => ({
  id: r.id,
  name: r.name,
  domain: r.domain,
  website: r.website,
  country: r.country,
  industry: r.industry,
  sourceUrl: r.source_url,
  notes: r.notes,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const mapImport = (r: DB["imports"]["Row"]): ImportRow => ({
  id: r.id,
  fileName: r.file_name,
  fileType: r.file_type,
  status: r.status,
  totalRows: r.total_rows,
  processedRows: r.processed_rows,
  matchedRows: r.matched_rows,
  failedRows: r.failed_rows,
  contactsFound: r.contacts_found,
  peopleFound: r.people_found,
  crawlJobId: r.crawl_job_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

type ContactJoined = {
  id: string;
  contact_type: ContactType;
  value: string;
  source_url: string;
  found_at: string;
  company_id: string;
  crawl_job_id: string | null;
  import_id: string | null;
  companies: { name: string; domain: string | null; country: string | null; industry: string | null } | null;
  crawl_jobs: { name: string } | null;
};

const mapContact = (r: ContactJoined): ContactRow => ({
  id: r.id,
  companyId: r.company_id,
  companyName: r.companies?.name ?? "—",
  domain: r.companies?.domain ?? null,
  country: r.companies?.country ?? null,
  industry: r.companies?.industry ?? null,
  contactType: r.contact_type,
  contactValue: r.value,
  sourceUrl: r.source_url,
  foundAt: r.found_at,
  jobId: r.crawl_job_id,
  jobName: r.crawl_jobs?.name ?? null,
  importId: r.import_id,
});

type PersonJoined = {
  id: string;
  full_name: string;
  role_title: string | null;
  department: string | null;
  source_url: string;
  found_at: string;
  company_id: string;
  crawl_job_id: string | null;
  import_id: string | null;
  companies: { name: string; domain: string | null; country: string | null; industry: string | null } | null;
  crawl_jobs: { name: string } | null;
};

const mapPerson = (r: PersonJoined): PersonRow => ({
  id: r.id,
  companyId: r.company_id,
  companyName: r.companies?.name ?? "—",
  domain: r.companies?.domain ?? null,
  country: r.companies?.country ?? null,
  industry: r.companies?.industry ?? null,
  fullName: r.full_name,
  roleTitle: r.role_title,
  department: r.department,
  sourceUrl: r.source_url,
  foundAt: r.found_at,
  jobId: r.crawl_job_id,
  jobName: r.crawl_jobs?.name ?? null,
  importId: r.import_id,
});

const mapLog = (r: DB["crawl_logs"]["Row"]): CrawlLogRow => ({
  id: r.id,
  jobId: r.crawl_job_id,
  level: r.level,
  message: r.message,
  createdAt: r.created_at,
  metaJson: (r.meta_json ?? null) as LogMetaJson | null,
});

// ---------- List query options ----------
const MAX_PAGE = 500;

export interface ListContactsOpts {
  limit?: number;
  offset?: number;
  jobId?: string;
  importId?: string;
  type?: ContactType;
  search?: string;
}

export interface ListPeopleOpts {
  limit?: number;
  offset?: number;
  jobId?: string;
  importId?: string;
  search?: string;
}

// ---------- Queries ----------
export const api = {
  // Jobs
  async listJobs(): Promise<JobRow[]> {
    const { data, error } = await supabase.from("crawl_jobs").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapJob);
  },
  async getJob(id: string): Promise<JobRow | null> {
    const { data, error } = await supabase.from("crawl_jobs").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? mapJob(data) : null;
  },
  async createJob(input: Partial<DB["crawl_jobs"]["Insert"]> & { name: string }): Promise<JobRow> {
    const { data, error } = await supabase.from("crawl_jobs").insert(input).select("*").single();
    if (error) throw error;
    return mapJob(data);
  },
  async updateJobStatus(id: string, status: JobStatus, extras?: Partial<DB["crawl_jobs"]["Update"]>) {
    const patch: DB["crawl_jobs"]["Update"] = { status, ...extras };
    if (status === "running") patch.last_run_at = new Date().toISOString();
    if (status === "completed") patch.progress = 100;
    const { data, error } = await supabase.from("crawl_jobs").update(patch).eq("id", id).select("*").single();
    if (error) throw error;
    return mapJob(data);
  },
  async patchJob(id: string, patch: DB["crawl_jobs"]["Update"]) {
    const { data, error } = await supabase.from("crawl_jobs").update(patch).eq("id", id).select("*").single();
    if (error) throw error;
    return mapJob(data);
  },
  async duplicateJob(id: string): Promise<JobRow> {
    const orig = await this.getJob(id);
    if (!orig) throw new Error("Job not found");
    const insert: DB["crawl_jobs"]["Insert"] = {
      name: `${orig.name} (copy)`,
      industry: orig.industry,
      country: orig.country,
      max_companies: orig.maxCompanies,
      allowed_start_time: orig.startTime,
      allowed_end_time: orig.endTime,
      allowed_days: orig.allowedDays,
      include_generic_emails: orig.collectGenericEmails,
      include_person_emails: orig.collectPersonEmails,
      include_phones: orig.collectPhones,
      include_contact_forms: orig.collectContactForms,
      include_contact_person_names: orig.collectPersonNames,
      include_contact_person_roles: orig.collectPersonRoles,
      include_departments: orig.collectDepartments,
      deduplicate: orig.deduplicate,
      notes: orig.notes,
      status: "draft",
      source_type: orig.sourceType,
    };
    return this.createJob(insert);
  },
  async deleteJob(id: string) {
    const { error } = await supabase.from("crawl_jobs").delete().eq("id", id);
    if (error) throw error;
  },

  // Companies
  async listCompanies(): Promise<CompanyRow[]> {
    const { data, error } = await supabase.from("companies").select("*").order("name");
    if (error) throw error;
    return (data ?? []).map(mapCompany);
  },
  async getCompany(id: string) {
    const { data, error } = await supabase.from("companies").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? mapCompany(data) : null;
  },
  async upsertCompanyByDomain(input: { name: string; domain?: string | null; website?: string | null; country?: string | null; industry?: string | null; source_url?: string | null; notes?: string | null }): Promise<CompanyRow> {
    if (input.domain) {
      const { data: existing } = await supabase.from("companies").select("*").eq("domain", input.domain).maybeSingle();
      if (existing) return mapCompany(existing);
    }
    const { data, error } = await supabase.from("companies").insert(input).select("*").single();
    if (error) throw error;
    return mapCompany(data);
  },

  // Contacts (joined) — server-side filterable
  async listContacts(opts: ListContactsOpts = {}): Promise<ContactRow[]> {
    const limit = Math.min(opts.limit ?? 2000, MAX_PAGE);
    const offset = opts.offset ?? 0;
    let q = supabase
      .from("contacts")
      .select("id, contact_type, value, source_url, found_at, company_id, crawl_job_id, import_id, companies(name, domain, country, industry), crawl_jobs(name)")
      .order("found_at", { ascending: false });
    if (opts.jobId) q = q.eq("crawl_job_id", opts.jobId);
    if (opts.importId) q = q.eq("import_id", opts.importId);
    if (opts.type) q = q.eq("contact_type", opts.type);
    if (opts.search) q = q.ilike("value", `%${opts.search}%`);
    q = q.range(offset, offset + limit - 1);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map((r) => mapContact(r as unknown as ContactJoined));
  },

  // People — server-side filterable
  async listPeople(opts: ListPeopleOpts = {}): Promise<PersonRow[]> {
    const limit = Math.min(opts.limit ?? 2000, MAX_PAGE);
    const offset = opts.offset ?? 0;
    let q = supabase
      .from("contact_people")
      .select("id, full_name, role_title, department, source_url, found_at, company_id, crawl_job_id, import_id, companies(name, domain, country, industry), crawl_jobs(name)")
      .order("found_at", { ascending: false });
    if (opts.jobId) q = q.eq("crawl_job_id", opts.jobId);
    if (opts.importId) q = q.eq("import_id", opts.importId);
    if (opts.search) q = q.ilike("full_name", `%${opts.search}%`);
    q = q.range(offset, offset + limit - 1);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map((r) => mapPerson(r as unknown as PersonJoined));
  },

  // Imports
  async listImports(): Promise<ImportRow[]> {
    const { data, error } = await supabase.from("imports").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapImport);
  },
  async getImport(id: string) {
    const { data, error } = await supabase.from("imports").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? mapImport(data) : null;
  },
  async createImport(input: DB["imports"]["Insert"]): Promise<ImportRow> {
    const { data, error } = await supabase.from("imports").insert(input).select("*").single();
    if (error) throw error;
    return mapImport(data);
  },
  async updateImport(id: string, patch: DB["imports"]["Update"]) {
    const { error } = await supabase.from("imports").update(patch).eq("id", id);
    if (error) throw error;
  },
  async deleteImport(id: string) {
    const { error } = await supabase.from("imports").delete().eq("id", id);
    if (error) throw error;
  },
  async insertImportRows(rows: DB["import_rows"]["Insert"][]) {
    const { data, error } = await supabase.from("import_rows").insert(rows).select("*");
    if (error) throw error;
    return data ?? [];
  },
  async listImportRows(importId: string): Promise<ImportRowDetail[]> {
    const { data, error } = await supabase.from("import_rows").select("*").eq("import_id", importId).order("created_at");
    if (error) throw error;
    return (data ?? []).map((r) => ({
      id: r.id,
      importId: r.import_id,
      companyName: r.company_name,
      country: r.country,
      website: r.website,
      industry: r.industry,
      notes: r.notes,
      matchedCompanyId: r.matched_company_id,
      matchedDomain: r.matched_domain,
      status: r.status,
      errorMessage: r.error_message,
    }));
  },
  async updateImportRow(id: string, patch: DB["import_rows"]["Update"]) {
    const { error } = await supabase.from("import_rows").update(patch).eq("id", id);
    if (error) throw error;
  },

  // Logs
  async listLogs(jobId: string, limit = 200): Promise<CrawlLogRow[]> {
    const { data, error } = await supabase
      .from("crawl_logs")
      .select("*")
      .eq("crawl_job_id", jobId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map(mapLog);
  },
  async addLog(jobId: string, level: CrawlLogRow["level"], message: string, meta_json?: LogMetaJson) {
    await supabase.from("crawl_logs").insert({ crawl_job_id: jobId, level, message, meta_json: meta_json ?? null });
  },

  // Source pages
  async listSourcePages(opts: { jobId?: string; companyId?: string }): Promise<SourcePageRow[]> {
    let q = supabase.from("source_pages").select("*").order("crawled_at", { ascending: false }).limit(200);
    if (opts.jobId) q = q.eq("crawl_job_id", opts.jobId);
    if (opts.companyId) q = q.eq("company_id", opts.companyId);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map((r) => ({
      id: r.id,
      companyId: r.company_id,
      jobId: r.crawl_job_id,
      url: r.url,
      pageType: r.page_type,
      statusCode: r.status_code,
      crawledAt: r.crawled_at,
    }));
  },

  // Exports
  async recordExport(input: DB["exports"]["Insert"]): Promise<ExportRow> {
    const { data, error } = await supabase.from("exports").insert(input).select("*").single();
    if (error) throw error;
    return {
      id: data.id, exportType: data.export_type, fileFormat: data.file_format,
      fileName: data.file_name, rowCount: data.row_count, createdAt: data.created_at,
    };
  },
  async listExports(): Promise<ExportRow[]> {
    const { data, error } = await supabase.from("exports").select("*").order("created_at", { ascending: false }).limit(50);
    if (error) throw error;
    return (data ?? []).map((d) => ({
      id: d.id, exportType: d.export_type, fileFormat: d.file_format,
      fileName: d.file_name, rowCount: d.row_count, createdAt: d.created_at,
    }));
  },

  // Counts for dashboard
  async kpis() {
    const [jobs, companies, contacts, people, imports, exports] = await Promise.all([
      supabase.from("crawl_jobs").select("status", { count: "exact", head: false }),
      supabase.from("companies").select("id", { count: "exact", head: true }),
      supabase.from("contacts").select("id", { count: "exact", head: true }),
      supabase.from("contact_people").select("id", { count: "exact", head: true }),
      supabase.from("imports").select("id", { count: "exact", head: true }),
      supabase.from("exports").select("id", { count: "exact", head: true }),
    ]);
    const jobRows = (jobs.data ?? []) as { status: JobStatus }[];
    const totalJobs = jobs.count ?? jobRows.length;
    const activeJobs = jobRows.filter((j) => j.status === "running" || j.status === "scheduled" || j.status === "paused").length;
    return {
      totalJobs,
      activeJobs,
      companies: companies.count ?? 0,
      contacts: contacts.count ?? 0,
      people: people.count ?? 0,
      imports: imports.count ?? 0,
      exports: exports.count ?? 0,
    };
  },

  // Clear all collected data for a single job
  async clearJobContacts(jobId: string) {
    const r1 = await supabase.from("contacts").delete().eq("crawl_job_id", jobId);
    if (r1.error) throw r1.error;
    const r2 = await supabase.from("contact_people").delete().eq("crawl_job_id", jobId);
    if (r2.error) throw r2.error;
    const r3 = await supabase.from("source_pages").delete().eq("crawl_job_id", jobId);
    if (r3.error) throw r3.error;
    const r3b = await supabase.from("companies").delete().eq("created_by_job_id", jobId);
    if (r3b.error) throw r3b.error;
    const r4 = await supabase.from("crawl_jobs").update({
      contacts_found: 0, people_found: 0, pages_crawled: 0, companies_found: 0, progress: 0,
    }).eq("id", jobId);
    if (r4.error) throw r4.error;
  },

  // Reseed / clear
  async clearAll() {
    const { error } = await supabase.rpc("clear_all_data");
    if (error) throw error;
  },
};
