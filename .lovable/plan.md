
## Add "Create job from import" button on Import Detail page

### What it does
On `/imports/:id`, add a button next to the export action labeled **"Create job from matched companies"**. Clicking it:

1. Collects all `import_rows` for this import where `status` is `matched` or `duplicate` AND `matched_company_id` is not null.
2. Derives defaults from the import: `country` and `industry` = most-frequent value across matched rows (fallback null), `max_companies` = number of matched companies (capped at 1000), `name` = `"Crawl: <fileName>"`.
3. Creates a new `crawl_jobs` row with status `draft` using `api.createJob` and sensible collection defaults (mirrors CreateJob page).
4. Updates the `imports` row by setting `crawl_job_id` to the new job (so the existing "View job" button on the header lights up).
5. Toast success and navigate to `/jobs/:newId` so the user can review and schedule it.

### Edge cases / disabled state
- If the import has 0 matched companies, the button is **disabled** with a tooltip-style hint via title attr ("No matched companies to seed a job").
- If `imp.crawlJobId` already exists, button label becomes **"Recreate job"** and replaces the link (or we keep both — recreate creates a new job and overwrites the link).

### Files touched
- `src/pages/ImportDetail.tsx` — add the button + mutation handler. ~40 lines added.
- No schema changes. No new API methods needed (uses existing `api.createJob`, `api.updateImport`, and direct supabase query for matched rows aggregation — or reuse `rowsQ.data`).

### Implementation sketch
```ts
const createJobMut = useMutation({
  mutationFn: async () => {
    const matched = (rowsQ.data ?? []).filter(
      r => r.matchedCompanyId && (r.status === "matched" || r.status === "duplicate")
    );
    if (matched.length === 0) throw new Error("No matched companies");
    // mode = most-common country/industry
    const mode = (arr: (string|null)[]) => { /* count + return top */ };
    const job = await api.createJob({
      name: `Crawl: ${imp.fileName}`,
      country: mode(matched.map(m => m.country)),
      industry: mode(matched.map(m => m.industry)),
      max_companies: Math.min(matched.length, 1000),
      status: "draft",
      // collection defaults mirror CreateJob page
    });
    await api.updateImport(imp.id, { crawl_job_id: job.id });
    return job;
  },
  onSuccess: (job) => { qc.invalidateQueries(...); navigate(`/jobs/${job.id}`); },
});
```

### Note on simulator scope
The current `jobSimulator` picks random companies globally rather than only the import's matched companies. This plan leaves that unchanged — the seeded job acts as a regular draft job. If you want the simulator to crawl only the import's companies, that's a follow-up change to `jobSimulator.ts`.
