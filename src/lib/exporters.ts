import * as XLSX from "xlsx";
import { api } from "@/lib/api";
import type { ContactRow, PersonRow } from "@/lib/api";

export type ExportFormat = "csv" | "xlsx";

const todayStr = () => new Date().toISOString().slice(0, 10);

// Strict allow-list of fields per the brief.
export const CONTACT_EXPORT_FIELDS = [
  "company_name", "website", "domain", "country", "industry",
  "contact_type", "contact_value", "source_url", "found_at",
  "job_name", "import_status",
] as const;

export const PEOPLE_EXPORT_FIELDS = [
  "company_name", "website", "domain", "country", "industry",
  "first_name", "last_name", "full_name",
  "role_title", "department", "source_url", "found_at",
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
    source_url: p.sourceUrl,
    found_at: p.foundAt,
    job_name: p.jobName ?? "",
    import_status: p.importId ? "imported" : "discovered",
  };
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

export async function exportJobResults(rows: ContactRow[], format: ExportFormat) {
  const projected = rows.map(projectContactRow);
  const fileName = `job_results_${todayStr()}.${format}`;
  downloadRows(projected, fileName.replace(`.${format}`, ""), format);
  await api.recordExport({ export_type: "job_results", file_format: format, file_name: fileName, row_count: rows.length });
  return fileName;
}

export async function exportImportResults(rows: Record<string, unknown>[], format: ExportFormat) {
  const fileName = `import_results_${todayStr()}.${format}`;
  downloadRows(rows, fileName.replace(`.${format}`, ""), format);
  await api.recordExport({ export_type: "import_results", file_format: format, file_name: fileName, row_count: rows.length });
  return fileName;
}
