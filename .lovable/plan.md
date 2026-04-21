

## Goal

Ensure the import function reliably accepts `.xls` (legacy Excel 97–2003) files in addition to the currently supported `.xlsx` and `.csv`.

## Current state

- `parseFile` in `src/lib/importPipeline.ts` routes by extension: `.csv` → PapaParse stream, otherwise → XLSX worker (buffered).
- The worker (`src/workers/parseFile.worker.ts`) uses `XLSX.read(buffer, { type: "array", dense: true })`, which already supports `.xls` binary format — SheetJS auto-detects.
- The likely failure points for `.xls` today are:
  1. The file `<input>` `accept=` attribute in `src/pages/Imports.tsx` (and `CreateJob.tsx`) probably only lists `.csv,.xlsx`, so the OS file picker may filter `.xls` out or the drop handler may reject it.
  2. The "large file" branch in `parseFile` falls back to streaming for files >5 MB regardless of type — but `.xls` cannot be CSV-streamed. Need to guarantee `.xls` always goes through the XLSX worker path.
  3. MIME-type sniffing (if any) may only allow `text/csv` and the modern XLSX MIME.

## Approach

### 1. Accept `.xls` everywhere a file is selected

- Update the file `<input accept="...">` and any drag-drop validation in `src/pages/Imports.tsx` and `src/pages/CreateJob.tsx` to include:
  - `.xls`
  - `application/vnd.ms-excel`
- Update any user-facing copy ("CSV or XLSX") to read "CSV, XLS, or XLSX".

### 2. Route `.xls` through the buffered XLSX worker path

In `src/lib/importPipeline.ts` `parseFile`:
- Treat `.xls` the same as `.xlsx` — never attempt CSV streaming for it, regardless of size.
- Keep the existing 25 MB / 200k-row size warning but apply it to `.xls` as well (legacy XLS has a hard 65,536-row format limit anyway, so it will rarely trip).

### 3. Confirm SheetJS handles `.xls`

- No code change needed in `src/workers/parseFile.worker.ts` — `XLSX.read(buffer, { type: "array" })` already auto-detects BIFF (`.xls`) vs. OOXML (`.xlsx`).
- Add a defensive try/catch message: if parsing fails, surface "Could not read this Excel file — try re-saving it as .xlsx or .csv" instead of a raw stack.

### 4. Quick manual verification

After changes, re-test with the user's uploaded `test målerier - test.xlsx` (sanity check no regression) and ask them to re-try with the failing `.xls`.

## Files to change

- `src/pages/Imports.tsx` — extend `accept` and drop-validation; update copy.
- `src/pages/CreateJob.tsx` — same `accept` extension if it uploads files.
- `src/lib/importPipeline.ts` — explicitly route `.xls` to the buffered worker path; improve parse-error message.

No DB migration, no new dependencies (SheetJS already handles `.xls`).

## Success criteria

- Selecting or dropping a `.xls` file on the Imports page is accepted by the picker and validators.
- The file parses, preview renders, and the import completes with the same row counts as the equivalent `.xlsx`.
- A corrupt or unreadable `.xls` shows a friendly error toast, not a stack trace.

