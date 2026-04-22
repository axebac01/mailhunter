

## Goal

Make the `domainStats` query failure visible instead of silent. Today the query in `JobDetail.tsx` fails with HTTP 400 (URL too long, ~2,863 UUIDs in `id=in.(...)`) and the UI just shows nothing — banners that depend on `domainStats` never render and there is no clue why.

## Changes

### 1. `src/pages/JobDetail.tsx` — instrument the `domainStats` query

- Capture the company-id count in a local before the `companies` lookup.
- On query error: `console.error("[domainStats] query failed", { jobId, companyIdCount, error })`.
- On success when `companyIdCount > 0` but `data` is missing/short: `console.warn("[domainStats] partial response", { requested, received })`.
- Return a richer object: `{ stats, error, companyIdCount }` instead of just stats — keep `stats` shape backward-compatible with `JobStatusBanners`.

### 2. New component `src/components/jobDetail/DomainStatsError.tsx`

Small inline alert (uses existing `Alert` / `AlertDescription` from shadcn) shown only when:
- `job.sourceType === "uploaded"` AND
- `domainStatsQuery.error` is set OR (`companyIdCount > 0` AND `stats === null`)

Content:
- Title: "Couldn't load domain resolution stats"
- One-line body: `"Tried to fetch status for {companyIdCount} companies but the request failed. Banners about resolution progress are hidden until this loads."`
- A small "Retry" button calling `domainStatsQuery.refetch()`.
- Tone: `variant="warning"` (muted yellow), not destructive — the rest of the page still works.

### 3. Wire it into `JobDetail.tsx`

- Render `<DomainStatsError />` directly above `<JobStatusBanners />`.
- Pass `domainStats` (the `stats` field) to `JobStatusBanners` as before — no change to that component.

### 4. Empty-state nuance

When `companyIdCount === 0` (no companies imported yet for an uploaded job), do NOT show an error — that's a normal empty state, not a failure. Only the genuine HTTP error or "we asked for N but got nothing back" case triggers the alert.

## Files to change

- `src/pages/JobDetail.tsx` — extend `domainStats` query, add console logging, render the new component.
- `src/components/jobDetail/DomainStatsError.tsx` — new file.

## Out of scope (deliberate)

The underlying URL-length bug (chunking the `id IN (...)` filter or switching to a join via `import_id`) is **not** fixed here. This task only adds visibility. A follow-up task can address the root cause.

## Success criteria

- When `domainStats` returns 400, the JobDetail page shows a clear inline warning with the requested count and a Retry button.
- Console contains a single structured `[domainStats] query failed` entry with `jobId`, `companyIdCount`, and the error.
- When `companyIdCount === 0`, no alert appears (clean empty state).
- All existing banners (paused, firecrawl-402, completed-early) still render unchanged when `domainStats` succeeds.

