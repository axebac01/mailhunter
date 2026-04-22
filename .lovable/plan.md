

## Goal

Run a focused UI smoke test across **Dashboard** and **JobDetail** to confirm the recent refactor (component extraction, server-side pagination, shared table hooks) introduced no visible regressions.

## Test plan

I'll drive the live preview with the browser tool, capturing screenshots at each checkpoint and comparing against the expected behavior from the code.

### Dashboard (`/`)
1. Navigate to `/`, screenshot full page.
2. Verify KPI cards render with numbers (not skeletons stuck loading).
3. Verify "Latest contacts" / "Latest people" sections show ≤5 rows each (server-side limit confirmation).
4. Confirm sidebar nav is intact and active state highlights "Dashboard".
5. Check console for errors / failed network requests.

### JobDetail (`/jobs/:id`) — current job `a6c3e7f7…`
1. Screenshot the page as loaded.
2. Verify header, status badge, KPI strip, and any active status banner (paused/firecrawl-402/etc.) render correctly via `JobStatusBanners`.
3. **Tabs** — click through each and screenshot:
   - **Timeline** — events render.
   - **Logs** (`JobLogsPanel`) — filter chips show counts; click "Errors" and "Shutdown", confirm row list updates and counts match.
   - **Contacts** (`JobContactsTab`) — table renders, the job-scope `Select` works, switch to "All jobs" and back.
   - **People** (`JobPeopleTab`) — table renders.
   - **Source pages** (`JobSourcePagesTab`) — table renders.
4. If a `PendingActionBanner` is present, confirm countdown ring animates.
5. Check console + network tab for 4xx/5xx, especially on `contacts`/`people` queries (server-side `.range()` + filters).

### Pass criteria
- No console errors beyond known warnings.
- All tabs mount without blank panels.
- Tables show data or proper empty states (not crash boundaries).
- Filter chips on Logs tab visibly filter rows.
- Layouts at 1336×895 match pre-refactor structure (sidebar + main, no overflow).

### Deliverable
A concise report with:
- Pass/fail per checkpoint
- Screenshots of Dashboard and each JobDetail tab
- Any console errors or layout issues found
- If issues found: I'll stop and report before fixing

No code changes in this task unless a regression is discovered.

