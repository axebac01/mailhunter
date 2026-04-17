// Type definitions for mailhunter.ai
// Strict guardrails: only public, generic company contact data is stored.

export type JobStatus = "draft" | "scheduled" | "running" | "paused" | "completed" | "failed" | "stopped";
export type ImportStatus = "pending" | "matched" | "partial_match" | "not_found" | "duplicate" | "failed";

// Allowed contact types — strictly limited. No personal emails, ever.
export type ContactType = "generic_email" | "phone" | "contact_form";

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export interface Job {
  id: string;
  name: string;
  industry: string;
  country: string;
  status: JobStatus;
  maxCompanies: number;
  allowedWeekdays: Weekday[];
  startTime: string; // HH:MM
  endTime: string;
  collectGenericEmails: boolean;
  collectPhones: boolean;
  collectContactForms: boolean;
  collectPersonNames: boolean;
  collectPersonRoles: boolean;
  collectDepartments: boolean;
  deduplicate: boolean;
  notes: string;
  createdAt: string;
  lastRunAt: string | null;
  companiesFound: number;
  contactsFound: number;
  peopleFound: number;
  pagesCrawled: number;
  progress: number; // 0-100
}

export interface Company {
  id: string;
  name: string;
  domain: string;
  website: string;
  country: string;
  industry: string;
  sourceUrl: string;
  createdAt: string;
  updatedAt: string;
  contactsCount: number;
  peopleCount: number;
  notes?: string;
  jobIds: string[];
  pagesCrawled: number;
}

export interface ContactRecord {
  id: string;
  companyId: string;
  companyName: string;
  domain: string;
  country: string;
  industry: string;
  contactType: ContactType;
  contactValue: string;
  sourceUrl: string;
  foundAt: string;
  jobId: string | null;
  jobName: string | null;
  importStatus: ImportStatus;
}

// People records carry NO email field. Only public metadata.
export interface PersonRecord {
  id: string;
  fullName: string;
  roleTitle: string;
  department: string;
  companyId: string;
  companyName: string;
  domain: string;
  country: string;
  industry: string;
  sourceUrl: string;
  foundAt: string;
  jobId: string | null;
  jobName: string | null;
  importStatus: ImportStatus;
}

export interface ImportRow {
  id: string;
  companyName: string;
  country?: string;
  website?: string;
  industry?: string;
  notes?: string;
  status: ImportStatus;
}

export interface ImportRecord {
  id: string;
  fileName: string;
  uploadedAt: string;
  totalRows: number;
  matched: number;
  partial: number;
  notFound: number;
  duplicates: number;
  failed: number;
  jobId: string | null;
  jobName: string | null;
  rows: ImportRow[];
}

export interface ActivityEntry {
  id: string;
  timestamp: string;
  type: "job" | "import" | "export" | "system";
  message: string;
}

export interface JobLog {
  id: string;
  jobId: string;
  timestamp: string;
  level: "info" | "warn" | "error" | "success";
  message: string;
}
