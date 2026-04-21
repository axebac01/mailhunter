

## Goal

Surface `resolve-domains-batch` deferral status on the Job Timeline so users can see when domain resolution was paused due to the 150 s edge-function budget and how many companies remain to be processed in the background.

## Approach

### 1. Emit two new structured timeline events from the resolver

In `supabase/functions/resolve-domains-batch/index.ts`, replace the two existing free-form info logs with `meta_json.event`-tagged inserts so the Timeline can render them as first-class rows:

- `resolve_deferred` — emitted when the time budget is reached and a continuation is scheduled. Payload: `{ event, processed, resolved, failed, remaining: remaining.length, wave_seconds: Math.round((Date.now()-startedAt)/1000) }`. Level: `info`.
- `resolve_completed` — emitted when there is nothing more to defer (final wave). Payload: `{ event, resolved, failed, total: todo.length, payment_required: paymentErr }`. Level: `success` (or `error` when `paymentErr`).
- Also emit `resolve_started` at the top of the run with `{ event, total: todo.length, mode: reresolveAll ? 'reresolve' : retryFailed ? 'retry' : 'initial', country: jobCountry }`. Level: `info`.

These reuse the existing `crawl_logs` insert path, so realtime delivery to the Timeline already works — no migration needed.

### 2. Render the new event types in the Timeline

In `src/components/app/TimelineEvent.tsx`:

- Extend `TimelineEventType` with `resolve_started | resolve_deferred | resolve_completed`.
- Add `CONFIG` entries with distinct icons/colors:
  - `resolve_started` — `Search` icon, `text-info / bg-info/10`, label "Resolving"
  - `resolve_deferred` — `Clock` icon, `text-warning / bg-warning/10`, label "Deferred"
  - `resolve_completed` — `CheckCircle2` icon, `text-success / bg-success/10`, label "Resolved"
- Add `summarize` cases producing one-line summaries, e.g.:
  - "Started resolving 977 domains (Sweden)"
  - "Paused after 412/977 — 565 remaining, continuing in background…"
  - "Domain resolution complete — 834 resolved, 143 failed"

Because `meta.company` may not exist for these events, fall back to a generic title row ("Domain resolver") instead of the company link when `companyId` is absent.

### 3. Persistent banner on the Job Detail page while deferred

In `src/pages/JobDetail.tsx`, derive a small `deferredStatus` from the timeline state already loaded:

- Find the most recent `resolve_started`, `resolve_deferred`, and `resolve_completed` events for this job.
- If the latest event is `resolve_deferred` (and no later `resolve_completed`), show a `SectionCard`-style alert above the Timeline with:
  - Animated `Loader2` spinner + warning color
  - "Domain resolution in progress — N companies remaining"
  - A `Progress` bar (`processed / (processed + remaining)` from the deferred event payload)
  - Subtext: "Started Xs ago · last batch processed Y companies"
- The banner is reactive — when the next `resolve_deferred` arrives via the existing realtime subscription, the remaining count updates; when `resolve_completed` arrives, the banner disappears automatically.

### 4. Filter chip

Add a "Resolver" chip to the existing Timeline filter strip that toggles the three new event types together, so users can isolate the resolver narrative.

## Files to change

- `supabase/functions/resolve-domains-batch/index.ts` — emit `resolve_started`, `resolve_deferred`, `resolve_completed` structured logs
- `src/components/app/TimelineEvent.tsx` — extend type, CONFIG, and summarize for the three new events
- `src/pages/JobDetail.tsx` — deferred-status banner derived from timeline, plus "Resolver" filter chip

No DB migration required — `crawl_logs` already streams via realtime.

## Success criteria

- During a large import, the Job Timeline shows a "Deferred" event each time the edge function hands off to itself, with an accurate `remaining` count.
- A persistent banner with a live progress bar appears above the timeline while resolution is deferred and disappears within ~1 s of completion.
- Filtering by "Resolver" shows only the start / deferred / completed entries.

