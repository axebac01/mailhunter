

## Goal

Make the import pipeline 10–50× faster and more robust by replacing the sequential row-by-row loop with **bulk set-based operations**, while keeping the existing UX (live progress, status per row, scoped dedup, fire-and-forget domain resolver).

## Root causes of current slowness

For an N-row import, today we make roughly **2N+ sequential round-trips** to the database:
1. For each row: 1 SELECT (dedup) + 1 INSERT (new company) + 1 UPDATE (`import_rows`).
2. Progress UPDATE on `imports` every 5 rows.
3. No parallelism — entirely serial `await` in a `for` loop.

On a 1500-row file with ~80 ms latency that's **~4–5 minutes of pure round-trip time**, before any actual work.

## Approach

### 1. Bulk-first pipeline (server-side set operations)

Replace the per-row loop with **5 set-based phases**, each one or two SQL statements:

**Phase A — Parse & normalize in-memory (no DB):**
- Parse the file (already fast).
- For every row, compute `domain` from `website` once.
- Lowercase & trim names; normalize country (reuse normalization map from resolver).
- Bucket rows into two arrays: `withDomain[]` and `nameOnly[]`.

**Phase B — Bulk-fetch existing companies in 2 queries:**
- One `SELECT id, domain FROM companies WHERE domain = ANY($1)` for every distinct domain in `withDomain`.
- One `SELECT id, lower(name) AS name, country FROM companies WHERE domain_status='resolved' AND lower(name) = ANY($1) AND (country = ANY($2) OR country IS NULL)` for every distinct name in `nameOnly`.
- Build two in-memory lookup maps (`domainToId`, `nameKeyToId`).

**Phase C — Bulk-insert all new companies in chunks of 500:**
- For rows whose domain/name didn't match, build company insert payloads.
- Single `supabase.from('companies').insert(chunk).select('id, domain, name')` per chunk.
- Merge returned ids back into the lookup maps.
- Use Postgres `ON CONFLICT` semantics where possible — for `domain`, attempt an upsert with `onConflict: 'domain', ignoreDuplicates: false` to atomically dedupe in case two rows in the same import share a domain.

**Phase D — Bulk-insert all `import_rows` with their final status in one shot per chunk:**
- Today we insert all rows as `pending` first, then UPDATE each one. Eliminate the UPDATE entirely by inserting them with their final `status` + `matched_company_id` + `matched_domain` already set, in chunks of 500.
- This removes N updates → 0 updates.

**Phase E — Single final UPDATE on `imports`:**
- One UPDATE with totals: `processed_rows`, `matched_rows`, `failed_rows`, `status='completed'`.
- Progress updates during phases C/D fire every chunk (every ~500 rows) instead of every 5.

### 2. Parallelize chunk inserts

- Run chunked company inserts and chunked `import_rows` inserts with `Promise.all` over chunks (cap concurrency at 4 to be polite to the DB).
- For a 1500-row file this is ~3 chunks of 500, all in parallel — ~1 round-trip worth of latency.

### 3. Preserve in-import dedup

When two rows in the same file have the same domain or same `(name, country)`:
- **Same domain**: collapse into one company insert; both `import_rows` point to the same `matched_company_id` with the second marked `duplicate` (when `ignoreDuplicates` is on).
- **Same name+country (name-only)**: same collapse logic via in-memory map keyed by `lower(name)|country`.

This is impossible to do cleanly in the current per-row loop and is a real correctness improvement, not just a perf one.

### 4. Parser performance

- For large files (>5k rows), parse off the main thread:
  - Add a tiny `src/workers/parseFile.worker.ts` that runs `XLSX.read` + `sheet_to_json`.
  - `parseFile()` posts the file to the worker and resolves with the parsed shape.
  - Keeps the UI responsive on 50k-row uploads.
- Stream `xlsx` with `dense: true` and skip empty rows during parse to reduce memory.

### 5. Better progress UX

- Switch progress from "rows processed" to **3 phase markers**: *Parsing → Matching → Saving*, plus row-count on the active phase.
- Live counter in `Imports.tsx` updates per chunk (already wired through `onProgress`, just emit phase + counts).
- Show estimated time remaining once we've completed one chunk (simple linear extrapolation).

### 6. Resilience

- Wrap each chunk insert in try/catch; on chunk failure, fall back to per-row insert **for that chunk only** so one bad row doesn't blow up 499 good ones.
- Mark unrecoverable rows as `failed` with `error_message` set from PG error.
- Final summary toast: "Imported 1500 rows in 4.2s — 1487 matched, 13 failed".

### 7. Don't block the resolver enqueue

- After Phase E, fire-and-forget `resolve-domains-batch` exactly as today (no change).
- Bonus: pass `companyIds` array directly so the resolver doesn't need to re-query unresolved companies for this import.

## Files to change

- `src/lib/importPipeline.ts` — rewrite `runImport` with bulk phases A–E; keep public API (`runImport`, `parseFile`, `autoMap`, types) identical so callers don't change
- `src/workers/parseFile.worker.ts` — new web worker for off-thread parsing
- `src/lib/api.ts` — add `bulkInsertCompanies(rows, chunk)`, `bulkInsertImportRowsWithStatus(rows, chunk)`, `findCompaniesByDomains(domains[])`, `findResolvedCompaniesByNames(names[], countries[])`
- `src/pages/Imports.tsx` — show phase + ETA in the progress bar (small UX upgrade)
- `supabase/functions/resolve-domains-batch/index.ts` — accept optional `companyIds` array to skip the unresolved-company query

No DB migration required.

## Expected impact

Measured on a typical 1500-row file (current ~3–5 min):
- Round-trips drop from ~3000 to ~10.
- Wall time target: **< 5 seconds** end-to-end (excluding the post-import domain resolver, which runs server-side).
- Dedup correctness: duplicate rows within the same file now collapse cleanly instead of racing.

## Success criteria

- 1500-row import completes in < 5 s on a typical connection.
- 10k-row import completes in < 30 s and doesn't freeze the UI (worker parse).
- Same final row counts in `imports`, `import_rows`, `companies` as the current implementation on identical input.
- Domain resolver still kicks off automatically and processes the same set of unresolved companies.

