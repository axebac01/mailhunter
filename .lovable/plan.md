# Personfilter vid export + fix för jobbet som stannade på 20%

## Diagnos: varför "Bisdata: Generationsskifte rensad" stannade på 20%

Jobbet har status `completed` men progress 20%. Orsaken är **inte** Firecrawl eller resolvern:

- Appens egen live-uppdatering (`jobSimulator.tick`, körs i webbläsaren var 4:e sekund medan jobbet är "running") markerar automatiskt jobb som klara när `companies_found >= max_companies`.
- Jobbet har **Max companies = 1000**. När skrapningen passerade 1000 bolag (1006 hann bli klara) satte webbläsaren status = "completed". Serverns batch-worker såg det vid nästa våg, loggade "Scraping completed by user after wave" och avslutade permanent.
- Den kontrollen är tänkt för demoläget (industry_country-jobb) men träffar alltså även uppladdade jobb av misstag.
- Kvar att bearbeta när det stoppades: **2 305 resolverade bolag som aldrig skrapades** + 1 753 som fortfarande väntar på domänresolvern (av totalt ~5 000).

## Diagnos: varför "alla möjliga personer" hämtades

Skrapern sparar idag alla personer som LLM-extraktionen returnerar med en beslutsfattartitel (CEO, CFO, CTO, Partner, Head of … — ingen övre gräns per bolag) plus **syntetiserade personer** för varje personlig mejladress som hittas utan namn på sidan (1 054 av 1 811 personer i jobbet saknar titel). Ett bolag fick 128 personer.

## Del 1: Fix så uppladdade jobb kan köra klart

- `src/lib/jobSimulator.ts`: autoavslutet på `max_companies` ska bara gälla `industry_country`-jobb. Uppladdade jobb markeras klara enbart av servern när allt är skrapat.
- Efter deploy återupptas jobbet via "Restart worker"/Start — det fortsätter då på de ~2 305 oskrapade bolagen och sparkar igång resolvern för de 1 753 kvarvarande.
- Notera: snittförbrukningen hittills är ~2,3 credits/bolag, så resten kostar grovt 5 000–6 000 Firecrawl-credits. Du avgör om du vill köra vidare.

## Del 2: Exportval för personer (huvudönskemålet)

När man väljer **People** eller **Both** i exportmenyn (både på jobbdetaljsidan och massexporten på Jobs-sidan) öppnas först en liten dialog med två val:

1. **Titelfilter** — kryssrutor för förvalda titelgrupper (svenska + engelska varianter matchas automatiskt):
   - VD / CEO / Verkställande direktör / Managing Director
   - CFO / Ekonomichef
   - COO, CTO, CMO och övriga C-nivåer
   - Grundare / Founder / Co-founder
   - Ägare / Owner / Delägare
   - Partner
   - Styrelseordförande / Chairman
   - Head of / Director / VP
   - "Inkludera personer utan titel" (de som hittats via mejladress) som separat kryssruta
   - Genväg: "Bara beslutsfattare" markerar alla grupper ovan.
   - Inget val = alla personer (som idag).
2. **Max en person per bolag** — väljer automatiskt den bästa personen per bolag: beslutsfattare först, sedan den som har mejl, sedan högst mejl-konfidens (från sida > stark match > svag match).

Implementering:
- `src/lib/exporters.ts`: ny `TITLE_GROUPS`-lista med nyckelordsmatchning + `filterPeopleForExport(people, opts)` som filtrerar och plockar bästa personen per bolag. Trådas genom `exportJobResults` och `exportJobsZip` (gäller även zip-filerna vid "Both").
- Ny komponent `PeopleExportOptionsDialog` (Dialog + Checkbox, befintliga UI-komponenter). `JobExportMenu` får ett läge där val som innehåller personer öppnar dialogen först, sedan körs exporten.
- Contacts-exporten påverkas inte.

## Del 3: Tak på antal personer per bolag vid skrapning (framtid + återupptagning)

För att inte återupptagningen (eller nästa jobb) ska fylla på med "alla möjliga personer" igen:

- `supabase/functions/scrape-emails/index.ts`: spara max **5 personer per bolag** efter befintlig rankning (beslutsfattare först, med mejl först), varav max **3 syntetiserade** (mejl-hittade utan namn/titel).
- Redan inskrapad data för de ~1 000 första bolagen rörs inte — där löser exportfiltret urvalet istället.

## Tekniska detaljer

- Titelmatchning sker case-insensitivt mot normaliserade nyckelord (samma stil som befintliga `DECISION_MAKER_RE` i scrape-emails).
- Ranking vid "max en per bolag": `is_decision_maker` desc → har mejl → `email_confidence` (extracted > matched_high > matched_low) → full_name.
- Ingen databasändring behövs. Edge-funktionen scrape-emails deployas om (del 3).
- Befintliga `contact_people`-kolumner räcker (role_title, is_decision_maker, email, email_confidence).
