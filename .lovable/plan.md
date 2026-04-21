

## Goal

Fix the crawl so it actually scrapes emails for uploaded jobs instead of finishing in 10 seconds with "1 company processed, 432 skipped (no domain)".

## Root cause

When you press **Run** on an uploaded job, two things happen in parallel:

1. `resolve-domains-batch` starts resolving domains for ~430 companies — this takes several minutes.
2. `scrape-emails-batch` is invoked immediately by `jobSimulator.maybeKickOffBatch`.

The scraper reads the companies *right now*, sees only **1** with a resolved `domain`, scrapes that one, then marks the job **completed / progress 100**. The other ~430 companies finish resolving minutes later but are never scraped — because the job is already "completed".

Evidence from this job (`0fe1d3f7…`):
- `12:18:24` — log: *"Starting scrape: 1 companies with resolved domains, 432 skipped (no domain)"*
- `12:18:32` — job marked `completed`, `companies_found = 1`
- `12:42:47` and onward — resolver is still logging *"Resolved … → …"* for the same job's companies

## Fix

### 1. Make `scrape-emails-batch` wait for domain resolution to finish

In `supabase/functions/scrape-emails-batch/index.ts`, before computing `todo`:

- Count how many of this job's companies still have `domain_status IN ('pending','resolving',NULL)` AND no `domain`.
- If any are still pending, **don't mark the job completed**. Instead:
  - Log: *"Waiting on domain resolution: N of M companies still pending."*
  - Schedule a re-invocation of `scrape-emails-batch` after ~20s (using `EdgeRuntime.waitUntil` + `setTimeout` + `fetch` to itself), then return `202`.
- Only proceed to `runPool` over the resolved subset once **all** companies are either `resolved` or `failed` (i.e. resolution is finished).

This turns the function into a self-polling loop that picks up the work as soon as the resolver catches up, without holding a single 150 s edge invocation open.

### 2. Scrape resolved companies in waves instead of waiting for *everything*

Pure waiting is brittle on huge imports. Better: process in waves.

- On each invocation, pick companies for this job that have `domain IS NOT NULL` AND **haven't been scraped yet** (no `source_pages` row with `crawl_job_id = jobId` for that company, OR a new `companies.scrape_status` column — simpler: use a small `scraped_company_ids` set derived from `source_pages`).
- Scrape that wave with the existing concurrency pool.
- After the wave: if any companies for the job are still `pending/resolving`, re-invoke self in ~15 s and return. Otherwise mark `completed`.

This way the user sees contacts trickling in as domains resolve, instead of one burst at the end.

### 3. Stop the premature "completed" status

Remove the `update crawl_jobs set status='completed', progress=100` calls from the early-exit branches (`todo.length === 0`, no imports). Replace with the wait/re-invoke path above. Only set `completed` when **both** resolution is done AND every resolved company has been scraped.

### 4. UI: clarify "Waiting on resolution" on the job timeline

In `src/pages/JobDetail.tsx`, when the job is `running` and `domainStats` shows `unresolved > 0`, show a small banner under the progress bar:
*"Resolving domains: X of Y done — scraping will start automatically."*

This reuses the existing `domainStats` query (already polling every 5 s), no new endpoints.

### 5. Recover the broken job

Add a one-shot recovery: on `JobDetail` mount, if a job is `completed` but `companies_found < domainStats.resolved` AND `imports` exist, show a **"Resume scraping"** button that flips status back to `running` and re-invokes `scrape-emails-batch`. This lets the user fix the current `0fe1d3f7…` job (and any others stuck in the same state) with one click instead of starting over.

## Files to change

- `supabase/functions/scrape-emails-batch/index.ts` — wait/wave loop, self re-invocation, don't prematurely complete.
- `src/lib/jobSimulator.ts` — no change needed (it already only invokes once; the re-invocation is server-side).
- `src/pages/JobDetail.tsx` — "waiting on resolution" banner + "Resume scraping" recovery button.

No DB migration. No new dependencies.

## Success criteria

- Pressing **Run** on an uploaded job with 400+ companies eventually scrapes **every company that resolves a domain**, not just the handful resolved in the first 10 s.
- The job stays in `running` state until both resolution and scraping are done; then it flips to `completed` with accurate `companies_found`.
- The current stuck job (`Crawl: Målerier – test.xlsx`) can be resumed via the new button and processes the remaining ~155 resolved companies (and any that resolve afterwards).
- Timeline shows a clear "Resolving domains: X/Y" status while the resolver is still working.

