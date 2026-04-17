
Replace the inline import detail panel on Imports.tsx with a dedicated route.

## Plan

### 1. New route `/imports/:id` → `src/pages/ImportDetail.tsx`
- Header: file name, uploaded time, back link to /imports
- KPI row: Total / Processed / Matched / Failed / Contacts / People (reuse `KpiCard`)
- Status badge + attached job link (if `crawl_job_id` set)
- Export button (CSV/XLSX) using existing `exportImportResults`, scopes: All / Filtered / Selected
- Filter bar: status (pending/matched/partial_match/not_found/duplicate/failed), free-text search across company_name/website/country
- Rows table with selection checkboxes, columns: Company, Website, Country, Industry, Status, Matched company (link to `/companies/:id` when `matched_company_id` set), Error message
- Empty state for zero rows

### 2. Wire route in `src/App.tsx`
Add `<Route path="/imports/:id" element={<ImportDetail />} />`.

### 3. Update `src/pages/Imports.tsx`
- Remove the inline `detailId` Card/detailRows query block
- Make history rows navigate to `/imports/:id` via `useNavigate`

### 4. Reuse existing pieces
- `api.listImportRows(id)`, `api.getImport(id)` (add a thin getter if missing — currently we can derive from `listImports` but a direct `from('imports').select().eq('id', id).single()` is cleaner)
- `ImportStatusBadge`, `ExportButton`, `PageHeader`, `SectionCard`, `KpiCard`, `EmptyState`

### Technical notes
- Need to check `src/lib/api.ts` for an existing `getImport` helper; if absent, add one.
- Matched company link only shown when `matched_company_id` is non-null.
- Selection state local to page; export "selected" disabled when none selected.
- Polling: refetch import + rows every 3s while status is `processing`.
