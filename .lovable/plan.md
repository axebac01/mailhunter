## Problem

Scrapern (`scrape-emails-batch`) räknar varje företag med `domain_status = 'unresolved'` som "pending domain resolution". Resolvern (`resolve-domains-batch`) rapporterar samtidigt `complete` och rör inte dessa kvarvarande rader (de matchar inte dess plockkriterier längre — t.ex. de har redan körts, men varken fått en domän eller blivit flaggade som `failed`/`no_domain_found`).

Efter 20 vågor (~5 min) utan att antalet pending sjunker triggar watchdog auto-paus med `paused_reason: "stalled"`. Det är vad som hände för de 4 jobben på skärmbilden (verifierat i `crawl_logs` + `crawl_jobs.meta_json`).

## Fix

I `supabase/functions/scrape-emails-batch/index.ts`, vid stall-tröskeln (just innan auto-paus):

1. Hämta alla företag i jobbet med `domain IS NULL` och `domain_status = 'unresolved'`.
2. Uppdatera dem till `domain_status = 'no_domain_found'`.
3. Logga: `Skipped N stuck companies (no domain after retries) — continuing scrape.`
4. **Pausa INTE** — låt vågen avslutas normalt (re-invoke nästa våg). Eftersom `pendingResolution` då blir 0 går jobbet vidare till scraping av resterande, eller färdig.

Behåll auto-pausen endast som sista fallback ifall även scraping fastnar (separat counter, inte berörd här).

## Engångsfix för redan pausade jobb

Markera de 5 redan pausade `stalled`-jobben:
- `companies.domain_status`: `unresolved` → `no_domain_found` för rader kopplade till dessa jobb via `import_rows`/`imports`.
- `crawl_jobs.status`: `paused` → `running` och rensa `meta_json.paused_reason` / `stalled_at` / watchdog-räknare för samma jobb.
- Trigga `scrape-emails-batch` igen så de plockar upp och slutför.

## Filer som ändras

- `supabase/functions/scrape-emails-batch/index.ts` — ersätt auto-paus-blocket vid stall med "markera & fortsätt".

Ingen schemaändring. Ingen UI-ändring.
