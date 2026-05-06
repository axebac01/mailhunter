## Problem

Edge-funktionen `ingest-se-data` läser `Deno.env.get("SE_IMPORT_TOKEN")`, men din secret i Lovable Cloud heter `SE_IMPORT_KEY`. Därför returnerar den 500 "SE_IMPORT_TOKEN not configured".

Codex-skriptet (`scripts/import_via_edge.py`) skickar headern `x-import-token` med värdet från env-variabeln `SE_IMPORT_TOKEN` lokalt på din Mac — det är bara namnet *inne i edge-funktionen* som är fel. Värdet som skickas in spelar ingen roll vad det heter lokalt.

## Fix

Ändra en rad i `supabase/functions/ingest-se-data/index.ts`:

```ts
const expected = Deno.env.get("SE_IMPORT_KEY");
```

Sen redeployas funktionen automatiskt.

## Vad du gör efteråt

På din Mac, se till att den lokala env-variabeln `SE_IMPORT_TOKEN` (som Codex-skriptet läser) har samma värde som secret `SE_IMPORT_KEY` i Lovable Cloud. Sen kör du om:

```bash
python3 scripts/import_via_edge.py companies bokslut board
```

Inga andra ändringar behövs — schema, RPC-funktioner och skriptet är oförändrade.
