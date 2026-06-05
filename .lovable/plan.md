# Analys: CRMdata: Fintech

## Resultat
| Mätvärde | Värde |
|---|---|
| Företag i jobbet | 74 |
| Domäner upplösta | 71 (3 utan domän) |
| Företag scrapade | 72 |
| Personer (people) | 191 (∅ 2,65/bolag, 32 bolag fick träff) |
| Kontakter (e‑post/tel/form) | 225 (∅ 3,13/bolag, 48 bolag fick träff) |
| Source pages skrivna | **328** |
| **Unika** URLer scrapade | **126** |
| Förlorade dubblettscrapningar | **~202 (≈62 %)** |
| `firecrawl_calls`-räknaren | 0 (kolumnen fanns inte vid körningen) |

## Vad var bra
- `scrape-emails` är redan trim­mat: tier‑1 kontaktsida (1 credit) → tier‑2 ledningssida + 1 LLM‑extrahering (≈5) → tier‑3 map+homepage (≈2). Hård cap 5 scrapes + 1 LLM/bolag.
- Sibling‑cache (samma domän, annan företagsrad) ger 0 credits.
- Per *unik* URL ligger vi alltså på ~126 page‑scrapes + några map/LLM = ~150–200 credits totalt → **uppskattat 0,7–0,9 credit per kontakt**, vilket är bra.

## Vad var dåligt
**Samma URL scrapades upp till 11 gånger för samma bolag, alla inom samma minut** (t.ex. `inyett.com/` 11×, `minnatechnologies.com/ledning` 8×). Orsak: `scrape-emails-batch` har ingen lås­mekanism. När watchdogen/återinvokeringen triggar en ny våg innan föregående våg hunnit skriva `source_pages`, plockar nya `runPool`-instansen samma bolag igen. Användarens manuella Start‑klick förvärrar det.

Effekten i siffror: ~200 av 328 page‑scrapes var rena dubbletter → vid skalning är det ~60 % credits i sjön.

# Plan för att förbättra effektiviteten

## 1. Per‑bolag lås i `scrape-emails-batch`
Lägg till en lättviktslås på company‑nivå innan `scrape-emails` invokas:

- Inför `companies.meta_json.scrape_lock = { job_id, started_at }` (eller en ny `scrape_status`‑kolumn med värden `idle | in_progress | done`).
- I `runPool`‑workern: `update companies set meta_json = jsonb_set(... 'scrape_lock' ...) where id = ? and (meta_json->'scrape_lock' is null or (meta_json->'scrape_lock'->>'started_at')::timestamptz < now() - interval '5 min')` — om 0 rader uppdaterades → bolaget är redan låst, hoppa över.
- Lås släpps när scrape är klar (oavsett ok/fel) eller när `source_pages` skrivs.

Detta eliminerar dubbletter både inom samma våg, mellan parallella vågor och vid manuella om­start.

## 2. Singleton‑guard på batch‑workern
Innan en `scrape-emails-batch`‑invokering startar `runPool`:
- Sätt `crawl_jobs.meta_json.worker_heartbeat = now()` atomärt.
- Om en annan heartbeat är < 30 s gammal → exit direkt (logga "another worker active").
- Heartbeata var 10:e sekund medan vågen kör.

Stoppar parallella återinvokeringar (watchdog + manuell Start + scheduleReinvoke som överlappar).

## 3. Färsk dubbel­check av `source_pages` precis innan scrape
I `runPool`‑workern, direkt före `fetch(/scrape-emails)`:
```ts
const { count } = await supabase.from('source_pages')
  .select('id', { count: 'exact', head: true })
  .eq('company_id', c.id).eq('crawl_job_id', jobId);
if (count && count > 0) return; // någon hann scrapa
```
Stänger race‑window mellan `scrapedIds`‑snapshot och scrape­anrop.

## 4. Bättre observability inför stor skala
- Lägg ut `firecrawl_calls` per‑bolag i `source_pages.meta_json` (eller en ny kolumn) så vi kan se "credits per kontakt" per körning i UI.
- Lägg till KPI på job‑sidan: "unika sidor", "duplicerade scrapes" (om > 0 = bug).
- Logga varje skip ("locked by other worker", "already scraped") så vi ser att lås­mekanismen funkar.

## 5. (Mindre) Marginalförbättringar i `scrape-emails`
- Cacha HEAD‑probe‑resultat (`CONTACT_PATHS`) i `companies.meta_json.head_cache` så en omkörning inte upprepar HEAD-anrop (gratis men ändå nätverk).
- Utöka sibling‑cache till att matcha även på `root domain` (idag exakt domän) — t.ex. `app.foo.se` och `foo.se`.

## 6. Verifiera mot CRMdata: Fintech innan storskalning
Efter deploy:
1. Rensa `source_pages`/`contacts`/`contact_people` för jobbet (men behåll company‑posterna och deras `domain`).
2. Klicka Start.
3. Förvänta: ~126 unika page‑scrapes (samma som tidigare unika), 0 dubbletter, ~191 personer, ~225 kontakter.
4. Jämför `firecrawl_calls` mot baseline — målet är **≥ 60 % besparing**.

## Filer som ändras
- `supabase/functions/scrape-emails-batch/index.ts` — lås, singleton‑guard, dubbelcheck.
- `supabase/functions/scrape-emails/index.ts` — släpp lås i finally, ev. HEAD‑cache + utökad sibling‑cache.
- `src/components/jobDetail/...` — visa "unika sidor / duplicerade scrapes / credits per kontakt" i KPI‑bannern.
- (Ev. migration) ny kolumn `companies.scrape_status` eller bara använda `meta_json`. Förslag: `meta_json` — ingen migration.

## Inget körs automatiskt
Inga jobb startas av planen. Du verifierar manuellt på CRMdata: Fintech efter deploy.
