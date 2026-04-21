

## Goal

Add **Stop** and **Restart** controls to import jobs so users can cancel a running import and rerun a finished/failed one without re-uploading the file.

## Current behavior

- An import runs client-side in `runImport` (`src/lib/importPipeline.ts`) as a batch loop. There's no cancellation hook, no resume path.
- Once finished, the original `File` is gone — but every parsed row lives in `import_rows` with a `status` (`matched`, `not_found`, `failed`, …) and the unresolved `companies` already exist in the DB.
- The Imports table (`src/pages/Imports.tsx`) only shows a delete (X) action per row.

## Approach

### 1. Cancellation hook in the pipeline

In `src/lib/importPipeline.ts`:

- Add a module-level `Map<string, { cancelled: boolean }>` keyed by `importId` (`importControllers`).
- Add `export function cancelImport(importId: string)` that flips the flag and also marks the import as `failed` (with `error` note "Cancelled by user") via `api.updateImport`.
- In `runImport`, register a controller right after `createImport`. Inside the batch loop (`for (const batch of batches)` and the streaming `iterate` callback), check `controller.cancelled` before each batch — if set, break out, flush a final `updateImport` with current counts and `status: "failed"`, then `return`.
- Always remove the controller from the map in a `finally`.

### 2. Restart pipeline (no file required)

Add `export async function restartImport(importId: string, onProgress?)`:

- Load the import + all its `import_rows` via existing `api.listImportRows`.
- Set the parent import back to `status: "processing"` and zero out the live counters (`processed_rows`, `matched_rows`, `failed_rows` reset; `total_rows` stays).
- Process rows in batches of 2,000:
  - For rows already `matched` or `duplicate` with a `matched_company_id` → keep as-is, count as matched.
  - For everything else (`pending`, `not_found`, `failed`, `partial_match`, `processing`) → run them through the existing match phase using a synthetic `Norm` derived from the row's stored `company_name / country / website / industry / notes`, then update that `import_row` in place (`update import_rows set status, matched_company_id, matched_domain, error_message`).
  - Insert any new companies the same way the normal pipeline does.
- Reuse `processBatch`'s match/insert helpers by extracting the "match + insert companies + decide row status" portion into a shared `matchAndInsert(ctx, normalized)` function used by both fresh imports and restarts.
- After the loop: re-enqueue `resolve-domains-batch` waves for the freshly inserted ids and the still-unresolved existing company ids attached to this import; mark import `completed`.
- Honor the same cancellation controller as fresh imports.

### 3. UI: Stop & Restart buttons

In `src/pages/Imports.tsx` history table row (the `<TableCell>` that currently holds only the delete button):

- **Stop** (square icon): visible when `i.status === "processing"`. Calls `cancelImport(i.id)`, shows a toast "Stopping import…", invalidates the `imports` query.
- **Restart** (rotate-cw icon): visible when `i.status === "completed" | "failed"`. Calls `restartImport(i.id, onProgress)` via a `useMutation`. While running, the button shows a small spinner and the row's status badge will flip to `processing` from the realtime/poll refresh.
- Keep the existing **Delete** (X) button; disable it while the row is `processing`.
- Wrap each action in `e.stopPropagation()` so the row click-through to detail still works elsewhere.

Also surface the same two buttons on `src/pages/ImportDetail.tsx` next to the existing `ImportStatusBadge` in the `PageHeader` actions slot, so users on the detail page get the same controls.

### 4. Progress for restarts

Restarts emit progress through the same `onProgress` callback. Track active restarts in the existing `activeImports` registry so the in-page progress bar (when restarted from the Imports page) shows the same UI as a fresh import.

## Files to change

- `src/lib/importPipeline.ts` — add `cancelImport`, `restartImport`, controller map, extract shared `matchAndInsert` helper, add cancellation checks in batch loop.
- `src/pages/Imports.tsx` — add Stop / Restart buttons in history rows; wire mutations.
- `src/pages/ImportDetail.tsx` — add Stop / Restart buttons in the page header.

No DB migration. No new dependencies.

## Success criteria

- Clicking **Stop** on a running import halts processing within one batch (≤ a few seconds), the row's status flips to `failed` with a "Cancelled by user" note, and resolver waves stop being enqueued.
- Clicking **Restart** on a `completed` or `failed` import re-runs match + resolver against its stored rows, leaves already-matched rows untouched, and updates failed rows in place — no re-upload needed.
- Buttons appear only in the relevant statuses and don't interfere with row-click navigation or delete.

