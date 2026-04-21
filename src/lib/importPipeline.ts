// Realistic import processor: parses CSV/XLS/XLSX, runs row-by-row matching,
// updates statuses, never fails the whole import on a single bad row.

import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { api } from "@/lib/api";

export interface ParsedFile {
  headers: string[];
  rows: string[][];
}

export async function parseFile(file: File): Promise<ParsedFile> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as any;
  if (rows.length === 0) return { headers: [], rows: [] };
  const headers = (rows[0] || []).map((h) => String(h).trim());
  const data = rows.slice(1).filter((r) => r.some((c) => String(c).trim() !== "")).map((r) => r.map((c) => String(c)));
  return { headers, rows: data };
}

export type Mapping = Record<string, "company_name" | "country" | "website" | "industry" | "notes" | "ignore">;

export function autoMap(headers: string[]): Mapping {
  const m: Mapping = {};
  for (const h of headers) {
    const lo = h.toLowerCase();
    if (lo.includes("company") || lo.includes("name")) m[h] = "company_name";
    else if (lo.includes("country")) m[h] = "country";
    else if (lo.includes("website") || lo.includes("url") || lo.includes("site")) m[h] = "website";
    else if (lo.includes("industry") || lo.includes("sector")) m[h] = "industry";
    else if (lo.includes("note") || lo.includes("comment")) m[h] = "notes";
    else m[h] = "ignore";
  }
  return m;
}

function domainFrom(website: string | undefined | null): string | null {
  if (!website) return null;
  try {
    const u = website.startsWith("http") ? website : `https://${website}`;
    return new URL(u).hostname.replace(/^www\./, "").toLowerCase();
  } catch { return null; }
}

// Domain resolution for name-only rows is no longer done per-row in the import loop.
// Instead, after the import completes we enqueue a single server-side batch via
// `resolve-domains-batch` that handles all unresolved companies with concurrency.

export interface ImportOptions {
  attachJobId: string | null;
  ignoreDuplicates: boolean;
  overwriteEmpty: boolean;
  autoStart: boolean;
  /** Default country applied to rows that don't have one (and to newly-created companies). */
  defaultCountry?: string | null;
  /** When set, newly-created companies are tagged so the resolver can scope retries. */
  createdByJobId?: string | null;
}

export async function runImport(args: {
  file: File;
  parsed: ParsedFile;
  mapping: Mapping;
  options: ImportOptions;
  onProgress?: (processed: number, total: number) => void;
}): Promise<string> {
  const { file, parsed, mapping, options } = args;
  const { headers, rows } = parsed;

  // Build rows mapped to target fields
  const colIdx = (target: Mapping[string]) => headers.findIndex((h) => mapping[h] === target);
  const cName = colIdx("company_name");
  const cCountry = colIdx("country");
  const cWebsite = colIdx("website");
  const cIndustry = colIdx("industry");
  const cNotes = colIdx("notes");

  if (cName === -1) throw new Error("You must map a column to company_name");

  // Create import record
  const importRec = await api.createImport({
    file_name: file.name,
    file_type: file.name.split(".").pop()?.toLowerCase() ?? "csv",
    status: "processing",
    total_rows: rows.length,
    crawl_job_id: options.attachJobId,
  });

  const defaultCountry = options.defaultCountry?.trim() || null;
  const createdByJobId = options.createdByJobId ?? null;

  // Insert all import_rows up front as pending
  const pending = rows.map((r) => ({
    import_id: importRec.id,
    company_name: (r[cName] ?? "").trim() || "Unknown",
    country: (cCountry >= 0 ? r[cCountry] : null) || defaultCountry,
    website: cWebsite >= 0 ? r[cWebsite] || null : null,
    industry: cIndustry >= 0 ? r[cIndustry] || null : null,
    notes: cNotes >= 0 ? r[cNotes] || null : null,
    status: "pending" as const,
  }));
  const inserted = await api.insertImportRows(pending);

  let matched = 0, failed = 0, processed = 0;

  // Process in small batches for live progress
  for (const ir of inserted) {
    try {
      const domain = domainFrom(ir.website);
      let companyId: string | null = null;
      let status: "matched" | "partial_match" | "not_found" | "duplicate" | "failed" = "not_found";

      if (domain) {
        // Match by website-derived domain
        const { data: existing } = await supabase.from("companies").select("id").eq("domain", domain).maybeSingle();
        if (existing) {
          companyId = existing.id;
          status = options.ignoreDuplicates ? "duplicate" : "matched";
          if (status === "matched") matched++;
        } else {
          // Insert new company
          const { data: created, error } = await supabase.from("companies").insert({
            name: ir.company_name,
            domain,
            website: ir.website,
            country: ir.country ?? defaultCountry,
            industry: ir.industry,
            notes: ir.notes,
            source_url: ir.website,
            created_by_job_id: createdByJobId,
            domain_status: "resolved",
          } as any).select("id").single();
          if (error) { status = "failed"; failed++; }
          else { companyId = created.id; status = "matched"; matched++; }
        }
      } else {
        // Name-only row: scoped dedup — only reuse RESOLVED companies in the same country.
        // This stops old "unresolved shells" from being silently re-attached and never retried.
        const trimmedName = (ir.company_name ?? "").trim();
        const importCountry = ir.country ?? defaultCountry ?? null;
        let dedupQuery = supabase.from("companies")
          .select("id, domain, domain_status, country")
          .ilike("name", trimmedName)
          .eq("domain_status", "resolved")
          .limit(1);
        if (importCountry) {
          dedupQuery = dedupQuery.or(`country.eq.${importCountry},country.is.null`);
        }
        const { data: byName } = await dedupQuery.maybeSingle();
        if (byName) {
          companyId = byName.id;
          status = options.ignoreDuplicates ? "duplicate" : "matched";
          if (status === "matched") matched++;
        } else {
          const { data: created, error } = await supabase.from("companies").insert({
            name: trimmedName,
            country: importCountry,
            industry: ir.industry,
            notes: ir.notes,
            domain_status: "unresolved",
            created_by_job_id: createdByJobId,
          } as any).select("id").single();
          if (error) { status = "failed"; failed++; }
          else {
            companyId = created.id;
            status = "matched";
            matched++;
          }
        }
      }

      await api.updateImportRow(ir.id, {
        status,
        matched_company_id: companyId,
        matched_domain: domain,
      });
    } catch (e: any) {
      failed++;
      try { await api.updateImportRow(ir.id, { status: "failed", error_message: String(e?.message ?? e) }); } catch {}
    }
    processed++;
    if (processed % 5 === 0 || processed === inserted.length) {
      await api.updateImport(importRec.id, { processed_rows: processed, matched_rows: matched, failed_rows: failed });
      args.onProgress?.(processed, inserted.length);
    }
  }

  await api.updateImport(importRec.id, {
    status: failed === inserted.length ? "failed" : "completed",
    processed_rows: processed,
    matched_rows: matched,
    failed_rows: failed,
  });

  // Fire-and-forget: enqueue server-side batch domain resolution for this import.
  // Runs with concurrency on the server so the user can close the tab.
  supabase.functions.invoke("resolve-domains-batch", {
    body: { importId: importRec.id },
  }).catch(() => {});

  return importRec.id;
}
