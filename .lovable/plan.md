

## Goal

Give users immediate visual feedback when they click **Pause** or **Stop** on a running scrape job, instead of just waiting for the status badge to flip. Show a transient "Pausing…" / "Stopping…" intermediate state until the worker actually halts (status reaches `paused` / `stopped` AND the in-flight wave has finished).

## Approach

All changes are local to `src/pages/JobDetail.tsx` — no edge function or DB changes.

### 1. Track local "intent" state

Add `const [pendingAction, setPendingAction] = useState<"pausing" | "stopping" | null>(null);`

- When user clicks **Pause** → `setPendingAction("pausing")`, then call `api.updateJobStatus(id, "paused")`.
- When user clicks **Stop** → `setPendingAction("stopping")`, then call `api.updateJobStatus(id, "stopped")`.
- Clear `pendingAction` when:
  - The polled job status reaches the requested terminal state (`paused` / `stopped`) **AND** the most recent `crawl_logs` entry for the job confirms the wave exited (look for the `"Scraping paused/stopped by user after wave"` log line the worker already writes), OR
  - A safety timeout of 60 s elapses (so the UI never sticks).

### 2. Reflect intent in the UI

While `pendingAction` is set:

- **Status badge area**: render an inline pill next to the existing badge — amber spinner + "Pausing…" or neutral spinner + "Stopping…".
- **Banner above progress bar**: replace the existing paused/stopped banner with an "in-flight" variant:
  - Pausing: *"Pausing scraper — waiting for the current batch to finish (up to ~45 s)…"* with a small spinner.
  - Stopping: *"Stopping scraper — waiting for the current batch to finish (up to ~45 s)…"*
- **Buttons**: disable **Start / Pause / Stop** entirely while `pendingAction !== null` so the user can't issue conflicting commands mid-transition.
- Toasts already exist from the previous change; keep them as the immediate "click acknowledged" cue.

### 3. Detect worker exit cleanly

Use the existing `crawl_logs` query (already polling) — find the latest log entry for this job; if its `message` contains `"paused by user"` or `"stopped by user"` and its `created_at` is after the click timestamp stored alongside `pendingAction`, treat the worker as exited and clear the pending state.

If `crawl_logs` isn't already queried on this page, add a lightweight 3 s poll for just the latest log row (`limit 1, order by created_at desc`) gated on `pendingAction !== null`, so it only runs during the transition.

### 4. Edge cases

- If the user hits **Start** quickly after pausing/stopping (once buttons re-enable on terminal state), the existing resume flow runs unchanged.
- If polling times out (60 s) without seeing the exit log, clear `pendingAction`, switch to the regular paused/stopped banner, and toast *"Worker may still be finishing — refresh in a moment if needed."*

## Files to change

- `src/pages/JobDetail.tsx` — add `pendingAction` state, transition banner + pill, button disabling, latest-log poll for exit detection, 60 s safety timeout.

## Success criteria

- Clicking **Pause** instantly shows a "Pausing…" pill + banner with spinner; it persists until the worker logs its exit (typically a few seconds, up to ~45 s), then flips to the regular "Scraper paused" banner.
- Same behavior for **Stop**.
- Start / Pause / Stop buttons are disabled during the transition so the user can't double-click.
- No backend changes; relies on existing worker exit log lines.

