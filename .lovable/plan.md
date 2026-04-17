
## Make uploaded jobs crawl only their import file's companies

### Problem
`jobSimulator.tick()` picks a random company from `companies` (limit 50). For jobs with `source_type = "uploaded"`, this means contacts get attached to random companies that aren't in the user's import file.

### Fix
In `src/lib/jobSimulator.ts`, change the company selection inside `tick()`:

1. Read the job's `source_type`.
2. If `source_type === "uploaded"`:
   - Find the `imports` row where `crawl_job_id === jobId`.
   - Load `import_rows` for that import where `matched_company_id IS NOT NULL`.
   - Pick a random `matched_company_id`, then load that company.
   - If no matched rows exist yet, log a warn ("Waiting for import matches…") and skip the tick.
3. Otherwise (industry/country jobs): keep the current random-from-companies behavior.

Cache the matched company id list per job in a module-level `Map` to avoid refetching `import_rows` every 1.7s; invalidate by re-reading occasionally (e.g. every 10 ticks) so newly matched rows get picked up.

### Files touched
- `src/lib/jobSimulator.ts` only. No DB, schema, or UI changes.

### Out of scope
- Backfilling/cleaning existing wrong contacts on the current job (user can clear via Settings if desired).
- Changing how `industry_country` jobs pick companies.
