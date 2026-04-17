
## Goal: Real domains → real emails (no more `sales@null`)

### Root cause
Import files only contain company names. `companies.domain` stays `null`. The simulator then builds emails as `${prefix}@${company.domain}` → literally `sales@null`. There is no domain-resolution step and no real scraping — everything is fabricated client-side.

### Plan: 3-stage pipeline

**Stage 1 — Domain resolver (Name → Domain)**
New edge function `resolve-domain`:
- Input: `{ companyName, country? }`
- Uses Firecrawl Search (`site:` + name + country) and/or a Google-style search to find the company's official site
- Picks the top result whose hostname looks like the company (heuristic: name tokens appear in domain, not a directory like linkedin/wikipedia/facebook)
- Returns `{ domain, website, confidence: 'high' | 'low' | 'none', evidenceUrl }`
- Requires **Firecrawl** connector (we'll prompt to connect it)

Run it during import for rows without a website, OR as a "Resolve domains" action on the job before crawling. Update `companies.domain`/`website`. If `confidence === 'none'`, leave domain `null` and mark the company as `unresolved`.

**Stage 2 — Make the simulator honest (no fakes)**
In `src/lib/jobSimulator.ts`:
- Skip any company where `domain` is null/empty — log `warn`: "Skipped {name}: no domain resolved"
- Remove all fabricated `${prefix}@${domain}` and `firstname.lastname@domain` generation paths
- Stage 2 jobs become real-scrape only (see Stage 3); keep simulator only for `industry_country` demo jobs and clearly label any synthetic data

**Stage 3 — Real email scraper (Domain → Emails)**
New edge function `scrape-emails`:
- Input: `{ companyId, domain, jobId, options: { genericEmails, personEmails, phones, contactForms } }`
- Uses Firecrawl: `map(domain)` to find pages, then `scrape` on `/contact`, `/about`, `/team`, `/impressum`, homepage
- Extracts with regex: `email` (`/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi`), phone (E.164-ish), `mailto:` links, contact form URLs
- Filters: only keep emails whose host matches the company domain (or a known parent), drop obvious junk (`example.com`, `sentry.io`, `wixpress`)
- Inserts real rows into `contacts` / `contact_people` with the real `source_url`
- If nothing found for a company → insert one row of type `not_found` (new contact_type) OR simply don't insert and record a `crawl_log` "No public emails found for {domain}"

The Job Detail page already shows contacts per job, so "Not Found" can simply be the absence of rows + a status badge on the company.

### What I'll need from you
- Approve connecting the **Firecrawl** connector (required for both search + scrape). I'll prompt for the connection when implementing.

### Files touched
- `supabase/functions/resolve-domain/index.ts` (new)
- `supabase/functions/scrape-emails/index.ts` (new)
- `src/lib/importPipeline.ts` — call `resolve-domain` for rows without website
- `src/lib/jobSimulator.ts` — stop fabricating emails; for uploaded jobs, invoke `scrape-emails` per resolved company instead of synthesizing
- `src/pages/JobDetail.tsx` — small status indicator showing "X companies unresolved / Y scraped / Z not found"
- Migration: add `contact_type = 'not_found'` (optional) and a `companies.domain_status` column (`unresolved | resolved | failed`) so the UI can show "Not Found" clearly

### Out of scope
- Paid email-finder APIs (Hunter, Apollo) — Firecrawl-only for now
- Email verification (SMTP/MX checks)
- Backfilling old fake `@null` rows — use the existing "Clear contacts" button
