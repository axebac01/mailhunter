// World-class bulk import pipeline.
// Replaces sequential per-row loop with 5 set-based phases:
//   A. Parse & normalize (in-memory, no DB)
//   B. Bulk-fetch existing companies (2 queries)
//   C. Bulk-insert new companies (chunks of 500, parallel up to 4)
//   D. Bulk-insert import_rows already with final status (chunks of 500)
//   E. Single final UPDATE on imports
// Plus: in-import dedup, off-thread parsing for large files,
// chunk-level error fallback, fire-and-forget resolver enqueue.

import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { api } from "@/lib/api";

export interface ParsedFile {
  headers: string[];
  rows: string[][];
}

// --------- Parser (worker for large files, main thread otherwise) ----------

const WORKER_THRESHOLD_BYTES = 1_000_000; // ~1MB → run off-thread

export async function parseFile(file: File): Promise<ParsedFile> {
  const buf = await file.arrayBuffer();
  if (buf.byteLength >= WORKER_THRESHOLD_BYTES && typeof Worker !== "undefined") {
    try {
      return await parseInWorker(buf);
    } catch {
      // fall through to main-thread parse
    }
  }
  return parseSync(buf);
}

function parseSync(buf: ArrayBuffer): ParsedFile {
  const wb = XLSX.read(buf, { type: "array", dense: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", blankrows: false }) as any;
  if (rows.length === 0) return { headers: [], rows: [] };
  const headers = (rows[0] || []).map((h) => String(h).trim());
  const data = rows.slice(1)
    .filter((r) => r.some((c) => String(c).trim() !== ""))
    .map((r) => r.map((c) => String(c)));
  return { headers, rows: data };
}

function parseInWorker(buf: ArrayBuffer): Promise<ParsedFile> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../workers/parseFile.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (ev: MessageEvent<{ ok: boolean; headers?: string[]; rows?: string[][]; error?: string }>) => {
      worker.terminate();
      if (ev.data.ok) resolve({ headers: ev.data.headers ?? [], rows: ev.data.rows ?? [] });
      else reject(new Error(ev.data.error ?? "Worker parse failed"));
    };
    worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message || "Worker error")); };
    worker.postMessage({ buffer: buf }, [buf]);
  });
}

// --------- Mapping ----------

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

// --------- Helpers ----------

function domainFrom(website: string | undefined | null): string | null {
  if (!website) return null;
  try {
    const u = website.startsWith("http") ? website : `https://${website}`;
    return new URL(u).hostname.replace(/^www\./, "").toLowerCase();
  } catch { return null; }
}

function normName(name: string): string {
  return name.trim().toLowerCase();
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function runWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await worker(items[i], i);
    }
  }));
  return out;
}

// --------- Public types ----------

export type ImportPhase = "parsing" | "matching" | "saving" | "done";

export interface ImportProgress {
  phase: ImportPhase;
  processed: number;
  total: number;
  /** legacy compat */
  p?: number;
  t?: number;
}

export interface ImportOptions {
  attachJobId: string | null;
  ignoreDuplicates: boolean;
  overwriteEmpty: boolean;
  autoStart: boolean;
  defaultCountry?: string | null;
  createdByJobId?: string | null;
}

export interface RunImportArgs {
  file: File;
  parsed: ParsedFile;
  mapping: Mapping;
  options: ImportOptions;
  /** Backward-compatible: old (processed, total) signature still works.
   *  New callers can read `phase` from the third arg. */
  onProgress?: (processed: number, total: number, phase?: ImportPhase) => void;
}

const COMPANY_CHUNK = 500;
const ROW_CHUNK = 500;
const PARALLEL_CHUNKS = 4;

// --------- Main entry ----------

export async function runImport(args: RunImportArgs): Promise<string> {
  const { file, parsed, mapping, options } = args;
  const { headers, rows } = parsed;
  const emit = (phase: ImportPhase, processed: number, total: number) => args.onProgress?.(processed, total, phase);

  const colIdx = (target: Mapping[string]) => headers.findIndex((h) => mapping[h] === target);
  const cName = colIdx("company_name");
  const cCountry = colIdx("country");
  const cWebsite = colIdx("website");
  const cIndustry = colIdx("industry");
  const cNotes = colIdx("notes");
  if (cName === -1) throw new Error("You must map a column to company_name");

  const defaultCountry = options.defaultCountry?.trim() || null;
  const createdByJobId = options.createdByJobId ?? null;
  const ignoreDuplicates = options.ignoreDuplicates;

  // Create import record up front so the UI sees it instantly.
  const importRec = await api.createImport({
    file_name: file.name,
    file_type: file.name.split(".").pop()?.toLowerCase() ?? "csv",
    status: "processing",
    total_rows: rows.length,
    crawl_job_id: options.attachJobId,
  });

  // ===== Phase A: normalize =====
  emit("matching", 0, rows.length);

  type Norm = {
    rowIdx: number;
    companyName: string;
    country: string | null;
    website: string | null;
    industry: string | null;
    notes: string | null;
    domain: string | null;
    nameKey: string; // normName(name) | country
  };

  const normalized: Norm[] = rows.map((r, i) => {
    const name = (r[cName] ?? "").trim() || "Unknown";
    const country = ((cCountry >= 0 ? r[cCountry] : "") || defaultCountry || "").trim() || null;
    const website = cWebsite >= 0 ? (r[cWebsite] || null) : null;
    const industry = cIndustry >= 0 ? (r[cIndustry] || null) : null;
    const notes = cNotes >= 0 ? (r[cNotes] || null) : null;
    const domain = domainFrom(website);
    return {
      rowIdx: i,
      companyName: name,
      country,
      website,
      industry,
      notes,
      domain,
      nameKey: `${normName(name)}|${(country ?? "").toLowerCase()}`,
    };
  });

  const distinctDomains = Array.from(new Set(normalized.filter((n) => n.domain).map((n) => n.domain!)));
  const nameOnlyRows = normalized.filter((n) => !n.domain);
  const distinctNameKeys = Array.from(new Set(nameOnlyRows.map((n) => n.nameKey)));
  const distinctNames = Array.from(new Set(nameOnlyRows.map((n) => normName(n.companyName))));

  // ===== Phase B: bulk-fetch existing matches =====

  const domainToId = new Map<string, string>();
  if (distinctDomains.length > 0) {
    for (const dchunk of chunk(distinctDomains, 500)) {
      const { data } = await supabase.from("companies").select("id, domain").in("domain", dchunk);
      for (const c of data ?? []) {
        if (c.domain) domainToId.set(c.domain, c.id);
      }
    }
  }

  // Name-only: only reuse RESOLVED companies, scoped by country (or NULL country).
  const nameKeyToId = new Map<string, string>();
  if (distinctNames.length > 0) {
    for (const nchunk of chunk(distinctNames, 500)) {
      const { data } = await supabase
        .from("companies")
        .select("id, name, country")
        .eq("domain_status", "resolved")
        .in("name", nchunk);
      for (const c of data ?? []) {
        const cName = normName(c.name);
        const cCountry = (c.country ?? "").toLowerCase();
        // Match key: same name + same country, OR same name + NULL country (acts as wildcard reuse)
        nameKeyToId.set(`${cName}|${cCountry}`, c.id);
        if (!c.country) {
          // also let this match any country bucket if no other match exists
          for (const key of distinctNameKeys) {
            if (key.startsWith(`${cName}|`) && !nameKeyToId.has(key)) {
              nameKeyToId.set(key, c.id);
            }
          }
        }
      }
    }
  }

  // ===== Phase C: bulk-insert new companies =====
  emit("saving", 0, rows.length);

  // Build dedup-aware insert payloads (one per unmatched domain, one per unmatched nameKey).
  const newCompaniesByDomain = new Map<string, any>();
  const newCompaniesByNameKey = new Map<string, any>();
  const firstByDomain = new Map<string, Norm>();
  const firstByNameKey = new Map<string, Norm>();

  for (const n of normalized) {
    if (n.domain) {
      if (domainToId.has(n.domain)) continue;
      if (newCompaniesByDomain.has(n.domain)) continue;
      firstByDomain.set(n.domain, n);
      newCompaniesByDomain.set(n.domain, {
        name: n.companyName,
        domain: n.domain,
        website: n.website,
        country: n.country,
        industry: n.industry,
        notes: n.notes,
        source_url: n.website,
        created_by_job_id: createdByJobId,
        domain_status: "resolved",
      });
    } else {
      if (nameKeyToId.has(n.nameKey)) continue;
      if (newCompaniesByNameKey.has(n.nameKey)) continue;
      firstByNameKey.set(n.nameKey, n);
      newCompaniesByNameKey.set(n.nameKey, {
        name: n.companyName.trim(),
        country: n.country,
        industry: n.industry,
        notes: n.notes,
        domain_status: "unresolved",
        created_by_job_id: createdByJobId,
      });
    }
  }

  const newDomainPayloads = Array.from(newCompaniesByDomain.values());
  const newNamePayloads = Array.from(newCompaniesByNameKey.values());

  let companyInsertFailures = 0;
  const insertedCompanyIds: string[] = []; // for the resolver enqueue

  // Insert domain-keyed companies (upsert on domain to absorb concurrent duplicates).
  if (newDomainPayloads.length > 0) {
    const chunks = chunk(newDomainPayloads, COMPANY_CHUNK);
    await runWithConcurrency(chunks, PARALLEL_CHUNKS, async (ck) => {
      try {
        const { data, error } = await supabase
          .from("companies")
          .upsert(ck as any, { onConflict: "domain", ignoreDuplicates: false })
          .select("id, domain, name");
        if (error) throw error;
        for (const c of data ?? []) {
          if (c.domain) domainToId.set(c.domain, c.id);
          insertedCompanyIds.push(c.id);
        }
      } catch {
        // Per-row fallback for this chunk only.
        for (const row of ck) {
          try {
            const { data: c } = await supabase
              .from("companies")
              .upsert(row as any, { onConflict: "domain", ignoreDuplicates: false })
              .select("id, domain")
              .single();
            if (c?.domain) domainToId.set(c.domain, c.id);
            if (c?.id) insertedCompanyIds.push(c.id);
          } catch {
            companyInsertFailures++;
          }
        }
      }
    });
  }

  // Insert name-only companies (no unique constraint on name → plain insert).
  if (newNamePayloads.length > 0) {
    const payloadKeys = Array.from(newCompaniesByNameKey.keys());
    const chunks = chunk(payloadKeys, COMPANY_CHUNK);
    await runWithConcurrency(chunks, PARALLEL_CHUNKS, async (keyChunk) => {
      const ck = keyChunk.map((k) => newCompaniesByNameKey.get(k));
      try {
        const { data, error } = await supabase.from("companies").insert(ck as any).select("id, name");
        if (error) throw error;
        // Map returned ids back to nameKeys by position (insert preserves order).
        (data ?? []).forEach((c: any, i: number) => {
          const key = keyChunk[i];
          if (key) nameKeyToId.set(key, c.id);
          insertedCompanyIds.push(c.id);
        });
      } catch {
        for (let i = 0; i < ck.length; i++) {
          try {
            const { data: c } = await supabase.from("companies").insert(ck[i] as any).select("id").single();
            if (c?.id) {
              nameKeyToId.set(keyChunk[i], c.id);
              insertedCompanyIds.push(c.id);
            }
          } catch {
            companyInsertFailures++;
          }
        }
      }
    });
  }

  // ===== Phase D: bulk-insert import_rows with final status =====

  type RowStatus = "matched" | "duplicate" | "failed";
  const seenDomain = new Set<string>();
  const seenNameKey = new Set<string>();

  const importRowPayloads = normalized.map<any>((n) => {
    let companyId: string | null = null;
    let status: RowStatus = "failed";
    let errorMessage: string | null = null;

    if (n.domain) {
      companyId = domainToId.get(n.domain) ?? null;
      if (companyId) {
        const isDup = seenDomain.has(n.domain);
        seenDomain.add(n.domain);
        status = isDup && ignoreDuplicates ? "duplicate" : "matched";
      } else {
        status = "failed";
        errorMessage = "Could not create or match company by domain";
      }
    } else {
      companyId = nameKeyToId.get(n.nameKey) ?? null;
      if (companyId) {
        const isDup = seenNameKey.has(n.nameKey);
        seenNameKey.add(n.nameKey);
        status = isDup && ignoreDuplicates ? "duplicate" : "matched";
      } else {
        status = "failed";
        errorMessage = "Could not create company (name-only)";
      }
    }

    return {
      import_id: importRec.id,
      company_name: n.companyName,
      country: n.country,
      website: n.website,
      industry: n.industry,
      notes: n.notes,
      matched_company_id: companyId,
      matched_domain: n.domain,
      status,
      error_message: errorMessage,
    };
  });

  let matched = 0, failed = 0;
  for (const r of importRowPayloads) {
    if (r.status === "matched") matched++;
    else if (r.status === "failed") failed++;
  }

  let processedSoFar = 0;
  const rowChunks = chunk(importRowPayloads, ROW_CHUNK);
  await runWithConcurrency(rowChunks, PARALLEL_CHUNKS, async (ck) => {
    try {
      const { error } = await supabase.from("import_rows").insert(ck as any);
      if (error) throw error;
    } catch {
      // Per-row fallback for this chunk only.
      for (const r of ck) {
        try { await supabase.from("import_rows").insert(r as any); }
        catch { /* swallow — counter already accounted for */ }
      }
    }
    processedSoFar += ck.length;
    emit("saving", processedSoFar, importRowPayloads.length);
    // Light-weight live progress on `imports` so the history table updates.
    api.updateImport(importRec.id, { processed_rows: processedSoFar, matched_rows: matched, failed_rows: failed }).catch(() => {});
  });

  // ===== Phase E: final import update =====
  await api.updateImport(importRec.id, {
    status: failed === importRowPayloads.length ? "failed" : "completed",
    processed_rows: importRowPayloads.length,
    matched_rows: matched,
    failed_rows: failed,
  });

  emit("done", importRowPayloads.length, importRowPayloads.length);

  // Fire-and-forget: enqueue server-side batch domain resolution for this import.
  // Pass companyIds directly so the resolver doesn't have to re-query.
  if (insertedCompanyIds.length > 0) {
    supabase.functions.invoke("resolve-domains-batch", {
      body: { importId: importRec.id, companyIds: insertedCompanyIds },
    }).catch(() => {});
  } else {
    supabase.functions.invoke("resolve-domains-batch", {
      body: { importId: importRec.id },
    }).catch(() => {});
  }

  return importRec.id;
}
