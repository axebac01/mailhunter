

## Goal

Make the existing Pause / Stop buttons on the JobDetail page actually halt the running `scrape-emails-batch` worker promptly, and give clear visual feedback that scraping has been paused.

## Current behavior

- `JobDetail.tsx` already has **Start / Pause / Stop** buttons that call `api.updateJobStatus(id, …)`.
- `scrape-emails-batch` checks `job.status !== "running"` at the **top of each invocation** and exits early. The self re-invoke loop (every ~15 s) will therefore stop **on its next tick** after a pause/stop.
- Gap: the **currently in-flight wave** (up to ~6 companies in the concurrency pool) keeps running for up to ~45 s after the user clicks Pause, with no UI indication that a stop was requested.

## Approach

### 1. Cooperative cancellation inside the scrape worker

In `supabase/functions/scrape-emails-batch/index.ts`:

- Before each company in `runPool`'s worker, re-check `crawl_jobs.status` (cheap single-row select, cached for ~3 s to avoid hammering). If status is no longer `running`, the worker returns immediately without scraping that company.
- After the wave finishes (or aborts), if status is not `running`, log `"Scraping paused by user"` (or `"stopped"`) and **do not** schedule a re-invoke.
- Skip the "mark completed" branch when the exit reason is a user pause/stop — leave status as the user set it.

### 2. JobDetail UI feedback

In `src/pages/JobDetail.tsx`:

- Wire the existing **Pause** and **Stop** buttons to also show a toast: *"Pausing scraper — current batch will finish within ~45s"* / *"Stopping scraper"*.
- Disable **Pause** / **Stop** when `j.status` is already `paused` / `stopped`. Disable **Start** when `running`.
- Add a small banner above the progress bar when `j.status === "paused"` or `"stopped"`:
  - Paused: amber, *"Scraper paused. Click Start to resume from where it left off."*
  - Stopped: neutral, *"Scraper stopped."*
- When the user hits **Start** after a pause/stop, re-invoke `scrape-emails-batch` (same call as the existing **Resume scraping** mutation) so work resumes immediately instead of waiting for the next natural tick.

### 3. No DB or schema changes

Status transitions already exist (`running` / `paused` / `stopped` / `completed`). No migration needed.

## Files to change

- `supabase/functions/scrape-emails-batch/index.ts` — per-item status re-check, skip re-invoke on pause/stop, log pause reason.
- `src/pages/JobDetail.tsx` — toasts on Pause/Stop, disabled states, paused/stopped banner, re-invoke scraper on Start.

## Success criteria

- Clicking **Pause** while scraping flips status to `paused` within ~1 s; the in-flight wave finishes (or aborts per-company) within ≤ a few seconds; no further re-invocations occur.
- Clicking **Start** on a paused job resumes scraping immediately (no need to wait 15 s).
- The banner clearly tells the user the scraper is paused or stopped.
- **Stop** behaves identically to Pause but uses the `stopped` status and label.

