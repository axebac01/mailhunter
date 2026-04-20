

## Problem

The `industry_country` job simulator at `src/lib/jobSimulator.ts:81-85` queries **all companies with a domain**, ignoring the job's industry/country and any company's origin. Old companies left over from previous import files (e.g. "Lock Dent AB" → `cbp.gov`, "Bellevue Dentallab" → `bellevuedentallab.co.uk`) get reused as if they were freshly discovered for "Nytest Sverige" (Media / Sweden).

## Fix

Make the `industry_country` simulator generate **its own synthetic companies** scoped to the job's industry + country, and only seed/reuse companies that were created by the same crawl job.

### Changes in `src/lib/jobSimulator.ts`

1. **Track per-job synthetic companies**: query companies created by this `crawl_job_id` only (using a new `crawl_job_id` column on `companies`, or by tagging via `source_url` / `notes`). Simplest: add a `created_by_job_id uuid` column to `companies`.
2. **When pool is below `maxCompanies`**: insert a new synthetic company with:
   - Plausible name + domain seeded from job industry/country (e.g. `nordicmedia-ab.se`, `stockholmpress.se`)
   - `country` = job.country, `industry` = job.industry
   - `created_by_job_id` = jobId
   - `domain_status = 'resolved'`
3. **Pick targets only from this job's pool** — never touch unrelated companies.
4. Increment `companies_found` exactly when a new synthetic company is inserted (not randomly).

### Migration

```sql
ALTER TABLE public.companies
  ADD COLUMN created_by_job_id uuid;
CREATE INDEX idx_companies_created_by_job_id
  ON public.companies(created_by_job_id);
```

### Cleanup option (offered, not automatic)

Provide a one-click "Clear demo companies for this job" button on Job Detail that deletes companies/contacts/people/source_pages where `crawl_job_id = jobId`. Won't touch real import data.

### Out of scope

- Cleaning the existing "Nytest Sverige" data — user can use Settings → Clear contacts, or I can add the per-job clear button above.
- Changing `uploaded` job behavior (already correct — uses `import_rows.matched_company_id`).

### Files

- `supabase/migrations/<new>` — add `companies.created_by_job_id`
- `src/lib/jobSimulator.ts` — generate per-job synthetic companies; never touch unrelated rows
- `src/pages/JobDetail.tsx` — optional "Clear this job's demo data" action

