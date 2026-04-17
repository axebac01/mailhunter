

## Improvements to the domain → email pipeline

The current pipeline works but has several real weaknesses I'd recommend tightening. Grouped by impact.

### High impact

1. **Resolve domains in parallel during import** — today `runImport` awaits `tryResolveDomain` for every name-only row sequentially. A 200-row file = 200 sequential Firecrawl Search calls (~5–10 minutes). Switch to a small concurrency pool (e.g. 5 in flight) per import.

2. **Move domain resolution server-side in batches** — a new `resolve-domains-batch` edge function that takes `{ companyIds: [] }` and resolves them with proper concurrency, retries, and a single auth context. The browser tab can be closed without halting work.

3. **Scrape one company at a time → too slow for big jobs.** `jobSimulator.tick()` runs every 6s and scrapes one company per tick. For 100 companies that's 10 minutes of wall time on a tab that has to stay open. Replace with a `scrape-emails-batch` edge function invoked once when the job starts; it loops through resolved companies with concurrency 3–5 and updates job counters itself. The simulator becomes just a polling/refresh loop.

4. **Better domain confidence scoring** — current heuristic in `resolve-domain` just counts token matches. Improvements:
   - Verify the candidate by fetching its homepage and checking that the company name actually appears in `<title>` / og tags.
   - Penalize when the TLD doesn't match the country (e.g. Swedish company → prefer `.se`).
   - Reject when the only match is in a path/subdomain of a generic host.

### Medium impact

5. **Add a "Resolve domains" button on Job Detail** — manually trigger re-resolution for `unresolved`/`failed` companies in the linked imports without re-importing.

6. **Persist `not_found` as a contact row** (or a dedicated `company_status`) so the UI shows "No public emails found" per company instead of just "0 contacts". Currently this only goes to the log.

7. **Smarter contact-page discovery** — `firecrawlMap` returns up to 50 links and we keep at most 6 matched + homepage. Add `/imprint`, `/legal`, `/press`, `/karriere`, `/jobs`, `/staff`, `/leadership`. For German/Nordic sites the impressum is usually the gold mine.

8. **Decode obfuscated emails** — many sites write `info [at] example [dot] com` or hex-encoded mailto. Add a normalization pass before the regex.

9. **Cache Firecrawl results** — store `last_scraped_at` on `companies` and skip re-scraping within e.g. 7 days unless the user clicks "Re-scrape".

### Low impact / polish

10. **Phone normalization** — current regex returns raw strings like `+46 8 506 100 00`; normalize to E.164 and dedupe.
11. **Replace the `tab-must-stay-open` simulator** for uploaded jobs with realtime subscriptions on `crawl_jobs` so the UI just reflects server progress.
12. **Surface Firecrawl errors clearly** — 402 (insufficient credits) should show a banner with the top-up CTA, not silently log "Scrape failed".

### Recommended scope for this round

The biggest user-visible wins are **#1, #2, #3, #5**. Suggested deliverables:

- New edge function `resolve-domains-batch` (concurrency 5, retries 1).
- New edge function `scrape-emails-batch` (concurrency 3, updates `crawl_jobs` counters directly).
- `JobDetail.tsx`: "Resolve domains" button + change Start to invoke `scrape-emails-batch` instead of the per-tick simulator path.
- `jobSimulator.ts`: for `uploaded` jobs, stop driving scrapes from the client — just refresh queries while the server batch runs.
- Keep `resolve-domain` and `scrape-emails` (single-company) as building blocks used by both batch functions and ad-hoc retries.

### Files touched
- `supabase/functions/resolve-domains-batch/index.ts` (new)
- `supabase/functions/scrape-emails-batch/index.ts` (new)
- `supabase/functions/resolve-domain/index.ts` (improve scoring + homepage verification)
- `src/lib/jobSimulator.ts` (uploaded jobs → poll-only)
- `src/lib/importPipeline.ts` (skip per-row resolve; enqueue a batch resolve at the end)
- `src/pages/JobDetail.tsx` (Resolve domains button, hook Start to batch scrape)

### Out of scope
- Paid email finders (Hunter/Apollo), MX verification, obfuscation decoding (deferred to round 2).
- Backfilling old fake `@null` rows (use existing Clear contacts).

