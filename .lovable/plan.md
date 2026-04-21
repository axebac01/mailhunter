

## Goal

Polish the JobDetail Pause/Stop transition UX with small, high-impact refinements that make the feature feel production-grade.

## Scope

Read-only review of `src/pages/JobDetail.tsx` showed the countdown works but has a few rough edges worth tightening. All changes stay local to that file — no backend, no schema.

## Refinements

### 1. Smoother countdown (no jitter)

- Replace the 1s `setInterval` with a `requestAnimationFrame` loop throttled to 250ms updates. This keeps the displayed seconds stable when the tab regains focus and avoids the "skip a second" effect when the interval drifts.
- Use `Math.max(1, Math.ceil(...))` so the badge never flashes "0s left" before flipping to "finishing up…".

### 2. Better wave-duration estimate

Current code uses `max(last 10 durations)` which over-estimates if one slow company skewed history. Improve to:
- Take the **p90** of the last 20 `company_finished` durations (more representative of worst-case in-flight).
- Add a small buffer (+3s) for worker shutdown overhead.
- Same 5s floor / 60s ceiling / 45s default.

### 3. Progress ring instead of static spinner

- Replace the spinner in the transition pill with a tiny circular progress ring (SVG, 14px) that fills as the countdown elapses. Gives passive visual confirmation that time is actually moving even when the seconds number is steady.
- Falls back to spinner once countdown hits 0 ("finishing up…").

### 4. Persist intent across reloads

Currently if the user refreshes during a Pausing… transition, the pending state is lost and they see the bare "paused" banner with no context. Fix:
- Persist `pendingAction` to `sessionStorage` keyed by job id on set, clear on resolve/timeout.
- On mount, rehydrate if the stored `startedAt` is within the last 90s and job status matches the intent.

### 5. Accessibility + polish

- Add `role="status"` and `aria-live="polite"` to the transition banner so screen readers announce the state change.
- Add `aria-label` with the full "Pausing, ~32 seconds left" text on the pill (the visual is abbreviated).
- Use `tabular-nums` on the countdown number (already partially there) and ensure the pill width doesn't reflow as digits change — fixed min-width.

### 6. Timeout copy improvement

When the 60s safety timeout fires without seeing the exit log, current toast is generic. Improve to:
- Auto-refetch the job + logs once before showing the toast (worker may have just exited).
- If still no exit log, toast: *"Worker is taking longer than expected. The status is correct — refresh logs to confirm."* with a "Refresh logs" action button that invalidates the logs query.

## Files to change

- `src/pages/JobDetail.tsx` — countdown loop, p90 estimator, SVG progress ring component (inline), sessionStorage rehydration, a11y attributes, timeout handler refinement.

## Success criteria

- Countdown ticks smoothly, never shows "0s left" or negative values.
- Estimate reflects typical (not worst-outlier) wave duration.
- Tiny progress ring visually communicates elapsed time.
- Refreshing the page mid-transition restores the Pausing…/Stopping… UI.
- Screen readers announce the transition.
- Timeout fallback is actionable, not just informational.

