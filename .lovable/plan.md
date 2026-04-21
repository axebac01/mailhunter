

## Goal

Add quick filter chips above the **Logs** tab in JobDetail so users can narrow the activity log to the most useful subsets: completed companies, errors, and shutdown-related events (pause/stop/resume).

## Scope

Single-file change to `src/pages/JobDetail.tsx`, scoped to the existing **Logs** `TabsContent` block (lines ~595–612). The Timeline tab already has its own filters and is untouched.

## Filter set

Five chips, single-select, default **All**:

| Chip            | Matches                                                                                          |
|-----------------|--------------------------------------------------------------------------------------------------|
| **All**         | every log row (current behavior)                                                                 |
| **Companies done** | `meta_json.event === "company_finished"`                                                       |
| **Errors**      | `level === "error"` OR `level === "warn"`                                                        |
| **Shutdown**    | message contains any of: `paused by user`, `stopped by user`, `resumed`, `shutdown`, `aborted`   |
| **Resolver**    | `meta_json.event` ∈ {`resolve_started`, `resolve_deferred`, `resolve_completed`}                 |

Each chip shows a count (e.g. *"Errors · 3"*) computed from the loaded `logs.data`.

## UI

- Reuse the chip styling pattern already used in `JobTimeline` (rounded-full pills, primary fill on active) for visual consistency.
- Place the chip row inside the `SectionCard` header area, above the existing scroll container.
- Add a small `"{filteredCount} of {totalCount}"` label on the right side of the chip row.
- If the filter yields zero results, show an `EmptyState` with description *"No log entries match this filter."* instead of the empty list.

## Implementation details

- Add `const [logFilter, setLogFilter] = useState<"all" | "done" | "errors" | "shutdown" | "resolver">("all");` inside `JobDetail`.
- Memoize `filteredLogs` from `logs.data` with a switch on `logFilter`.
- Compute counts in a single pass `useMemo` so chip labels stay accurate as new logs stream in (logs already poll every 2.5s).
- Keep the existing row rendering (level pill + relative time + message) unchanged.

## Files to change

- `src/pages/JobDetail.tsx` — add filter state, memoized counts + filtered list, chip row in the Logs tab, empty-state fallback.

## Success criteria

- Five chips appear above the activity log; clicking one instantly filters the visible rows.
- Counts on chips reflect the current loaded logs and update as new entries stream in.
- "Shutdown" surfaces the worker exit lines used by the Pause/Stop transition detection.
- No backend, schema, or Timeline-tab changes.

