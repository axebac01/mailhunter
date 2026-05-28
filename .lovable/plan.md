## Mål
Maximera **antalet bolag vi når någon på** per credit. Prioritera VD/grundare/styrelseordförande över volym av mejl per bolag. Sänka kostnaden från ~15–40 credits/bolag till **~3–8 credits/bolag**.

## Sammanfattning av besparingar

| Optimering | Credit-besparing/bolag |
|---|---|
| Hoppa över domän-resolution när `se_companies.website` finns | −2 till −4 |
| Minska sidantal från 12 → 3 (tiered scraping) | −7 till −9 |
| Ta bort 8 sub-team-hops | −5 till −40 (8 LLM-scrapes á 5 credits) |
| JSON-extract bara på 1 sida (toppkandidat) i stället för alla 12 | −20 till −40 |
| Cacha domäner som redan scrapats | varierar, ofta −100 % på dubletter |
| Tidigt avbrott så snart vi har 1 beslutsfattare med mejl | −2 till −10 |

**Förväntad nivå: ~3–8 credits per bolag** → 200k credits räcker till **25k–60k bolag**.

## Nya credit-budget regler

1. **Hård cap per bolag**: max 5 Firecrawl-anrop (oavsett vad). Loggas och bryts vid överträdelse.
2. **Hård cap per LLM-extract**: max 1 per bolag.
3. **Map-anrop limit 30** (var 200) — vi tar ändå bara topp-3.

## Förändringar

### A. `resolve-domains-batch` — hoppa när vi redan vet
- Innan vi anropar Firecrawl: kolla `companies.notes` efter `org.nr: NNN` (vi sätter det redan vid SE-import). Om `org_nr` finns → slå upp `se_companies.website`. Om non-tomt och giltig URL → sätt `domain_status='resolved'` direkt utan Firecrawl.
- För övriga bolag: behåll nuvarande flöde men ta bort steg 3 (`mapFirecrawl` fallback för borderline 3–4) — den ger marginal nytta för hög kostnad.
- Ta bort LLM-tiebreaker när top-1 har score ≥ 3 (den drar Lovable AI-tokens, inte Firecrawl, men sänker latens).

### B. `scrape-emails` — tiered + early-exit + decision-maker-first

Ny ordning (avbryts så snart "succé-villkor" möts):

```text
Tier 1 (alltid, 1 scrape):
  - Scrapa /kontakt eller /contact direkt (kanonisk gissning, head-probe först)
  - Om träff: regex för mejl, telefon, formulär

Tier 2 (om Tier 1 ej hittade person-mejl, 1 scrape):
  - Scrapa /ledning, /om-oss/ledning, /team, /medarbetare (head-probe + första som svarar)
  - JSON-extract = TILLÅTET HÄR (1 LLM-anrop totalt)
  - Filtrera people på role_title regex: VD|CEO|grundare|founder|ägare|owner|partner|styrelseordförande|chairman
  - Rangordna: beslutsfattare först

Tier 3 (bara om vi fortfarande har 0 mejl OCH 0 personer, 1 scrape):
  - Map (limit 30) + scrapa hemsidan
```

**Succé-villkor (early-exit):**
- ≥1 person-mejl OCH person är beslutsfattare → klart efter Tier 1 eller 2
- ≥1 generisk mejl (info@/kontakt@) → räcker som "vi når bolaget" → klart
- Synthesizera VD-mejl från pattern om vi sett `first.last@domain` någonstans

**Ta bort:**
- Sub-team-hop (rader 309–324): 0 nytta vs ~40 credits/bolag i värsta fall
- "JS-rendered fallback retry" (rad 347–352): scrapar samma URL igen med wait — dubblar kostnad. Behåll men bara på Tier 1-sidan, max 1 ggr/bolag.

### C. Domän-cache
- Innan vi startar scrape-emails för company X: kolla om någon annan `companies`-rad har samma `domain` och redan har `contacts` eller `contact_people` rader.
- Om ja: kopiera över mejlen direkt (med ny `company_id`, samma `source_url`), spara 100 % av credits.

### D. Beslutsfattare-prioritet i UI och DB
- Lägg till `contact_people.is_decision_maker` (boolean, default false). Sätts true när role matchar regex ovan.
- I exporten till Outreach: skicka beslutsfattare först, generic@ som fallback.

### E. Credit-räknare per jobb
- Räkna Firecrawl-anrop per `crawl_job` (i `crawl_jobs.meta_json.firecrawl_calls`).
- Visa i JobDetail-headern: "Förbrukat: 1 234 credits · Snitt: 3,2/bolag".
- Hjälper er upptäcka regressioner direkt.

## Teknisk implementation

**Filer som ändras:**
- `supabase/functions/scrape-emails/index.ts` — refaktor till tiered flow + cache-kontroll + counter
- `supabase/functions/resolve-domains-batch/index.ts` — SE-website shortcut + ta bort map-fallback
- `supabase/functions/resolve-domain/index.ts` — samma som ovan
- `supabase/functions/import-se-companies/index.ts` — sätt redan `domain_status='resolved'` när vi importerar med website från se_companies
- ny migration: kolumn `contact_people.is_decision_maker` + index, kolumn `crawl_jobs.firecrawl_calls` (int default 0)
- `src/pages/JobDetail.tsx` — visa credit-counter i header

**Regex för beslutsfattare (svenska + engelska):**
```ts
const DECISION_MAKER_RE = /\b(vd|verkst[äa]llande direkt[öo]r|ceo|grundare|founder|co-founder|[äa]gare|owner|partner|styrelseordf[öo]rande|chairman|managing director|md)\b/i;
```

**Cache-kontroll (pseudo):**
```ts
// Innan tier 1:
const { data: cached } = await supabase
  .from("contacts")
  .select("value, contact_type, source_url, company_id")
  .eq("company_id", anyOtherCompanyIdWithSameDomain);
if (cached?.length) { copyOver(); return; }
```

## Risker
- Färre scrapade sidor = något lägre hit-rate på små webbplatser där kontakt finns på sida 4. Mitigering: Tier 3 fallback fångar de flesta.
- Synth-mejl är osäkrare — markerar dem som `is_publicly_listed=false` redan idag, så Outreach kan filtrera bort vid behov.
- Cache antar samma domän = samma bolag. Stämmer för stora koncerner men kan ge "fel" namn på personer. Mitigering: cacha bara generic@-mejl, inte personer.

## Rollout
1. Migration (kolumner + index)
2. Uppdatera 4 edge-functions
3. Deploy + testa på 50 bolag via befintligt jobb
4. Jämför credits/bolag före/efter i counter
5. Om OK: kör pilot 500 bolag, sedan full körning