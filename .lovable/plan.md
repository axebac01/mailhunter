## Mål

Ladda upp en stor MySQL-dump över alla svenska bolag, gör den sökbar med filter på SNI/omsättning/anställda/geografi, och låt dig importera urval till `companies` för crawl-jobb.

## Arkitektur

```text
MySQL dump (>2GB)
  └─> Konvertering till Postgres COPY-format (sker utanför appen via skript)
        └─> Import till ny tabell public.se_companies (read-only register)
              └─> Ny sida /se-companies — filter + paginerad lista
                    └─> "Importera valda till Companies" → upsert i companies
                          └─> Existerande crawl/scrape-flöde tar vid
```

`se_companies` ligger separat från `companies` — den är ett stort statiskt register, `companies` är ditt arbetsmaterial. Endast valda rader kopieras över.

## Datamodell

Ny tabell `public.se_companies`:

- `org_nr` text PK (organisationsnummer, unik nyckel)
- `name` text not null
- `sni_code` text — primär SNI-kod
- `sni_text` text — bransch-beskrivning
- `revenue_ksek` bigint — omsättning i tkr
- `employees` int
- `county` text — län
- `municipality` text — kommun
- `postal_code` text
- `postal_city` text
- `street_address` text
- `website` text
- `email` text
- `phone` text
- `description` text — verksamhetsbeskrivning (fritext)
- `fiscal_year` int — år omsättning/anställda gäller
- `raw` jsonb — övriga fält från dumpen som vi inte mappar nu
- `imported_at` timestamptz default now()

Index (kritiskt för prestanda på 2M+ rader):
- B-tree på `sni_code`, `county`, `municipality`
- B-tree på `revenue_ksek`, `employees` (range-queries)
- GIN på `to_tsvector('swedish', name || ' ' || coalesce(description,''))` för fritext (om du senare vill)
- Unique index på `org_nr`

RLS: public read, ingen insert/update/delete från klient (importeras via skript med service-role).

## Importflödet (engångsjobb per dump)

Eftersom filen är >2GB kan den inte laddas upp via browsern. Flöde:

1. **Du laddar upp dumpen** till sandboxen (eller lägger den i en publik URL jag kan hämta från).
2. **Konvertera MySQL → Postgres COPY**: jag kör `pgloader` eller ett Python-skript (mysqldump-parser → CSV → `\copy`). Mappar fältnamnen i din dump till kolumnerna ovan; resten lagras i `raw` jsonb.
3. **Bulk-import**: `psql \copy se_companies FROM 'companies.csv' CSV` eller streamat insert i batchar om 50k. Service-role nyckel, inte browser.
4. **Skapa index efter import** (snabbare än under).
5. **VACUUM ANALYZE** för planner-statistik.

Hela importen körs som en engångsoperation av mig via `code--exec` — ingen UI-uppladdning behövs.

## Sök-UI

Ny sida `src/pages/SeCompanies.tsx` (route `/se-companies`, länk i sidebar):

**Filter-rad:**
- SNI-kod — multi-select från distinct lista, eller fritext-prefix ("47*" matchar 47.111, 47.112…)
- Omsättning min/max (tkr)
- Antal anställda min/max
- Län — select från distinct
- Kommun — select beroende på valt län
- Fritext (matchar name/description)

**Resultat:**
- Tabell med checkboxes (samma mönster som Companies/Contacts)
- Kolumner: namn, org.nr, SNI, omsättning, anställda, kommun
- Server-side pagination (50/sida) — `range(from, to)` på Supabase
- Visar total count

**Bulk-action:**
- "Importera N bolag till Companies" → edge function `import-se-companies` som upsertar till `companies`-tabellen (matchar på `domain` när website finns, annars på namn+kommun) och returnerar `{ inserted, updated, skipped }`. Sätter `notes` med org.nr-referens. Sen kan du köra `resolve-domain` + crawl som vanligt.

## Edge function `import-se-companies`

- Input: `{ org_nrs: string[] }`
- Hämtar matchande rader från `se_companies`
- Mappar till `companies`-format: `name`, `website`, `country='SE'`, `industry=sni_text`, `notes='org.nr: XXX, SNI: YYY'`
- Upsert mot `companies` (dedupe på domain om finns)
- Returnerar resultat

## Filer

**Nya:**
- `supabase/migrations/...sql` — `se_companies` tabell + index + RLS
- `supabase/functions/import-se-companies/index.ts`
- `src/pages/SeCompanies.tsx`
- `src/components/seCompanies/FilterBar.tsx` (eller inline)

**Ändras:**
- `src/App.tsx` — route
- `src/components/app/AppSidebar.tsx` — meny-länk

## Vad jag behöver från dig nu

1. **Dumpen**: ladda upp den om den får plats (annars en signed URL jag kan curla från). En liten sample (typ första 1000 raderna eller `head -200 dump.sql`) först är bäst — då kan jag mappa kolumnerna exakt innan vi kör hela importen.
2. **Källa**: är detta Bolagsverket, allabolag.se, eller annan källa? Påverkar fältnamn.

## Out of scope (för nu)

- Uppdatering/synk när du får en ny dump — det blir en TRUNCATE + re-import, manuellt.
- Full-text GIN-index — läggs till senare om fritextsök blir långsam.
- Historik / flera fiscal_year per bolag — vi tar senaste året per bolag.

## Klart när

- `se_companies` har miljontals rader och svar på filter-queries returnerar <1s.
- `/se-companies` visar filterbar lista med pagination.
- "Importera valda" skapar rader i `companies` och du kan köra crawl-jobb på dem.
