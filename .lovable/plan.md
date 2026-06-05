# Plan: Alltid extrahera C-level-personer

## Mål

För varje skrapat företag: hämta namn + roll för ledningen (VD, CFO, CTO, CMO, COO, ordförande, grundare). Coverage-first behålls för kontaktuppgifter — men Tier 2 körs nu alltid på företagets egna sidor.

## Förändringar

### 1. `supabase/functions/scrape-emails/index.ts` — Tier 2 alltid på

- Ta bort `needsTier2`-gaten som infördes i coverage-first. Tier 2 körs på **varje** företag som har en domän.
- Bygg om sidlistan vi letar på: nuvarande "om/team/ledning"-discovery utökas med svenska/engelska varianter: `ledning`, `management`, `styrelse`, `board`, `leadership`, `team`, `om-oss`, `about`, `medarbetare`, `executive`, `who-we-are`. Använd Firecrawl `map` med `search` om sidor inte hittas via Tier 1-länkar.
- Cap: max **2** sidor per företag i Tier 2 (en team-sida + en ledning/styrelse-sida räcker oftast). Skydd mot 5-creditsexplosion.

### 2. LLM-prompt — fokus på ledning

Uppdatera JSON-extract-schemat i scrape-emails:

```
{ people: [{ full_name, role_title, department?, email? }] }
```

Prompten instrueras explicit:
- Behåll **endast** personer vars titel matchar C-level/ledning-mönster (regex på serverside efter LLM-svar):
  `/(VD|CEO|CFO|CTO|CMO|COO|CIO|CPO|CRO|CCO|chef|head of|director|ordförande|chair|founder|grundare|partner|owner|ägare|managing|VP|vice\s*president)/i`
- Allt annat (sales rep, developer, support, etc.) filtreras bort innan insert i `contact_people`.

### 3. Persistens

`contact_people` har redan `full_name`, `role_title`, `department`, `source_url`, `company_id`, `job_id`. Inga schemaändringar.

Lägg till dedupe per `(company_id, lower(full_name))` så vi inte får dubbletter när team-sida + ledning-sida överlappar.

### 4. UI

`JobPeopleTab` och `People`-sidan visar redan namn/roll/dep/företag — fungerar direkt. Inga UI-ändringar krävs.

(Valfritt senare: lägg till en KPI-ruta "Företag med ≥1 person" i jobbdetaljen — säg till om du vill ha det.)

### 5. Förväntad kostnad

Tier 1 (1 credit) + Tier 2 (1–2 credits map + 1–2 scrapes med extract = 3–5 credits + 1 LLM) ≈ **4–6 credits/företag** istället för dagens ~1. För ett 70-företagsjobb: ~300–400 credits istället för ~100. Det är priset för personer.

`HARD_CAP` höjs tillbaka från 3 → 6.

## Verifiering

Kör om `CRMdata: Finansiell leasing` (cleara source_pages/contacts/contact_people för jobbet först). Mät:
- Antal företag med ≥1 person (mål: ≥60 %)
- Andel personer med C-level-titel (mål: 100 % efter filter)
- `firecrawl_calls` (förväntat ~80–110 för 16 företag)

## Filer som ändras

- `supabase/functions/scrape-emails/index.ts` — Tier 2-gate borttagen, utökad sid-discovery, LLM-prompt + roll-filter, dedupe, HARD_CAP=6.

Inga DB-migrationer. Ingen UI-kod ändras.
