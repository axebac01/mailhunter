

## Goal

While the JobDetail page is in the transient **Pausing…** / **Stopping…** state, show an estimated remaining time (e.g. *"~32s left"*) so users know roughly how long until the in-flight wave finishes and the worker actually exits.

## Approach

All changes local to `src/pages/JobDetail.tsx`. No backend changes — we derive the estimate from existing `crawl_logs` already polled.

### 1. Estimate "typical wave duration" from recent logs

The worker logs `"Finished <Company> in Ns"` after each company (visible in the network dump, e.g. *"Finished StenStures Måleri AB in 43s"*, *"Finished N Fredrikssons Fönsterrenovering AB in 22s"*). The `meta_json.duration_ms` field on those entries is the authoritative per-company time.

When `pendingAction` becomes set:
- From the already-fetched `crawl_logs` list, pick the **last 5–10 entries** whose `meta_json.event === "company_finished"` and read `meta_json.duration_ms`.
- Take the **max** of those (worst-case in-flight company), capped at 60s, floored at 5s. Default to 45s if no samples exist.
- Store this as `estimatedWaveMs` alongside `pendingAction.startedAt`.

### 2. Countdown badge

Add a small badge next to the existing "Pausing…" / "Stopping…" pill:
- Computed as `Math.max(0, estimatedWaveMs - (now - startedAt))`, rounded to seconds.
- Updated via a `setInterval(1000)` that's only active while `pendingAction !== null`.
- Display formats:
  - `> 0s` → *"~Ns left"* (muted text, monospace numerals)
  - `0s` reached but worker hasn't exited yet → *"finishing up…"* (no number, avoids "−5s left")

### 3. Update the transition banner copy

Replace the static *"up to ~45 s"* phrasing in the banner with the dynamic estimate:
- Pausing: *"Pausing scraper — current batch finishing (~Ns left)…"*
- Stopping: *"Stopping scraper — current batch finishing (~Ns left)…"*

When the countdown reaches 0, fall back to *"current batch finishing up…"*.

### 4. Cleanup

- Clear the interval when `pendingAction` clears (worker exit detected) or on unmount.
- No new queries, no new state besides `estimatedWaveMs` and a `tick` counter for re-render.

## Files to change

- `src/pages/JobDetail.tsx` — compute `estimatedWaveMs` on Pause/Stop click, add countdown via `setInterval`, render badge + update banner copy.

## Success criteria

- Clicking **Pause** shows *"Pausing… ~32s left"* (or similar) immediately, with the number ticking down each second.
- The estimate reflects recent real wave durations (from `meta_json.duration_ms` on `company_finished` logs), not a hard-coded 45s.
- When the countdown hits 0 but the worker hasn't exited yet, the badge switches to *"finishing up…"* instead of going negative.
- Same behavior for **Stop**.
- No backend or DB changes.

