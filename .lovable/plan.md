
Update `src/lib/importPipeline.ts` so name-only rows create company records instead of being marked `not_found`.

## Change

In the `else` branch (no domain), replace the current "fuzzy match by name → not_found" logic with:

1. Look up existing company case-insensitively by name (`ilike` exact match on trimmed name).
2. If found → mark row `matched` (or `duplicate` if `ignoreDuplicates`), link `matched_company_id`, increment `matched`.
3. If not found → insert a new `companies` row with `name`, `country`, `industry`, `notes` (no domain/website), then mark row `matched` and increment `matched`.
4. On insert error → `failed`.

Domain branch is unchanged.

## Why this is safe

- Companies table allows null `domain`/`website`, so name-only inserts are valid.
- Case-insensitive dedup via `ilike` prevents duplicates across re-imports of the same name.
- `partial_match` status is removed from this path — name-only rows now resolve to a real company, which is what the user wants.

## File touched

- `src/lib/importPipeline.ts` (single function, ~15 line diff in the `else` branch)
