

## Fix: allow browsing any folder/file in the import dialog

### Problem
On `/imports`, the file `<input>` uses `accept=".csv,.xls,.xlsx"`. On some OS file dialogs this filter hides non-matching files and can make folders appear empty or harder to navigate. We'll relax the picker so you can browse anywhere on your computer, then validate the extension after selection.

### Changes

**`src/pages/Imports.tsx`**
- Remove the `accept` attribute from the hidden `<input type="file">` so the OS dialog shows all files and folders normally.
- In `handleFile(f)`, validate the extension in code: accept `.csv`, `.xls`, `.xlsx` (case-insensitive). If the file doesn't match, show a toast (`"Unsupported file type — please choose a CSV, XLS, or XLSX file"`) and stop.
- Keep the drop zone behavior identical (drag-and-drop already accepts anything; same validation will apply).
- Update the helper text under the drop zone from "Supported columns…" to also mention "Any folder on your computer — pick a CSV, XLS, or XLSX file."

### Out of scope
- No backend or schema changes.
- No change to parsing logic in `src/lib/importPipeline.ts`.

### Files
- `src/pages/Imports.tsx`

