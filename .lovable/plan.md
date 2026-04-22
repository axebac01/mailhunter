

## Goal

Polish the codebase to "excellence": improve maintainability, type-safety, perceived performance, and remove the largest sources of duplication — without any visual regressions or feature changes.

## Scope

Five focused refactors. No backend, schema, or UX changes. Pure code-quality work.

---

### 1. Split `JobDetail.tsx` (886 lines → ~300)

Extract self-contained sub-components into `src/components/jobDetail/`:

- **`PendingActionBanner.tsx`** — the Pausing/Stopping banner + `CountdownRing` + `estimateWaveMs` helper.
- **`JobLogsPanel.tsx`** — the entire "Logs" tab: filter chips, counts, filtered list, empty state.
- **`JobContactsTab.tsx`**, **`JobPeopleTab.tsx`**, **`JobSourcePagesTab.tsx`** — the three table tabs.
- **`JobStatusBanners.tsx`** — paused / stopped / firecrawl-402 / completed-early banners (currently inline ~80 lines).
- **`usePendingAction.ts`** hook — encapsulates sessionStorage rehydration, rAF tick loop, worker-exit detection, 60s timeout fallback.

`JobDetail.tsx` becomes a thin orchestrator: queries + mutations + layout.

### 2. Type-safety pass

- Add proper `LogRow` type with `metaJson?: { event?: string; duration_ms?: number; reason?: string }` and replace every `as any` on logs/metaJson with the typed shape.
- Replace `(r as any).meta_json` and `(r as any).include_person_emails` in `mapJob` with proper Database type access (the Supabase types now include both columns).
- Type `domainStats` query result explicitly (`{ total; resolved; unresolved; failed } | null`).
- Tighten `resolveDomains` mutation: remove `as any` and use a discriminated `ResolveResult` type.

### 3. Extract shared filtered-table pattern

`Contacts.tsx` and `People.tsx` share ~90% of the same logic (search + multi-select filters + pagination + selection + export). Extract:

- **`useTableFilters<T>(rows, predicates)`** hook — search/filter/page/select state + memoized derived data.
- **`<FilterBar>`** component — search input + select chips + clear button.
- **`<PaginationFooter>`** component — "Showing X of Y · selected" + prev/next.

Result: each page drops to ~80 lines and bug fixes apply to both at once.

### 4. Performance: paginate at the database

Today `listContacts()` and `listPeople()` pull up to 2000 rows on every visit and filter client-side. Rework to:

- Add `listContacts({ limit, offset, jobId?, importId?, type?, search? })` overloads using Supabase `.range()` and server-side `eq` / `ilike` / `in` filters.
- Keep return shape identical — pages opt in by passing filter args; Dashboard's "latest 5" uses `limit: 5`.
- JobDetail's "this job" filter goes server-side via `eq("crawl_job_id", jobId)`.
- Fallback safety: never return more than 500 rows in a single call.

### 5. Small correctness + DX wins

- **`api.ts` mappers**: extract a `mapLog` and `mapPerson`/`mapContact` to dedupe the inline anonymous mappers in `listContacts` / `listPeople` / `listLogs`.
- **`api.addLog`**: accept optional `meta_json` so callers can stop hand-rolling inserts (used by simulator + future code).
- **`jobSimulator.ts`**: replace `Math.random()` density branches with a single `pickWithProbability` helper for readability; no behavior change.
- **`App.tsx`**: lazy-load route components with `React.lazy` + a `Suspense` fallback (`<Skeleton />`) — first paint of `/` no longer pulls in CreateJob's heavy form code.
- **`useToast.ts`**: lower `TOAST_REMOVE_DELAY` from `1_000_000` (16 minutes) to `5_000` — current value silently leaks dismissed toasts in memory.
- **Replace `console`-silent catches** in jobSimulator (`.catch(() => {})`) with a single `logSimError` helper that at least `console.warn`s in dev so silent failures stop hiding bugs.

---

## Files to change

**New**
- `src/components/jobDetail/PendingActionBanner.tsx`
- `src/components/jobDetail/JobLogsPanel.tsx`
- `src/components/jobDetail/JobContactsTab.tsx`
- `src/components/jobDetail/JobPeopleTab.tsx`
- `src/components/jobDetail/JobSourcePagesTab.tsx`
- `src/components/jobDetail/JobStatusBanners.tsx`
- `src/hooks/usePendingAction.ts`
- `src/hooks/useTableFilters.ts`
- `src/components/app/FilterBar.tsx`
- `src/components/app/PaginationFooter.tsx`

**Edited**
- `src/pages/JobDetail.tsx` — reduce to orchestrator (~300 lines)
- `src/pages/Contacts.tsx` — adopt `useTableFilters` + shared components
- `src/pages/People.tsx` — same
- `src/lib/api.ts` — typed mappers, server-side pagination/filters, typed `metaJson`
- `src/lib/jobSimulator.ts` — `pickWithProbability` + dev warn helper
- `src/App.tsx` — `React.lazy` routes + `Suspense`
- `src/hooks/use-toast.ts` — fix toast removal delay

## Success criteria

- `JobDetail.tsx` < 350 lines; each extracted component is independently readable and unit-testable.
- Zero `as any` remaining on log / metaJson / job mappings.
- Contacts and People pages share a single source of filter/pagination logic.
- Dashboard initial paint loads ≤ 5 contact rows, not up to 2000.
- Toast cleanup happens within 5s of dismissal instead of 16 minutes.
- All existing routes, queries, and visible behavior unchanged — pure refactor.

