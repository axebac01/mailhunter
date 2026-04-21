

## Goal

Give each running job a live, chronological timeline view of the scraping pipeline — pages discovered, pages crawled, emails found, and people extracted — so users see exactly what is happening minute-by-minute instead of just a progress bar and final counters.

## Approach

### 1. Emit structured timeline events from the scraper

In `supabase/functions/scrape-emails/index.ts`, add small `crawl_logs` inserts at four key moments per company, each tagged with a new `meta_json.event` discriminator so the UI can filter cleanly:

- `pages_discovered` — after `discoverPages` returns, log `{ event, company, host, count, urls: top 10 }`
- `page_crawled` — after each successful Firecrawl scrape, log `{ event, company, url, page_type, emails_on_page, status }`
- `emails_found` — when ≥ 1 new email is upserted for a company, log `{ event, company, host, person_emails, generic_emails, samples: [first 3] }`
- `people_extracted` — when ≥ 1 `contact_people` row is inserted, log `{ event, company, count, samples: [first 3 names+roles] }`

Use `level: 'info'` (or `'success'` for emails_found / people_extracted). All existing free-form logs continue working — the timeline view simply ignores logs without `meta_json.event`.

In `scrape-emails-batch/index.ts`, also emit a `company_started` and `company_finished` event so the timeline can group entries per company.

### 2. New "Timeline" tab on Job Detail

In `src/pages/JobDetail.tsx`, add a tab next to the existing sections (or a `SectionCard` if no tabs exist) called **Timeline**. It contains:

- A vertical, time-ordered list of events (newest at top), each row showing:
  - Event icon + colored dot (discovered=blue, crawled=slate, emails=green, people=purple)
  - Relative timestamp ("12s ago"), company name (clickable → CompanyDetail)
  - One-line summary built from `meta_json` (e.g. "8 pages discovered on acme.se", "Crawled /kontakt — 3 emails", "Found 2 person emails: anna@…, lars@…", "Extracted 4 people from /team")
- Filter chips at top: All · Discovered · Crawled · Emails · People — toggle which event types show
- Aggregate counters strip above the list: total pages discovered / crawled / emails / people for this job (computed by counting events client-side from the loaded window, plus the existing KPI cards keep their DB-counted truth)
- Auto-scroll pause: if user scrolls down, pause auto-prepend; show a "N new events ↑" pill to resume

### 3. Realtime updates

Subscribe to `postgres_changes` on `public.crawl_logs` filtered by `crawl_job_id=eq.<jobId>` (the realtime subscription pattern is already used elsewhere in the app for `crawl_jobs`). New rows are prepended to the timeline state. Initial load fetches the last 200 events ordered by `created_at desc`. A "Load older" button at the bottom paginates further back.

Enable realtime on `crawl_logs` via a small migration:
```sql
alter publication supabase_realtime add table public.crawl_logs;
```
(Idempotent — wrapped in a `do $$ ... exception when duplicate_object then null; end $$;` block.)

### 4. Small reusable component

Create `src/components/app/TimelineEvent.tsx` — a single row renderer taking `{ event, createdAt, companyName, companyId, meta }`. Keep `JobDetail.tsx` clean.

## Files to change

- `supabase/functions/scrape-emails/index.ts` — emit `pages_discovered`, `page_crawled`, `emails_found`, `people_extracted` structured logs
- `supabase/functions/scrape-emails-batch/index.ts` — emit `company_started` / `company_finished`
- `src/pages/JobDetail.tsx` — add Timeline section + realtime subscription + filter chips
- `src/components/app/TimelineEvent.tsx` — new row component
- `supabase/migrations/<new>.sql` — enable realtime on `crawl_logs`

## Success criteria

- Starting a scrape on a job shows events streaming into the Timeline within ~1s of each company finishing a page, no manual refresh.
- Filter chips correctly narrow to a single event type.
- Completed jobs still show the full historical timeline (last 200 events, with pagination).
- No measurable performance impact on the scraper (one extra `insert` per event, batched naturally with the existing log inserts).

