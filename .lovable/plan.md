

## Goal

Take the import → domain resolution flow from "decent" to **world-class**: dramatically higher hit rate (target 80%+ on Nordic SMB lists like the current Behandlingshem job), fewer wrong domains, and clearer recovery paths.

## Root causes observed

Looking at the current 977 unresolved + 102 failed companies on job `5f6d2017…`:

1. **Country signal is missing end-to-end.** The `crawl_jobs.country` for that job is `NULL` — so inheritance does nothing, and the search query becomes `"Edetstens Behandlingshem" official website` with no Sweden hint, no `.se` TLD bias, no `sv` lang to Firecrawl. Most Nordic SMB sites only rank well on `google.se`.
2. **Country isn't captured during job/import creation.** The Create Job form lets you upload a file *and* set a country, but the country isn't propagated when no country column is mapped, and it isn't backfilled onto already-imported companies.
3. **Name-only dedup is too aggressive.** `ilike "<name>"` reuses any prior company with that exact name even if its previous resolution failed and was never retried — those 937 unresolved are mostly old shells.
4. **Single-source candidates.** We only use Firecrawl `/search`. We never try **Firecrawl `/map`** on guessed homepages (`<slug>.se`, `<slug>.com`), which would catch the 30–40% of small businesses whose own site doesn't rank in the top 10 search results.
5. **Verification scrapes `/` only.** Many small business homepages are SPAs / image-only / redirect chains. We reject good candidates because no name token appears in the rendered HTML.
6. **No tiebreaker for ambiguous cases.** When two candidates score equally we pick arbitrarily; Lovable AI Gateway can pick the right one almost for free.
7. **No learning loop.** A wrong domain accepted once stays wrong forever; users can't easily mark a domain wrong and trigger a re-resolve.

## Changes

### 1. Capture & propagate country aggressively (frontend + edge function)

- **`CreateJob.tsx` / import pipeline**: when the user picks a country on the job form, write it onto every newly-created `companies` row in `runImport` (not just when the CSV has a country column). Also set it on the parent `crawl_jobs` row (already does this — verify).
- **`resolve-domains-batch`**: at the start of a `jobId` run, if `crawl_jobs.country` is set, **UPDATE all companies for that job that have null country to the job's country** in one statement, then proceed.
- **Country normalization map** (server + client): accept "SE", "Sverige", "Sweden", swedish flag emoji, etc., and normalize to the canonical key used in `COUNTRY_HINTS`.

### 2. Smarter dedup during import

- Change the name-only dedup in `runImport` from `ilike "<name>"` to a **scoped lookup**: only reuse an existing company if `(name ILIKE x AND (country = importCountry OR country IS NULL) AND domain_status = 'resolved')`. Otherwise create a new row. This stops 937 unresolved shells from being silently re-attached.
- Add a `created_by_job_id` (column already exists, currently unused) when a company is freshly created, so we can scope retries.

### 3. Multi-source candidate generation in `resolveOne`

Instead of search-only, generate candidates from **three sources in parallel**, then merge & rank:

1. **Firecrawl `/search`** — current behavior, but with the cleaner queries already in place plus one new query: `site:.<tld> "<cleanName>"` when a country TLD is known (e.g., `site:.se "Edetstens Behandlingshem"`).
2. **Slug-based homepage probes** — build 4–6 candidate hostnames from the cleaned name:
   - `<slug>.<countryTld>` (e.g. `edetstensbehandlingshem.se`)
   - `<slug-with-hyphens>.<countryTld>`
   - `<acronym>.<countryTld>` (first letters of each word, only if 3+ words)
   - same three with `.com`
   
   Issue a **HEAD request** (with redirect-follow) to each; keep the ones that return 2xx. Score them with the existing `scoreCandidate` (exact-stem match → score 4+). This is essentially free and catches the long tail.
3. **Firecrawl `/map`** on the top search result's domain — only when the top search candidate scores 3–4 (borderline). `map` returns canonical homepage URL fast and often resolves redirects/company-group sites.

### 4. Better verification

Loosen `verifyHomepage`:
- Scrape the homepage AND the first internal "about/kontakt/contact" link found in the HTML (one extra request, only for borderline cases scoring 2–3).
- In addition to the existing title/og/h1/meta-desc check, look for the cleaned name (or its ASCII fold) anywhere in the **entire scraped markdown** (not just specific tags). Title-only check fails for image-only branded sites.
- Accept automatically when **registered domain stem == any name token** (already done) **OR** when domain is `<slug>.<expected-country-tld>` and HEAD returned 200 (no scrape needed at all).

### 5. LLM tiebreaker via Lovable AI (free, gated)

When the top two candidates are within 1 point of each other AND the leader scores < 5, send a tiny prompt to `google/gemini-2.5-flash-lite` via Lovable AI Gateway:
> "Company name: X (country: Sweden). Pick the most likely official homepage from these candidates: [list of {host, title, snippet}]. Reply with only the host or 'none'."

Only ~5–10% of companies trigger this, so cost is negligible. Massive accuracy boost on ambiguous Nordic / generic-name cases.

### 6. Recovery & feedback loop

- **Companies page row action "Mark domain wrong"**: clears `domain`/`website`, sets `domain_status = 'failed'`, and inserts the wrong host into a new `domain_blocklist` table (per-company OR global). Subsequent re-resolve runs skip that host for that company.
- **JobDetail "Re-resolve all"** button (in addition to existing "Resolve domains" and "Retry failed"): forces re-resolution of every company in the job regardless of current `domain_status` — useful after improving the algorithm or fixing the country.
- **Per-company resolution detail**: on `CompanyDetail.tsx`, show the candidates considered and the query that succeeded (already logged in `crawl_logs.meta_json`). Helps users understand and trust the result.

### 7. Concurrency, throttling, observability

- Bump `CONCURRENCY` 8 → 12 for slug-probe + HEAD requests (search itself stays at 8 to respect Firecrawl).
- Add structured `crawl_logs` for every resolution: `{ company, country, queries_tried, candidates_top3, source: search|slug|map|llm, score }`. Makes future tuning data-driven.
- Per-company timeout cap of 30 s so one slow scrape can't stall a batch.

## New table

```sql
create table public.domain_blocklist (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,            -- null = global block
  host text not null,
  reason text,
  created_at timestamptz not null default now(),
  unique (company_id, host)
);
alter table public.domain_blocklist enable row level security;
create policy "public read" on public.domain_blocklist for select using (true);
create policy "public write" on public.domain_blocklist for insert with check (true);
```

## Files to change

- `supabase/functions/resolve-domains-batch/index.ts` — slug probes, map fallback, LLM tiebreaker, broader verifier, country backfill at start, blocklist filter, structured logs
- `supabase/functions/resolve-domain/index.ts` — same upgrades (single-shot path)
- `src/lib/importPipeline.ts` — country propagation from job, scoped dedup, write `created_by_job_id`
- `src/pages/CreateJob.tsx` — pass selected country into import options (frontend step)
- `src/pages/Companies.tsx` — "Mark domain wrong" row action
- `src/pages/CompanyDetail.tsx` — show resolution detail (candidates + winning query)
- `src/pages/JobDetail.tsx` — "Re-resolve all" button next to existing two
- `supabase/migrations/<new>.sql` — `domain_blocklist` table

## Recovery plan after deploy

1. Open job `5f6d2017…` → Settings → set country to **Sweden** (currently null) → Save.
2. Click **Re-resolve all**. With Sweden hint + slug probes + `.se` TLD bias, expect the unresolved+failed pool (~1079 companies) to drop by 60–80%.

## Success criteria

- **Hit rate** on the current Swedish "Behandlingshem" job rises from ~26% (377/1456) to ≥ 75%.
- New imports with a country set on the job get country propagated automatically; logs show which source (search / slug / map / llm) found each domain.
- Users can mark a wrong domain and re-run resolution to fix it without manual SQL.
- No regression in average per-company latency (< 4 s p50, < 10 s p95).

