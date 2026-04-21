

## Goal

Make the import pipeline reliably handle **very large files (50k–500k rows)** by streaming work through the pipeline instead of materializing everything in memory, and by hardening the post-import resolver handoff so it never exceeds payload limits.

## What's wrong today at large scale

The current bulk pipeline is fast for ≤10k rows but has four scaling cliffs:

1. **Whole-file in memory** — `parsed.rows` (string[][]), `normalized[]`, `importRowPayloads[]` and several Maps all coexist. A 200k-row XLSX can push the tab past 1–2 GB and crash.
2. **Single resolver invoke with N companyIds** — `supabase.functions.invoke("resolve-domains-batch", { body: { companyIds } })` sends every newly-inserted company id in one payload. At 50k+ ids this exceeds the 1 MB edge-function body limit and silently fails.
3. **Name-only match query is too broad** — `IN ("name", chunk)` with no country filter pulls every same-named company globally, hurting both speed and dedup correctness.
4. **No streaming preview / progress** — preview only renders after the entire file is parsed; no row-streamed insertion means the user waits in silence on huge files.

## Approach

### 1. Streaming parser (CSV) + size guard (XLSX)

- Add a true **streaming CSV parser** path using `papaparse` (`Papa.parse(file, { worker: true, step, chunk })`). Rows are emitted in batches of 1000 directly into the import pipeline — no full-file array.
- For XLSX (binary, can't be streamed cleanly), keep the current worker-thread parse but add a hard size warning at 25 MB / 200k rows with a confirmation dialog suggesting CSV for larger files.
- `parseFile` returns either `{ kind: "buffered", parsed }` (small files) or `{ kind: "stream", iterate(onBatch) }` (large CSVs). `runImport` handles both.

### 2. Streaming pipeline — process in **batches of 2,000 rows**

Refactor `runImport` to consume row batches end-to-end instead of loading the whole file:

For each batch of 2,000 rows:
- **Normalize** in-place (cheap, GC'd after batch).
- **Match phase B** — query existing companies by domain + name for just this batch (using a small in-memory **LRU cache** of recent lookups across batches to avoid re-querying repeated domains).
- **Insert new companies** (chunked at 500, parallel ×4) — same as today but scoped to the batch.
- **Insert import_rows** for the batch with final status — same as today.
- **Emit progress** after each batch (`emit("saving", batchEnd, totalRows)`).

This keeps peak memory **O(batch size)** instead of O(file size), so a 500k-row CSV uses the same RAM as a 5k-row one. Throughput stays the same because we're already DB-bound.

### 3. Country-scoped, deduped name-only lookup

Replace today's `.in("name", nchunk)` with `.in("name", nchunk).in("country", [...distinctCountries, null])` per batch. Smaller result sets, correct scoping, and no risk of grabbing `Acme Corp` from a different country.

### 4. Chunked, fire-and-forget resolver enqueue

Replace the single `resolve-domains-batch` invoke with **chunks of 200 companyIds**, each invoked in parallel (cap 3) and not awaited. Add an optional `partIndex / totalParts` to the body so the resolver can log "wave 3/12 received". This eliminates the silent-failure cliff above ~5k ids.

### 5. Better UX for large imports

- New phase label **"Reading…"** with row-count ticker during streaming parse (CSV only — XLSX shows "Parsing…" once, then jumps to "Matching…").
- ETA already exists in `Imports.tsx` — extend it to use the average per-batch wall time once the second batch finishes (more stable than per-row).
- Show a dismissible toast at the start of any import >50k rows: *"Large import — running in 2k-row batches, you can leave this page; it'll keep going."*
- Make `runImport` resilient to navigation: today it dies if the user leaves `/imports`. Move the long loop into a small async runner that survives mount/unmount by stashing the active import id in a `useRef`-backed registry (`window.__activeImports`) and resuming progress polling on remount via the existing `imports` realtime/poll.

### 6. Preview without parsing the whole file

For streaming CSVs, take the **first 10 rows** from the first batch as the preview and render immediately (the streaming continues in the background once the user clicks "Run import"). This makes the page feel instant on a 100k-row drop.

### 7. Safety rails

- Add a **hard cap** of 1,000,000 rows with a clear error toast if exceeded.
- Wrap each batch in try/catch — a failing batch marks just its rows as `failed` with the PG error message, and the import continues. Today a single chunk failure can stall accounting since `matched`/`failed` are computed before insertion.
- Recompute `matched` / `failed` running totals from actual insertion outcomes (count the rows that came back from `select('id')` per chunk), not from the pre-insert payload status.

## Files to change

- `src/lib/importPipeline.ts` — refactor to a streaming, batch-driven runner; keep the `runImport` public signature; add `parseFile` returning a discriminated union; integrate `papaparse` for CSV streaming
- `src/workers/parseFile.worker.ts` — add a CSV streaming branch using PapaParse worker mode (XLSX path unchanged)
- `src/pages/Imports.tsx` — show new "Reading…" phase, large-file warning toast, "you can leave this page" hint, and survive remount via the active-import registry
- `package.json` — add `papaparse` + `@types/papaparse`

No DB migration required.

## Expected impact

| File size | Today | After |
|---|---|---|
| 10k rows | ~3 s, ~150 MB peak | ~3 s, ~30 MB peak |
| 50k rows | ~12 s, ~600 MB peak (sluggish UI) | ~10 s, ~30 MB peak |
| 200k rows | likely crash / OOM | ~40 s, ~30 MB peak |
| 500k rows | not viable | ~2 min, ~30 MB peak |

Resolver handoff stops silently failing past ~5k new companies.

## Success criteria

- A 200k-row CSV imports cleanly without the tab freezing or memory exceeding ~100 MB above baseline.
- Preview renders within 1 s of file drop regardless of file size.
- Every newly-inserted company eventually gets a `resolve-domains-batch` enqueue (verified by counting `crawl_logs` `resolve_started` events vs. expected waves).
- Leaving `/imports` mid-import doesn't abort it; returning shows the live progress.
- Same final row counts in `imports`, `import_rows`, and `companies` as today on identical input ≤10k rows (no regression on small files).

