
## Fix

Make the "From an import file" section on `/jobs/new` support uploading a file directly from any folder on the computer, instead of only selecting a previously created import.

## Why this is happening

The earlier fix was applied to `src/pages/Imports.tsx`, but the user is currently on `src/pages/CreateJob.tsx`. On that page, "From an import file" only renders an import dropdown:

```text
Create job
└─ Source
   ├─ Industry + country
   └─ From an import file
      └─ Select existing import only
```

So there is currently no folder/file picker there at all.

## What to build

### 1) Add direct file upload to the Create Job flow
Update `src/pages/CreateJob.tsx` so the "From an import file" area includes:

- a button/dropzone to browse files from any folder
- the same file-type handling as the Imports page
- support for `.csv`, `.xls`, `.xlsx`
- extension validation in code, not via a restrictive `accept` filter

### 2) Allow both existing and new import sources
Keep the current "select an existing import" dropdown, but add a second path for "upload a new file now".

Recommended UX:

```text
From an import file
[ Upload new file ]   [ Or choose existing import ▼ ]
```

This lets users either:
- upload directly from their computer, or
- reuse a previously imported file

### 3) Reuse the existing import pipeline
Use the existing import logic already in:
- `src/lib/importPipeline.ts`
- `src/lib/api.ts`

The new Create Job upload flow should:
- parse the selected file
- show mapping UI
- run the import
- refresh the imports query
- automatically select the newly created import
- continue with the normal uploaded-job creation flow

### 4) Preserve the folder-browsing fix here too
The file input used from Create Job must also avoid the restrictive picker behavior:
- no `accept=".csv,.xls,.xlsx"` filter
- validate selected filename in JavaScript with the same regex already used on the Imports page
- show the same unsupported-file toast if the user picks a non-supported file

### 5) Auto-fill job details after import
After a successful inline import:
- auto-select that import in the dropdown
- recompute matched rows
- keep the existing auto-fill behavior for job name, industry, country, and max companies

## Recommended implementation shape

### Option A: best long-term
Extract the upload/parse/mapping/import UI from `src/pages/Imports.tsx` into a reusable component, then use it in:
- `src/pages/Imports.tsx`
- `src/pages/CreateJob.tsx`

This avoids maintaining two different import experiences.

### Option B: smaller change
Duplicate only the minimal upload + mapping + run-import flow inside `CreateJob.tsx`, while still reusing:
- `parseFile`
- `autoMap`
- `runImport`

Option A is preferred if the shared UI can be cleanly extracted without large scope creep.

## Files to update

- `src/pages/CreateJob.tsx`
  - add inline upload UI under "From an import file"
  - support direct file browsing from any folder
  - run import and auto-select the result
- `src/pages/Imports.tsx`
  - optionally refactor to use a shared upload component if extraction is chosen
- `src/lib/importPipeline.ts`
  - no logic change expected, only reuse
- `src/lib/api.ts`
  - likely no schema/API changes needed

## Technical details

- Keep validation client-side with:
  - `/\.(csv|xls|xlsx)$/i`
- Do not add backend or database changes
- Do not change parsing/matching rules unless needed for reuse
- Invalidate/import-refresh queries after inline upload so the dropdown updates immediately
- Ensure Create Job still works when the user chooses an already existing import instead of uploading a new one

## Success criteria

- On `/jobs/new`, when "From an import file" is selected, the user can open a file picker and browse any folder on their computer
- Selecting a CSV/XLS/XLSX starts the existing import workflow
- Selecting a `.txt` or other unsupported file shows the existing error toast
- After import completes, the new import is selected automatically
- The job can then be created from that imported file without leaving the page
