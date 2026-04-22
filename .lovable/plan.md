

## Goal

Stop the infinite "Waiting on domain resolution…" loop when Firecrawl returns **HTTP 402 / payment_required**. Auto-pause the job, surface a clear actionable error state, and prevent the worker from re-invoking until credits are restored.

## Problem (current behavior)

When `resolve-domains-batch` hits 402:
1. It logs *"Firecrawl returned 402 — top up to continue"* and returns.
2. Affected companies stay in `domain_status: pending` (not `failed`).
3. `scrape-emails-batch` sees `pendingResolution.length > 0` and re-invokes itself every 15s **forever**, spamming logs.
4. Job stays `running` with no clear failure signal.

## Fix — three coordinated changes

### 1. Resolver: mark unresolved companies as `failed` on 402

In `supabase/functions/resolve-domains-batch/index.ts`, in the `paymentErr` branch (around line 552 and final summary block ~585):

- After detecting `paymentErr`, **bulk-update all unprocessed companies** in this run (`todo` items not yet resolved + the `remaining` deferred ids) to `domain_status = 'failed'`. This prevents the scraper from waiting on them.
- Keep `payment_required: true` flag on the `resolve_completed` log (already present).

### 2. Resolver: pause the job on 402

In the same final block, when `paymentErr && jobId`:

- Update `crawl_jobs` → `status: 'paused'` and stamp `meta_json.paused_reason = 'firecrawl_payment_required'` (merge into existing `meta_json` if present).
- Log a distinct shutdown event so the existing `JobTimeline` / Logs filter ("Shutdown") surfaces it: 
  ```
  level: "error",
  message: "Job auto-paused — Firecrawl returned 402 (insufficient credits). Top up and resume.",
  meta_json: { event: "auto_paused", reason: "firecrawl_payment_required" }
  ```
- Skip scheduling any continuation re-invoke (already handled — `remaining` self-call is gated by `!paymentErr`, good).

### 3. Scraper: respect the auto-pause and stop polling

In `supabase/functions/scrape-emails-batch/index.ts`:

- The existing `job.status !== "running"` check at line 66 already exits cleanly once the resolver paused the job. **No code change needed there** — it works as soon as #2 lands.
- Add a defensive secondary guard: before scheduling re-invoke at line 179, re-fetch `crawl_jobs.meta_json` and if `paused_reason === 'firecrawl_payment_required'`, log and exit instead of re-invoking. (Belt-and-suspenders against race where status update lags.)

### 4. Frontend: explain the auto-pause in the banner

In `src/pages/JobDetail.tsx`, the existing paused banner currently shows generic copy. Extend it:

- When `job.status === 'paused'` AND `job.meta_json?.paused_reason === 'firecrawl_payment_required'`, render a destructive-tinted alert above the standard Resume controls:
  > **Auto-paused — Firecrawl ran out of credits.** Top up your Firecrawl account, then click Resume to continue domain resolution.
- Add a small "Open Firecrawl" link button (`https://www.firecrawl.dev/app/billing`).
- On Resume: clear `meta_json.paused_reason` so the banner doesn't re-appear after a successful resume.

## Files to change

- `supabase/functions/resolve-domains-batch/index.ts` — bulk-fail unresolved companies, set `paused` status + `paused_reason`, add `auto_paused` log event.
- `supabase/functions/scrape-emails-batch/index.ts` — defensive `paused_reason` re-check before re-invoke.
- `src/pages/JobDetail.tsx` — dedicated auto-pause banner variant + clear `paused_reason` on resume.

## Success criteria

- Triggering 402 (any wave) results in: job flips to `paused` within seconds, all pending companies become `failed`, scraper stops re-invoking.
- Logs show a single clear `auto_paused` entry instead of an endless "Waiting on domain resolution…" stream.
- JobDetail banner explains the cause and provides a path forward (top up + Resume).
- After topping up and clicking Resume, the job continues normally and the special banner disappears.
- No backend schema changes (uses existing `crawl_jobs.meta_json` jsonb column).

