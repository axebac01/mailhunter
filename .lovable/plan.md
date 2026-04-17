
## Scope the Job Detail "Contact records" list to the current job, with a job picker

### What changes
On `/jobs/:id` (file: `src/pages/JobDetail.tsx`), the **Contact records** section currently appears to show contacts in a way the user finds too broad. I'll:

1. **Default the list to only the current job's contacts** (filter by `crawl_job_id === jobId`).
2. **Add a dropdown above the list** with options:
   - "This job" (default, selected)
   - "All jobs"
   - One entry per other existing job (so the user can switch context without leaving the page)
3. When "All jobs" or another job is picked, the list updates accordingly. The section header stays "Contact records"; a small muted label next to the dropdown shows the row count.

### Files touched
- `src/pages/JobDetail.tsx` — add `useState` for selected job filter (init to current `jobId`), fetch jobs list via existing `api.listJobs()` query, filter the contacts array before rendering, render a `Select` (shadcn) above the contacts table.

No DB, API, or schema changes. No impact on the global `/contacts` page.

### Out of scope
- Persisting the dropdown choice across navigations.
- Adding the same picker to Imports/Companies pages.
