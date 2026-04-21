

## Goal

Show live progress for running jobs directly in the Jobs table row — a thin progress bar plus three counters (companies processed, contacts found, pages crawled) that update in real time without manual refresh.

## Approach

### 1. Realtime subscription on `crawl_jobs`
In `src/pages/Jobs.tsx`, add a `useEffect` that subscribes to Postgres changes on `public.crawl_jobs` (UPDATE events). On each change, update the React Query cache for `["jobs"]` so the row re-renders with fresh `progress`, `companies_found`, `contacts_found`, and `pages_crawled` values.

Requires a one-line migration to enable realtime on the table:
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.crawl_jobs;
ALTER TABLE public.crawl_jobs REPLICA IDENTITY FULL;
```

### 2. Inline progress UI in the table row
Replace the single static "Companies / Contacts" cells with a richer block that, **for active jobs only** (`running`, `scheduled`, `paused`), shows:
- A thin `ProgressBar` (already exists at `src/components/app/ProgressBar.tsx`) bound to `j.progress`
- Three compact counters underneath: `Companies {processed}/{max}` · `Contacts {n}` · `Pages {n}`

For non-active jobs (completed/failed/draft/stopped), keep the existing right-aligned numeric cells unchanged.

### 3. Layout adjustment
Merge the current "Companies" and "Contacts" right-aligned columns into a single wider "Progress" column so the bar + counters fit cleanly. Add a "Pages" value inline rather than a new column to avoid horizontal overflow.

```text
| Job name | Industry | Country | Status | Created | Last run | Schedule | Progress                              | ⋮ |
|          |          |         | running|         |          |          | ▓▓▓▓▓░░░ 62%                          |   |
|          |          |         |        |         |          |          | 124/200 companies · 38 contacts · 154 pages |
```

### 4. Same treatment on Dashboard "Recent jobs"
Optional small touch: the existing Recent jobs list on `Dashboard.tsx` already benefits from the realtime cache invalidation automatically — no extra UI change required, but the badge/timestamps will refresh live.

## Files to change

- `supabase/migrations/<new>.sql` — enable realtime on `crawl_jobs`
- `src/pages/Jobs.tsx` — add realtime subscription, replace Companies/Contacts cells with Progress cell
- (no changes needed to `ProgressBar.tsx` — reused as-is)

## Success criteria

- Start a job → its row in `/jobs` shows a moving progress bar and counters incrementing every few seconds with no page refresh
- Completed/draft/failed jobs keep showing final numeric totals as today
- No extra polling; updates come purely from Supabase Realtime

