// World-class streaming bulk import pipeline.
// - CSV: streamed via PapaParse (constant memory regardless of file size)
// - XLSX: parsed once in a worker, then fed batch-by-batch
// Per-batch: normalize → match (domain + name, country-scoped, LRU-cached)
//   → insert new companies (chunked, parallel) → insert import_rows
//   → fire-and-forget resolver enqueue in waves of 200 ids.

import * as XLSX from "xlsx";
import Papa from "papaparse";
import { supabase } from "@/integrations/supabase/client";
import { api } from "@/lib/api";

// ============================================================================
// Types
// ============================================================================

export interface ParsedFile {
  headers: string[];
  rows: string[][];
}

export type Mapping = Record<string, "company_name" | "country" | "website" | "industry" | "notes" | "ignore">;

export type ImportPhase = "reading" | "parsing" | "matching" | "saving" | "done";

export interface ImportProgress {
  phase: ImportPhase;
  processed: number;
  total: number;
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

export type ParseResult =
  | { kind: "buffered"; parsed: ParsedFile }
  | { kind: "stream"; headers: string[]; previewRows: string[][]; iterate: (onBatch: (rows: string[][]) => Promise<void>) => Promise<number> };

export interface RunImportArgs {
  file: File;
  parsed: ParsedFile | ParseResult; // accept either for backward compat
  mapping: Mapping;
  options: ImportOptions;
  onProgress?: (processed: number, total: number, phase?: ImportPhase) => void;
}

// ============================================================================
// Constants
// ============================================================================

const BATCH_SIZE = 2000;            // rows per pipeline batch
const COMPANY_CHUNK = 500;
const ROW_CHUNK = 500;
const PARALLEL_CHUNKS = 4;
const RESOLVER_WAVE_SIZE = 200;     // companyIds per resolve-domains-batch invoke
const RESOLVER_PARALLEL = 3;
const HARD_ROW_CAP = 1_000_000;
const STREAM_THRESHOLD_BYTES = 2_000_000; // CSV ≥ 2MB → stream
const XLSX_WARN_BYTES = 25 * 1024 * 1024;

// ============================================================================
// Parser entry point
// ============================================================================

export async function parseFile(file: File): Promise<ParseResult> {
  const isCsv = /\.csv$/i.test(file.name);
  if (isCsv && file.size >= STREAM_THRESHOLD_BYTES) {
    return makeCsvStream(file);
  }
  // Buffered path: small CSV or any XLSX/XLS
  if (isCsv) {
    const text = await file.text();
    const parsed = parseCsvSync(text);
    return { kind: "buffered", parsed };
  }
  const buf = await file.arrayBuffer();
  const parsed = parseXlsxSync(buf);
  return { kind: "buffered", parsed };
}

function parseCsvSync(text: string): ParsedFile {
  const out = Papa.parse<string[]>(text, { skipEmptyLines: true });
  const rows = (out.data ?? []) as string[][];
  if (rows.length === 0) return { headers: [], rows: [] };
  const headers = (rows[0] || []).map((h) => String(h).trim());
  const data = rows.slice(1).filter((r) => r.some((c) => String(c ?? "").trim() !== ""));
  return { headers, rows: data.map((r) => r.map((c) => String(c ?? ""))) };
}

function parseXlsxSync(buf: ArrayBuffer): ParsedFile {
  let wb: XLSX.WorkBook;
  try {
    // SheetJS auto-detects BIFF (.xls) vs OOXML (.xlsx) from the buffer.
    wb = XLSX.read(buf, { type: "array", dense: true });
  } catch (e: any) {
    throw new Error("Could not read this Excel file — try re-saving it as .xlsx or .csv");
  }
  if (!wb.SheetNames?.length) throw new Error("Excel file has no sheets");
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", blankrows: false }) as any;
  if (rows.length === 0) return { headers: [], rows: [] };
  const headers = (rows[0] || []).map((h) => String(h).trim());
  const data = rows.slice(1)
    .filter((r) => r.some((c) => String(c).trim() !== ""))
    .map((r) => r.map((c) => String(c)));
  return { headers, rows: data };
}

// Streaming CSV: returns headers + first preview rows immediately.
// `iterate` re-streams the file from the start, batching rows to onBatch.
function makeCsvStream(file: File): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    let headers: string[] = [];
    const previewRows: string[][] = [];
    let firstChunk = true;
    Papa.parse<string[]>(file as any, {
      worker: true,
      skipEmptyLines: true,
      preview: 12,
      complete: (res) => {
        const data = (res.data ?? []) as string[][];
        if (data.length === 0) { reject(new Error("Empty CSV")); return; }
        headers = (data[0] || []).map((h) => String(h).trim());
        for (const r of data.slice(1, 11)) previewRows.push(r.map((c) => String(c ?? "")));
        firstChunk = false;
        resolve({
          kind: "stream",
          headers,
          previewRows,
          iterate: (onBatch) => streamCsv(file, onBatch),
        });
      },
      error: (err) => reject(err),
    });
    void firstChunk;
  });
}

function streamCsv(file: File, onBatch: (rows: string[][]) => Promise<void>): Promise<number> {
  return new Promise((resolve, reject) => {
    let buffer: string[][] = [];
    let total = 0;
    let isHeader = true;
    let pendingError: any = null;

    Papa.parse<string[]>(file as any, {
      worker: true,
      skipEmptyLines: true,
      chunkSize: 1024 * 256, // 256KB raw chunks
      chunk: async (results, parser) => {
        if (pendingError) return;
        const data = (results.data ?? []) as string[][];
        let start = 0;
        if (isHeader && data.length > 0) { isHeader = false; start = 1; }
        for (let i = start; i < data.length; i++) {
          const r = data[i];
          if (!r || !r.some((c) => String(c ?? "").trim() !== "")) continue;
          buffer.push(r.map((c) => String(c ?? "")));
          if (buffer.length >= BATCH_SIZE) {
            const out = buffer; buffer = [];
            parser.pause();
            try {
              await onBatch(out);
              total += out.length;
              if (total > HARD_ROW_CAP) {
                pendingError = new Error(`File exceeds ${HARD_ROW_CAP.toLocaleString()} row cap`);
                parser.abort();
                return;
              }
              parser.resume();
            } catch (e) {
              pendingError = e;
              parser.abort();
            }
          }
        }
      },
      complete: async () => {
        if (pendingError) { reject(pendingError); return; }
        if (buffer.length > 0) {
          try { await onBatch(buffer); total += buffer.length; buffer = []; }
          catch (e) { reject(e); return; }
        }
        resolve(total);
      },
      error: (err) => reject(err),
    });
  });
}

// ============================================================================
// Mapping helpers
// ============================================================================

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

export function checkLargeXlsx(file: File): { warn: boolean; reason?: string } {
  if (/\.(xls|xlsx)$/i.test(file.name) && file.size > XLSX_WARN_BYTES) {
    return { warn: true, reason: `Large Excel file (${(file.size / 1024 / 1024).toFixed(1)} MB). For files >25 MB, CSV is faster and uses less memory.` };
  }
  return { warn: false };
}

// ============================================================================
// Utility helpers
// ============================================================================

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

// Tiny LRU cache for cross-batch domain/name lookups.
class LRU<K, V> {
  private map = new Map<K, V>();
  constructor(private max: number) {}
  get(k: K): V | undefined {
    const v = this.map.get(k);
    if (v !== undefined) { this.map.delete(k); this.map.set(k, v); }
    return v;
  }
  set(k: K, v: V) {
    if (this.map.has(k)) this.map.delete(k);
    this.map.set(k, v);
    if (this.map.size > this.max) {
      const first = this.map.keys().next().value as K | undefined;
      if (first !== undefined) this.map.delete(first);
    }
  }
  has(k: K) { return this.map.has(k); }
}

// ============================================================================
// Per-batch pipeline state (shared across batches in one runImport call)
// ============================================================================

interface PipelineCtx {
  importId: string;
  ignoreDuplicates: boolean;
  createdByJobId: string | null;
  // Cross-batch dedup
  seenDomain: Set<string>;
  seenNameKey: Set<string>;
  // Cross-batch lookup caches
  domainCache: LRU<string, string>;        // domain → companyId
  nameKeyCache: LRU<string, string>;       // name|country → companyId
  // Aggregates
  totalRows: number;
  processedRows: number;
  matchedRows: number;
  failedRows: number;
  insertedCompanyIds: string[];            // for resolver enqueue
  // Resolver wave dispatch
  resolverWavesQueued: number;
  resolverInflight: Promise<unknown>[];
}

type Norm = {
  companyName: string;
  country: string | null;
  website: string | null;
  industry: string | null;
  notes: string | null;
  domain: string | null;
  nameKey: string;
};

interface BatchOutcome { matched: number; failed: number; }

async function processBatch(ctx: PipelineCtx, rawRows: string[][], col: { name: number; country: number; website: number; industry: number; notes: number }, defaultCountry: string | null): Promise<BatchOutcome> {
  // ---- Normalize ----
  const normalized: Norm[] = rawRows.map((r) => {
    const name = (r[col.name] ?? "").trim() || "Unknown";
    const country = ((col.country >= 0 ? r[col.country] : "") || defaultCountry || "").trim() || null;
    const website = col.website >= 0 ? (r[col.website] || null) : null;
    const industry = col.industry >= 0 ? (r[col.industry] || null) : null;
    const notes = col.notes >= 0 ? (r[col.notes] || null) : null;
    const domain = domainFrom(website);
    return {
      companyName: name,
      country,
      website,
      industry,
      notes,
      domain,
      nameKey: `${normName(name)}|${(country ?? "").toLowerCase()}`,
    };
  });

  // ---- Match phase B (only what's not in cache) ----
  const domainToId = new Map<string, string>();
  const nameKeyToId = new Map<string, string>();

  // Seed from cache
  const domainsToFetch = new Set<string>();
  const namesToFetch = new Set<string>();
  const countriesInBatch = new Set<string>();
  for (const n of normalized) {
    if (n.country) countriesInBatch.add(n.country);
    if (n.domain) {
      const cached = ctx.domainCache.get(n.domain);
      if (cached) domainToId.set(n.domain, cached);
      else domainsToFetch.add(n.domain);
    } else {
      const cached = ctx.nameKeyCache.get(n.nameKey);
      if (cached) nameKeyToId.set(n.nameKey, cached);
      else namesToFetch.add(normName(n.companyName));
    }
  }

  // Domain lookup
  if (domainsToFetch.size > 0) {
    const list = Array.from(domainsToFetch);
    for (const dchunk of chunk(list, 500)) {
      const { data } = await supabase.from("companies").select("id, domain").in("domain", dchunk);
      for (const c of data ?? []) {
        if (c.domain) {
          domainToId.set(c.domain, c.id);
          ctx.domainCache.set(c.domain, c.id);
        }
      }
    }
  }

  // Name-only lookup, country-scoped
  if (namesToFetch.size > 0) {
    const names = Array.from(namesToFetch);
    const countries = Array.from(countriesInBatch);
    for (const nchunk of chunk(names, 500)) {
      let q = supabase
        .from("companies")
        .select("id, name, country")
        .eq("domain_status", "resolved")
        .in("name", nchunk);
      // Scope by country (include NULL country as wildcard reuse).
      if (countries.length > 0 && countries.length <= 20) {
        // Postgrest can't OR `in(country, [...])` with `is null` cleanly via the JS client,
        // so fetch both and merge client-side.
        const { data: byCountry } = await q.in("country", countries);
        const { data: nullCountry } = await supabase
          .from("companies").select("id, name, country")
          .eq("domain_status", "resolved").in("name", nchunk).is("country", null);
        const merged = [...(byCountry ?? []), ...(nullCountry ?? [])];
        for (const c of merged) {
          const key = `${normName(c.name)}|${(c.country ?? "").toLowerCase()}`;
          nameKeyToId.set(key, c.id);
          ctx.nameKeyCache.set(key, c.id);
          if (!c.country) {
            // wildcard: any in-batch nameKey starting with this name
            for (const n of normalized) {
              if (!n.domain && normName(n.companyName) === normName(c.name) && !nameKeyToId.has(n.nameKey)) {
                nameKeyToId.set(n.nameKey, c.id);
                ctx.nameKeyCache.set(n.nameKey, c.id);
              }
            }
          }
        }
      } else {
        const { data } = await q;
        for (const c of data ?? []) {
          const key = `${normName(c.name)}|${(c.country ?? "").toLowerCase()}`;
          nameKeyToId.set(key, c.id);
          ctx.nameKeyCache.set(key, c.id);
        }
      }
    }
  }

  // ---- Insert new companies (deduped within batch) ----
  const newDomainPayloads: any[] = [];
  const newDomainKeys: string[] = [];
  const newNamePayloads: any[] = [];
  const newNameKeys: string[] = [];
  const seenNewDomain = new Set<string>();
  const seenNewName = new Set<string>();

  for (const n of normalized) {
    if (n.domain) {
      if (domainToId.has(n.domain)) continue;
      if (seenNewDomain.has(n.domain)) continue;
      seenNewDomain.add(n.domain);
      newDomainKeys.push(n.domain);
      newDomainPayloads.push({
        name: n.companyName, domain: n.domain, website: n.website,
        country: n.country, industry: n.industry, notes: n.notes,
        source_url: n.website, created_by_job_id: ctx.createdByJobId,
        domain_status: "resolved",
      });
    } else {
      if (nameKeyToId.has(n.nameKey)) continue;
      if (seenNewName.has(n.nameKey)) continue;
      seenNewName.add(n.nameKey);
      newNameKeys.push(n.nameKey);
      newNamePayloads.push({
        name: n.companyName.trim(), country: n.country,
        industry: n.industry, notes: n.notes,
        domain_status: "unresolved", created_by_job_id: ctx.createdByJobId,
      });
    }
  }

  const newlyInserted: string[] = [];

  if (newDomainPayloads.length > 0) {
    const chunks = chunk(newDomainPayloads, COMPANY_CHUNK);
    await runWithConcurrency(chunks, PARALLEL_CHUNKS, async (ck) => {
      try {
        const { data, error } = await supabase
          .from("companies")
          .upsert(ck as any, { onConflict: "domain", ignoreDuplicates: false })
          .select("id, domain");
        if (error) throw error;
        for (const c of data ?? []) {
          if (c.domain) {
            domainToId.set(c.domain, c.id);
            ctx.domainCache.set(c.domain, c.id);
          }
          newlyInserted.push(c.id);
        }
      } catch {
        for (const row of ck) {
          try {
            const { data: c } = await supabase
              .from("companies")
              .upsert(row as any, { onConflict: "domain", ignoreDuplicates: false })
              .select("id, domain").single();
            if (c?.domain) { domainToId.set(c.domain, c.id); ctx.domainCache.set(c.domain, c.id); }
            if (c?.id) newlyInserted.push(c.id);
          } catch { /* per-row failure absorbed in failed count below */ }
        }
      }
    });
  }

  if (newNamePayloads.length > 0) {
    const idxChunks = chunk(newNameKeys.map((_, i) => i), COMPANY_CHUNK);
    await runWithConcurrency(idxChunks, PARALLEL_CHUNKS, async (idxs) => {
      const ck = idxs.map((i) => newNamePayloads[i]);
      try {
        const { data, error } = await supabase.from("companies").insert(ck as any).select("id");
        if (error) throw error;
        (data ?? []).forEach((c: any, i: number) => {
          const key = newNameKeys[idxs[i]];
          if (key) { nameKeyToId.set(key, c.id); ctx.nameKeyCache.set(key, c.id); }
          newlyInserted.push(c.id);
        });
      } catch {
        for (let i = 0; i < ck.length; i++) {
          try {
            const { data: c } = await supabase.from("companies").insert(ck[i] as any).select("id").single();
            if (c?.id) {
              const key = newNameKeys[idxs[i]];
              if (key) { nameKeyToId.set(key, c.id); ctx.nameKeyCache.set(key, c.id); }
              newlyInserted.push(c.id);
            }
          } catch { /* swallow */ }
        }
      }
    });
  }

  // Track for resolver enqueue
  if (newlyInserted.length > 0) ctx.insertedCompanyIds.push(...newlyInserted);

  // ---- Build import_rows payloads ----
  type RowStatus = "matched" | "duplicate" | "failed";
  const importRowPayloads = normalized.map<any>((n) => {
    let companyId: string | null = null;
    let status: RowStatus = "failed";
    let errorMessage: string | null = null;

    if (n.domain) {
      companyId = domainToId.get(n.domain) ?? null;
      if (companyId) {
        const isDup = ctx.seenDomain.has(n.domain);
        ctx.seenDomain.add(n.domain);
        status = isDup && ctx.ignoreDuplicates ? "duplicate" : "matched";
      } else {
        status = "failed";
        errorMessage = "Could not create or match company by domain";
      }
    } else {
      companyId = nameKeyToId.get(n.nameKey) ?? null;
      if (companyId) {
        const isDup = ctx.seenNameKey.has(n.nameKey);
        ctx.seenNameKey.add(n.nameKey);
        status = isDup && ctx.ignoreDuplicates ? "duplicate" : "matched";
      } else {
        status = "failed";
        errorMessage = "Could not create company (name-only)";
      }
    }

    return {
      import_id: ctx.importId,
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

  const rowChunks = chunk(importRowPayloads, ROW_CHUNK);
  await runWithConcurrency(rowChunks, PARALLEL_CHUNKS, async (ck) => {
    try {
      const { error } = await supabase.from("import_rows").insert(ck as any);
      if (error) throw error;
    } catch {
      for (const r of ck) {
        try { await supabase.from("import_rows").insert(r as any); }
        catch { /* swallow */ }
      }
    }
  });

  return { matched, failed };
}

// ============================================================================
// Resolver enqueue (chunked, fire-and-forget)
// ============================================================================

function enqueueResolverWaves(ctx: PipelineCtx) {
  if (ctx.insertedCompanyIds.length === 0) return;
  const ids = ctx.insertedCompanyIds.splice(0, ctx.insertedCompanyIds.length);
  const waves = chunk(ids, RESOLVER_WAVE_SIZE);
  const totalParts = waves.length;
  // Cap parallel invokes; don't await
  let i = 0;
  const startNext = () => {
    while (ctx.resolverInflight.length < RESOLVER_PARALLEL && i < waves.length) {
      const partIndex = ctx.resolverWavesQueued + i;
      const ck = waves[i++];
      const p = supabase.functions.invoke("resolve-domains-batch", {
        body: { importId: ctx.importId, companyIds: ck, partIndex, totalParts: ctx.resolverWavesQueued + totalParts },
      }).catch(() => {}).finally(() => {
        const idx = ctx.resolverInflight.indexOf(p);
        if (idx >= 0) ctx.resolverInflight.splice(idx, 1);
        startNext();
      });
      ctx.resolverInflight.push(p);
    }
  };
  ctx.resolverWavesQueued += totalParts;
  startNext();
}

// ============================================================================
// Cancellation registry
// ============================================================================

const importControllers: Map<string, { cancelled: boolean }> = (globalThis as any).__importControllers ??= new Map();

export function cancelImport(importId: string): void {
  const c = importControllers.get(importId);
  if (c) c.cancelled = true;
  // Best-effort: mark the import row as failed immediately so UI reflects it.
  api.updateImport(importId, {
    status: "failed",
  }).catch(() => {});
  // Also annotate the most recent error_message-less stub via an empty row note? Skip — keep simple.
}

export function isImportCancelled(importId: string): boolean {
  return !!importControllers.get(importId)?.cancelled;
}

// ============================================================================
// Main entry
// ============================================================================

export async function runImport(args: RunImportArgs): Promise<string> {
  const { file, mapping, options } = args;

  // Normalize the `parsed` arg: accept legacy ParsedFile or new ParseResult.
  const parseResult: ParseResult = (args.parsed as any).kind
    ? (args.parsed as ParseResult)
    : { kind: "buffered", parsed: args.parsed as ParsedFile };

  const headers = parseResult.kind === "buffered" ? parseResult.parsed.headers : parseResult.headers;
  const emit = (phase: ImportPhase, processed: number, total: number) => args.onProgress?.(processed, total, phase);

  const colIdx = (target: Mapping[string]) => headers.findIndex((h) => mapping[h] === target);
  const col = {
    name: colIdx("company_name"),
    country: colIdx("country"),
    website: colIdx("website"),
    industry: colIdx("industry"),
    notes: colIdx("notes"),
  };
  if (col.name === -1) throw new Error("You must map a column to company_name");

  const defaultCountry = options.defaultCountry?.trim() || null;

  // Total: known up-front for buffered, unknown (0) for stream until done.
  const totalUpFront = parseResult.kind === "buffered" ? parseResult.parsed.rows.length : 0;
  if (totalUpFront > HARD_ROW_CAP) {
    throw new Error(`File exceeds ${HARD_ROW_CAP.toLocaleString()} row cap`);
  }

  const importRec = await api.createImport({
    file_name: file.name,
    file_type: file.name.split(".").pop()?.toLowerCase() ?? "csv",
    status: "processing",
    total_rows: totalUpFront,
    crawl_job_id: options.attachJobId,
  });

  const ctx: PipelineCtx = {
    importId: importRec.id,
    ignoreDuplicates: options.ignoreDuplicates,
    createdByJobId: options.createdByJobId ?? null,
    seenDomain: new Set(),
    seenNameKey: new Set(),
    domainCache: new LRU(20_000),
    nameKeyCache: new LRU(20_000),
    totalRows: totalUpFront,
    processedRows: 0,
    matchedRows: 0,
    failedRows: 0,
    insertedCompanyIds: [],
    resolverWavesQueued: 0,
    resolverInflight: [],
  };

  const controller = { cancelled: false };
  importControllers.set(ctx.importId, controller);

  emit("matching", 0, totalUpFront);

  const runOneBatch = async (rows: string[][]) => {
    try {
      const { matched, failed } = await processBatch(ctx, rows, col, defaultCountry);
      ctx.matchedRows += matched;
      ctx.failedRows += failed;
      ctx.processedRows += rows.length;
    } catch (e: any) {
      const errMsg = String(e?.message ?? e);
      ctx.failedRows += rows.length;
      ctx.processedRows += rows.length;
      const stub = rows.map((r) => ({
        import_id: ctx.importId,
        company_name: (r[col.name] ?? "").trim() || "Unknown",
        country: (col.country >= 0 ? r[col.country] : null) || defaultCountry || null,
        status: "failed" as const,
        error_message: errMsg.slice(0, 500),
      }));
      try { await supabase.from("import_rows").insert(stub as any); } catch { /* swallow */ }
    }

    if (ctx.totalRows < ctx.processedRows) ctx.totalRows = ctx.processedRows;
    emit("saving", ctx.processedRows, ctx.totalRows);
    api.updateImport(ctx.importId, {
      processed_rows: ctx.processedRows,
      matched_rows: ctx.matchedRows,
      failed_rows: ctx.failedRows,
      total_rows: ctx.totalRows,
    }).catch(() => {});

    if (ctx.insertedCompanyIds.length >= RESOLVER_WAVE_SIZE * 2) {
      enqueueResolverWaves(ctx);
    }
  };

  let cancelledMidRun = false;
  try {
    if (parseResult.kind === "buffered") {
      const allRows = parseResult.parsed.rows;
      const batches = chunk(allRows, BATCH_SIZE);
      for (const batch of batches) {
        if (controller.cancelled) { cancelledMidRun = true; break; }
        await runOneBatch(batch);
      }
    } else {
      await parseResult.iterate(async (rows) => {
        if (controller.cancelled) { cancelledMidRun = true; return; }
        await runOneBatch(rows);
      });
    }

    if (cancelledMidRun) {
      await api.updateImport(ctx.importId, {
        status: "failed",
        processed_rows: ctx.processedRows,
        matched_rows: ctx.matchedRows,
        failed_rows: ctx.failedRows,
        total_rows: ctx.totalRows,
      });
      emit("done", ctx.processedRows, ctx.totalRows);
      return ctx.importId;
    }

    enqueueResolverWaves(ctx);

    await api.updateImport(ctx.importId, {
      status: ctx.processedRows > 0 && ctx.failedRows === ctx.processedRows ? "failed" : "completed",
      processed_rows: ctx.processedRows,
      matched_rows: ctx.matchedRows,
      failed_rows: ctx.failedRows,
      total_rows: ctx.processedRows,
    });

    emit("done", ctx.processedRows, ctx.processedRows);

    if (ctx.resolverWavesQueued === 0) {
      supabase.functions.invoke("resolve-domains-batch", { body: { importId: ctx.importId } }).catch(() => {});
    }

    return ctx.importId;
  } finally {
    importControllers.delete(ctx.importId);
  }
}

// ============================================================================
// Restart: re-process an existing import from its stored import_rows.
// No file required — uses what's in the DB.
// ============================================================================

export async function restartImport(
  importId: string,
  onProgress?: (processed: number, total: number, phase?: ImportPhase) => void,
): Promise<string> {
  const imp = await api.getImport(importId);
  if (!imp) throw new Error("Import not found");

  const rows = await api.listImportRows(importId);
  const total = rows.length;

  await api.updateImport(importId, {
    status: "processing",
    processed_rows: 0,
    matched_rows: 0,
    failed_rows: 0,
    total_rows: total,
  });

  const controller = { cancelled: false };
  importControllers.set(importId, controller);

  const ctx: PipelineCtx = {
    importId,
    ignoreDuplicates: true,
    createdByJobId: null,
    seenDomain: new Set(),
    seenNameKey: new Set(),
    domainCache: new LRU(20_000),
    nameKeyCache: new LRU(20_000),
    totalRows: total,
    processedRows: 0,
    matchedRows: 0,
    failedRows: 0,
    insertedCompanyIds: [],
    resolverWavesQueued: 0,
    resolverInflight: [],
  };

  const emit = (phase: ImportPhase) => onProgress?.(ctx.processedRows, ctx.totalRows, phase);
  emit("matching");

  const keepMatched = rows.filter((r) => r.matchedCompanyId && (r.status === "matched" || r.status === "duplicate"));
  const toRetry = rows.filter((r) => !(r.matchedCompanyId && (r.status === "matched" || r.status === "duplicate")));

  ctx.matchedRows += keepMatched.length;
  ctx.processedRows += keepMatched.length;
  for (const r of keepMatched) {
    if (r.matchedDomain) ctx.seenDomain.add(r.matchedDomain);
    const nk = `${r.companyName.trim().toLowerCase()}|${(r.country ?? "").toLowerCase()}`;
    ctx.seenNameKey.add(nk);
  }
  emit("saving");
  api.updateImport(importId, {
    processed_rows: ctx.processedRows,
    matched_rows: ctx.matchedRows,
    total_rows: ctx.totalRows,
  }).catch(() => {});

  const col = { name: 0, country: 1, website: 2, industry: 3, notes: 4 };

  try {
    const batches = chunk(toRetry, BATCH_SIZE);
    for (const batch of batches) {
      if (controller.cancelled) {
        await api.updateImport(importId, {
          status: "failed",
          processed_rows: ctx.processedRows,
          matched_rows: ctx.matchedRows,
          failed_rows: ctx.failedRows,
          total_rows: ctx.totalRows,
        });
        return importId;
      }

      const ids = batch.map((r) => r.id);
      try { await supabase.from("import_rows").delete().in("id", ids); } catch { /* swallow */ }

      const synthetic: string[][] = batch.map((r) => [
        r.companyName ?? "",
        r.country ?? "",
        r.website ?? "",
        r.industry ?? "",
        r.notes ?? "",
      ]);

      try {
        const { matched, failed } = await processBatch(ctx, synthetic, col, null);
        ctx.matchedRows += matched;
        ctx.failedRows += failed;
        ctx.processedRows += synthetic.length;
      } catch (e: any) {
        ctx.failedRows += synthetic.length;
        ctx.processedRows += synthetic.length;
        const errMsg = String(e?.message ?? e);
        const stub = synthetic.map((r) => ({
          import_id: importId,
          company_name: r[0] || "Unknown",
          country: r[1] || null,
          status: "failed" as const,
          error_message: errMsg.slice(0, 500),
        }));
        try { await supabase.from("import_rows").insert(stub as any); } catch { /* swallow */ }
      }

      emit("saving");
      api.updateImport(importId, {
        processed_rows: ctx.processedRows,
        matched_rows: ctx.matchedRows,
        failed_rows: ctx.failedRows,
        total_rows: ctx.totalRows,
      }).catch(() => {});

      if (ctx.insertedCompanyIds.length >= RESOLVER_WAVE_SIZE * 2) {
        enqueueResolverWaves(ctx);
      }
    }

    enqueueResolverWaves(ctx);

    await api.updateImport(importId, {
      status: ctx.processedRows > 0 && ctx.failedRows === ctx.processedRows ? "failed" : "completed",
      processed_rows: ctx.processedRows,
      matched_rows: ctx.matchedRows,
      failed_rows: ctx.failedRows,
      total_rows: ctx.totalRows,
    });

    emit("done");

    if (ctx.resolverWavesQueued === 0) {
      supabase.functions.invoke("resolve-domains-batch", { body: { importId } }).catch(() => {});
    }

    return importId;
  } finally {
    importControllers.delete(importId);
  }
}
