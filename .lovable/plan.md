

## Goal

Significantly improve the domain-resolution hit rate for batch jobs. Currently 977/1456 companies are unresolved and 136 failed (most are small Swedish companies with `AB`/`Aktiebolag` suffixes and Nordic characters). Three problems compound:

1. The **company `country` field is empty** — we never apply country-TLD bonuses or country-localized searches, even though the parent job has `country = "Sweden"`.
2. The **search query is noisy** (legal suffixes like `AB`, `Aktiebolag` are sent to Firecrawl) and **only one query is tried** — no fallback if the first attempt returns Wikipedia/LinkedIn-only results.
3. **No way to retry only failed companies** — failures stick.

## Changes

### 1. Inherit country from the parent job (`resolve-domains-batch`)

When called with `jobId` or `importId`, fetch the parent `crawl_jobs.country` once and pass it into `resolveOne` for any company whose own `country` is null. Also persist it back to `companies.country` so the country shows in the UI and downstream features benefit.

### 2. Cleaner search query + name normalization

- Strip legal-form suffixes (`AB`, `Aktiebolag`, `Oy`, `GmbH`, `Ltd`, `Inc`, `LLC`, `SA`, `SpA`, `PLC`, `BV`, `AS`, `ApS`) from the query string itself, not just from token scoring.
- Build two normalized name variants: original (with diacritics) and ASCII-folded (`ö→o`, `å→a`). Search both — many Swedish domains drop accents (e.g. `osterlenportens.se` for `Österlenportens`).
- Pass `country` and `lang` hints to Firecrawl Search (`country: "se"`, `lang: "sv"` for Sweden, etc.) for more relevant results.

### 3. Two-pass search with fallback queries

Per company, try queries in order until a candidate scores ≥ 4:
1. `"<clean name>" <country> kontakt` (Swedish: "kontakt", DE: "kontakt", etc. — country-aware "contact" word biases toward homepages)
2. `<clean name> <country>` (no quotes — broader)
3. `<clean name> hemsida` / `website` (last resort)

Stop early as soon as a high-confidence (score ≥ 5) candidate appears. This adds latency only for hard cases.

### 4. Looser verification

- Currently `verifyHomepage` requires a name token to appear in `<title>` or `og:site_name`. Many small business sites only have a logo image or use a tagline as title. Loosen by also checking:
  - any `<meta name="description">` content
  - the `<h1>` text
  - the domain itself already contains a name token (skip verification entirely if so)
- If verification fails but the candidate's domain stripped of TLD is an exact match for any name token (e.g. `osterlenportens.se` ↔ token `österlenportens` after folding), accept it.

### 5. Retry-only-failed mode

Add a new request flag `{ jobId, retryFailed: true }` to `resolve-domains-batch`. When set, it processes companies where `domain_status = 'failed'` (instead of skipping non-null-domain companies). Wire a second button "Retry failed" on the Job Detail page next to the existing "Resolve domains" button, shown only when `domainStats.failed > 0`.

### 6. Slightly higher concurrency + better logging

- Bump `CONCURRENCY` from 5 → 8 (Firecrawl handles this comfortably for search calls).
- Per-company `crawl_logs` entries for failures with the queries tried and top candidate (helps debug).

### 7. Apply same improvements to single-shot `resolve-domain`

Mirror the cleaner-query, fallback-search, and looser-verification logic in `supabase/functions/resolve-domain/index.ts` so the "Resolve" button on the Companies page benefits too.

## Files to change

- `supabase/functions/resolve-domains-batch/index.ts` — country inheritance, query cleanup + fallbacks, looser verification, retry-failed mode, concurrency bump
- `supabase/functions/resolve-domain/index.ts` — same query/verification improvements
- `src/pages/JobDetail.tsx` — add "Retry failed" button passing `{ jobId, retryFailed: true }`

No DB migration required.

## Success criteria

- Re-running resolution on job `5f6d2017…` resolves a meaningful chunk of the 977 unresolved + "Retry failed" recovers a significant portion of the 136 failed companies.
- Logs show which query variant succeeded for each company, making future tuning easier.
- New jobs created with a country set on the job inherit that country automatically.

