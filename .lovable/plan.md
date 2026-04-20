

## Problem

You uploaded a 495-row file on `/jobs/new`, then created the job. All 495 companies are stuck at `domain_status = 'unresolved'`, the scrape ran and logged "0 companies with resolved domains", and 0 contacts were found.

Two distinct bugs are causing this:

### Bug 1 — Domain resolution never runs for companies created during the Create Job upload

`runImport` fires `resolve-domains-batch` only at the moment the file is uploaded. On the Create Job page, the import is created with `crawl_job_id = null`, the job is built afterwards, and nothing ever re-triggers resolution. Even if the batch call did succeed, its log lines wouldn't show up under your job because no `jobId` was passed.

### Bug 2 — `resolve-domains-batch` likely crashed at boot

The function imports `corsHeaders` from `https://esm.sh/@supabase/supabase-js@2.95.0/cors`, which is not a real export of supabase-js. That throws on boot, so the invocation from `runImport` silently failed. Confirmed: there are zero info/result logs from that function for any recent job, only boot/shutdown.

## Fix

### 1. Fix `resolve-domains-batch` boot crash
Replace the bad import with a local `corsHeaders` constant (standard pattern used in your other edge functions):
```ts
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
```

### 2. Trigger domain resolution when the job is created from an uploaded import
In `src/pages/CreateJob.tsx`, after `api.updateImport(importId, { crawl_job_id: job.id })`, invoke `resolve-domains-batch` with `{ importId, jobId: job.id }`. This:
- runs server-side so the user can leave the page
- attaches logs to the job (you'll see "Resolving domains for N companies…")
- resolves all unresolved companies for that import

Fire-and-forget (don't block job creation).

### 3. Add a "Resolve domains now" action on Job Detail
For jobs already in this stuck state (like the current one), add a button on `/jobs/:id` that calls `resolve-domains-batch` with `{ jobId }`. The function already supports filtering unresolved companies via `jobId` → its imports → import_rows. This lets you recover the current 495-company job without re-uploading.

### 4. Auto-trigger resolution before scrape if needed (defensive)
In the scrape pipeline, if it sees "0 companies with resolved domains" but unresolved ones exist for the job, log a clear message telling the user to click "Resolve domains" instead of silently doing nothing. (Optional — keep scope small if you prefer.)

## Files to change

- `supabase/functions/resolve-domains-batch/index.ts` — fix `corsHeaders` import
- `src/pages/CreateJob.tsx` — invoke `resolve-domains-batch` after job creation when `sourceMode === "uploaded"`
- `src/pages/JobDetail.tsx` — add "Resolve domains" button, calls the function with `{ jobId }`

## Recovery for the current job

After deploying, click the new "Resolve domains" button on `/jobs/5f6d2017…`. It will resolve all 495 companies in the background (concurrency 5, ~1–2 min), then you can re-run the scrape.

## Success criteria

- New uploads → companies get domains resolved automatically and the job's logs show progress
- Existing stuck jobs can be recovered with one click
- Scrape no longer reports "0 companies with resolved domains" after resolution finishes

