import * as XLSX from "xlsx";
import { zipSync, strToU8 } from "fflate";
import { api } from "@/lib/api";
import type { ContactRow, PersonRow } from "@/lib/api";

export type ExportFormat = "csv" | "xlsx";

const todayStr = () => new Date().toISOString().slice(0, 10);

// Make a string safe to use as a file name on any OS.
export function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/:\s*/g, " - ") // "CRMdata: Fintech" -> "CRMdata - Fintech"
    .replace(/[/\\?%*|"<>]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "export";
}

// Strict allow-list of fields per the brief.
export const CONTACT_EXPORT_FIELDS = [
  "company_name", "website", "domain", "country", "industry",
  "contact_type", "contact_value", "source_url", "found_at",
  "job_name", "import_status",
] as const;

export const PEOPLE_EXPORT_FIELDS = [
  "company_name", "website", "domain", "country", "industry",
  "first_name", "last_name", "full_name",
  "role_title", "department",
  "email", "email_confidence", "phone",
  "source_url", "found_at",
  "job_name", "import_status",
] as const;

function splitName(full: string | null | undefined): { first: string; last: string } {
  if (!full) return { first: "", last: "" };
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

export function projectContactRow(c: ContactRow) {
  return {
    company_name: c.companyName,
    website: c.domain ? `https://www.${c.domain}` : "",
    domain: c.domain ?? "",
    country: c.country ?? "",
    industry: c.industry ?? "",
    contact_type: c.contactType,
    contact_value: c.contactValue,
    source_url: c.sourceUrl,
    found_at: c.foundAt,
    job_name: c.jobName ?? "",
    import_status: c.importId ? "imported" : "discovered",
  };
}

export function projectPersonRow(p: PersonRow) {
  const { first, last } = splitName(p.fullName);
  return {
    company_name: p.companyName,
    website: p.domain ? `https://www.${p.domain}` : "",
    domain: p.domain ?? "",
    country: p.country ?? "",
    industry: p.industry ?? "",
    first_name: first,
    last_name: last,
    full_name: p.fullName,
    role_title: p.roleTitle ?? "",
    department: p.department ?? "",
    email: p.email ?? "",
    email_confidence: p.emailConfidence ?? "",
    phone: p.phone ?? "",
    source_url: p.sourceUrl,
    found_at: p.foundAt,
    job_name: p.jobName ?? "",
    import_status: p.importId ? "imported" : "discovered",
  };
}

// --- People export filtering (title groups + max-one-per-company) ---

// Title groups are shared with the scrape-emails edge function (single source of truth).
import { TITLE_GROUPS, titleGroupsByIds, type TitleGroup } from "../../supabase/functions/_shared/titleGroups.ts";
export { TITLE_GROUPS, type TitleGroup };

/** Short display labels for selected group ids, e.g. ["ceo","founder"] → ["CEO","Founder"]. */
export function titleGroupShortLabels(ids: string[]): string[] {
  return titleGroupsByIds(ids).map((g) => g.label.split(" / ")[0]);
}

export interface PeopleFilterOptions {
  /** Selected title group ids. Empty = no title filtering (everyone). */
  titleGroupIds: string[];
  /** Include people with empty/null role_title (only relevant when titleGroupIds is non-empty). */
  includeUntitled: boolean;
  /** Keep only the best-ranked person per company. */
  maxOnePerCompany: boolean;
}

function personRankScore(p: PersonRow): number {
  const conf = p.emailConfidence === "extracted" ? 3 : p.emailConfidence === "matched_high" ? 2 : p.emailConfidence === "matched_low" ? 1 : 0;
  return (p.isDecisionMaker ? 100 : 0) + (p.email ? 10 : 0) + conf;
}

export function filterPeopleForExport(people: PersonRow[], opts: PeopleFilterOptions): PersonRow[] {
  let rows = people;
  if (opts.titleGroupIds.length > 0) {
    const groups = TITLE_GROUPS.filter((g) => opts.titleGroupIds.includes(g.id));
    rows = rows.filter((p) => {
      const role = (p.roleTitle ?? "").trim();
      if (!role) return opts.includeUntitled;
      return groups.some((g) => g.re.test(role));
    });
  }
  if (opts.maxOnePerCompany) {
    const best = new Map<string, PersonRow>();
    for (const p of rows) {
      const cur = best.get(p.companyId);
      if (!cur || personRankScore(p) > personRankScore(cur)) best.set(p.companyId, p);
    }
    rows = Array.from(best.values());
  }
  return rows;
}

export function downloadRows(rows: Record<string, unknown>[], filename: string, format: ExportFormat = "csv") {
  if (rows.length === 0) rows = [{ note: "No rows to export" }];
  const ws = XLSX.utils.json_to_sheet(rows);
  if (format === "csv") {
    const csv = XLSX.utils.sheet_to_csv(ws);
    triggerDownload(new Blob([csv], { type: "text/csv;charset=utf-8;" }), `${filename}.csv`);
  } else {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    triggerDownload(new Blob([out], { type: "application/octet-stream" }), `${filename}.xlsx`);
  }
}

function triggerDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// --- High-level export helpers that also record an exports row ---

export async function exportContacts(rows: ContactRow[], format: ExportFormat) {
  const projected = rows.map(projectContactRow);
  const fileName = `contacts_export_${todayStr()}.${format}`;
  downloadRows(projected, fileName.replace(`.${format}`, ""), format);
  await api.recordExport({ export_type: "contacts", file_format: format, file_name: fileName, row_count: rows.length });
  return fileName;
}

export async function exportPeople(rows: PersonRow[], format: ExportFormat) {
  const projected = rows.map(projectPersonRow);
  const fileName = `people_export_${todayStr()}.${format}`;
  downloadRows(projected, fileName.replace(`.${format}`, ""), format);
  await api.recordExport({ export_type: "people", file_format: format, file_name: fileName, row_count: rows.length });
  return fileName;
}

// Which dataset(s) a job export should contain.
export type JobExportDataset = "people" | "contacts" | "both";

export async function exportJobResults(
  contacts: ContactRow[],
  people: PersonRow[],
  format: ExportFormat,
  jobName?: string,
  dataset: JobExportDataset = "contacts",
  peopleFilter?: PeopleFilterOptions,
) {
  const base = jobName ? sanitizeFileName(jobName) : `job_results_${todayStr()}`;
  const filteredPeople = peopleFilter ? filterPeopleForExport(people, peopleFilter) : people;
  if (dataset === "both") {
    const peopleName = `${base} - people.${format}`;
    const contactsName = `${base} - contacts.${format}`;
    const files: Record<string, Uint8Array> = {
      [peopleName]: rowsToBytes(filteredPeople.map(projectPersonRow), format),
      [contactsName]: rowsToBytes(contacts.map(projectContactRow), format),
    };
    triggerDownload(new Blob([zipSync(files)], { type: "application/zip" }), `${base}.zip`);
    await api.recordExport({ export_type: "people", file_format: format, file_name: peopleName, row_count: filteredPeople.length });
    await api.recordExport({ export_type: "job_results", file_format: format, file_name: contactsName, row_count: contacts.length });
    return `${base}.zip`;
  }
  if (dataset === "people") {
    const fileName = `${base}.${format}`;
    downloadRows(filteredPeople.map(projectPersonRow), base, format);
    await api.recordExport({ export_type: "people", file_format: format, file_name: fileName, row_count: filteredPeople.length });
    return fileName;
  }
  const fileName = `${base}.${format}`;
  downloadRows(contacts.map(projectContactRow), base, format);
  await api.recordExport({ export_type: "job_results", file_format: format, file_name: fileName, row_count: contacts.length });
  return fileName;
}

// Serialize rows to file bytes without triggering a download (for zip bundling).
function rowsToBytes(input: Record<string, unknown>[], format: ExportFormat): Uint8Array {
  const rows = input.length === 0 ? [{ note: "No rows to export" }] : input;
  const ws = XLSX.utils.json_to_sheet(rows);
  if (format === "csv") return strToU8(XLSX.utils.sheet_to_csv(ws));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return new Uint8Array(XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer);
}

// Export many jobs at once: one file per job (named after the job) inside a zip.
// With dataset "both", each job gets two files: "<name> - people" and "<name> - contacts".
export async function exportJobsZip(
  jobs: { id: string; name: string }[],
  format: ExportFormat,
  dataset: JobExportDataset = "contacts",
  onProgress?: (done: number, total: number) => void,
  peopleFilter?: PeopleFilterOptions,
) {
  const files: Record<string, Uint8Array> = {};
  const usedNames = new Set<string>();
  let totalRows = 0;
  for (let i = 0; i < jobs.length; i++) {
    onProgress?.(i, jobs.length);
    let base = sanitizeFileName(jobs[i].name);
    let n = 2;
    while (usedNames.has(base.toLowerCase())) base = `${sanitizeFileName(jobs[i].name)} (${n++})`;
    usedNames.add(base.toLowerCase());

    if (dataset !== "people") {
      const contacts = await api.listContacts({ jobId: jobs[i].id });
      const contactsName = `${dataset === "both" ? `${base} - contacts` : base}.${format}`;
      files[contactsName] = rowsToBytes(contacts.map(projectContactRow), format);
      totalRows += contacts.length;
      await api.recordExport({ export_type: "job_results", file_format: format, file_name: contactsName, row_count: contacts.length });
    }
    if (dataset !== "contacts") {
      const raw = await api.listPeople({ jobId: jobs[i].id });
      const people = peopleFilter ? filterPeopleForExport(raw, peopleFilter) : raw;
      const peopleName = `${dataset === "both" ? `${base} - people` : base}.${format}`;
      files[peopleName] = rowsToBytes(people.map(projectPersonRow), format);
      totalRows += people.length;
      await api.recordExport({ export_type: "people", file_format: format, file_name: peopleName, row_count: people.length });
    }
  }
  onProgress?.(jobs.length, jobs.length);
  const zipName = `jobs_export_${todayStr()}.zip`;
  triggerDownload(new Blob([zipSync(files)], { type: "application/zip" }), zipName);
  return { zipName, totalRows };
}

export async function exportImportResults(rows: Record<string, unknown>[], format: ExportFormat) {
  const fileName = `import_results_${todayStr()}.${format}`;
  downloadRows(rows, fileName.replace(`.${format}`, ""), format);
  await api.recordExport({ export_type: "import_results", file_format: format, file_name: fileName, row_count: rows.length });
  return fileName;
}
