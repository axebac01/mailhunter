
## Add "Clear contacts from this job" button on Job Detail

### What
Add a destructive action button in the Job Detail header that deletes all contacts (and people) collected for the current job, so the user can wipe the wrong data generated before the simulator fix.

### UI
- New `Button` (variant `outline`, with `Trash2` icon) in the `PageHeader` actions on `src/pages/JobDetail.tsx`, placed before `ExportButton`.
- Wrap in an `AlertDialog` (shadcn) with confirmation: "Delete all contacts and people for this job? This cannot be undone."
- On confirm: show toast, invalidate queries.

### Logic
- Add `clearJobContacts(jobId)` to `src/lib/api.ts`:
  - `DELETE FROM contacts WHERE crawl_job_id = jobId`
  - `DELETE FROM contact_people WHERE crawl_job_id = jobId`
  - `DELETE FROM source_pages WHERE crawl_job_id = jobId` (so pages tab also resets)
  - Reset job counters: `UPDATE crawl_jobs SET contacts_found=0, people_found=0, pages_crawled=0, progress=0 WHERE id=jobId`
- Wire as a `useMutation` in `JobDetail.tsx`; on success invalidate `["contacts"]`, `["people"]`, `["sourcePages", id]`, `["job", id]`, `["jobs"]`, `["kpis"]`.

### Files touched
- `src/lib/api.ts` — add `clearJobContacts` method.
- `src/pages/JobDetail.tsx` — add button + AlertDialog + mutation.

### Out of scope
- Bulk clearing across multiple jobs (Settings already has a global clear).
- Clearing logs (kept for audit trail).
