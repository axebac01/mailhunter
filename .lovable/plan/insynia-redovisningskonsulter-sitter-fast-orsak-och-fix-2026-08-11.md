# Insynia: Redovisningskonsulter sitter fast — orsak och fix

## Vad som faktiskt händer

Jobbet är inte pausat — det är `running` och workern har heartbeat just nu. Därför visar knappen "Pausa"/"Stoppa" istället för Start; det går inte att starta ett jobb som systemet redan anser kör. Men det snurrar i en loop utan att göra något:

```
Wave start: 0 to scrape (582 already done), 5315 awaiting domain resolution, 418 no domain.
Waiting on resolution: 5315 pending. No movement for 19 waves — kicked resolver.
Retrying failed domains for 0 companies …
Domain resolution complete: 0 resolved, 0 failed.
```

Scrapern hittar 5315 företag som väntar på domän, kickar resolvern, och resolvern svarar "0 företag att göra". Loopen upprepas i evighet. Inget företag i jobbet har uppdaterats sedan 6 juli.

## Root cause: 1000-radersgränsen i resolverns id-hämtning

`resolve-domains-batch` bygger sin lista så här (rad 507–518):

```
supabase.from("import_rows").select("matched_company_id").in("import_id", impIds)
```

Ingen paginering. Data-API:t returnerar **max 1000 rader** per anrop. Jobbet har 6315 företag, så resolvern ser bara de första 1000 — och de 1000 är exakt de som redan är klara:

| domain_status | antal |
|---|---|
| resolved | 581 |
| no_domain_found | 419 |
| unresolved | 5315 |

581 + 419 = 1000. Resolvern filtrerar bort båda kategorierna och landar på `todo = 0`. De 5315 som faktiskt behöver jobb ligger på sida 2+ och nås aldrig.

Samma 1000-gräns slår mot UI:t: `JobDetail.tsx` (rad 77–85) hämtar `import_rows`, får 1000 id:n, och skickar dem som `.in("id", [1000 uuid])` — den URL:en blir för lång och Data-API:t svarar `400 Bad Request`. Det är felet som spammar konsolen var 5:e sekund och gör att domänstatistiken/bannern inte visas.

Dessutom: watchdogen hann precis (14:44) markera "5315 stuck companies" — de riskerar att flippas till `no_domain_found` fast de aldrig ens har provats.

## Fix

**1. Paginera id-hämtningen i `resolve-domains-batch`** (rad 502–518)
Loopa `import_rows` i sidor om 1000 med `.range(from, from+999)` tills en sida är kortare än 1000 — samma mönster som redan finns i `resume-job`. Gör samma sak för `importId`-grenen och för `companies.created_by_job_id`.

**2. Servergjord domänstatistik i stället för 1000 uuid:n i URL:en**
Ny RPC `job_domain_stats(job_id uuid)` som returnerar `total / resolved / unresolved / failed / no_domain_found` med en enda aggregerande SQL över `imports → import_rows → companies`. `JobDetail.tsx` anropar RPC:n i stället för de tre klientfrågorna. Löser både 400-felet och att siffrorna bara speglade 1000 av 6315 företag.

**3. Skydda watchdogen mot falska "stuck"-markeringar**
Markera bara ett företag som `no_domain_found` om resolvern faktiskt har försökt (dvs. `updated_at` har rörts efter jobbets `last_run_at`). Annars logga varning och kicka resolvern igen i stället för att tysta bort tusentals företag.

**4. Engångsstädning för det här jobbet**
- Återställ de företag som watchdogen just flaggade utan att ha provats: `no_domain_found → unresolved` för jobbets företag där `updated_at` är från importtillfället.
- Nollställ `watchdog_idle_waves` / `watchdog_last_pending` i jobbets `meta_json` så räknaren startar om.

**5. Möjlighet att bryta ett hängande jobb från UI:t**
I `JobDetail` visas i dag bara Pausa/Stoppa när status är `running`. Lägg till en "Starta om worker"-knapp som syns när jobbet är `running` men inget scrapats de senaste ~5 minuterna — den anropar `resume-job` (som redan rensar worker-slot och lås) så du inte behöver stoppa och starta manuellt.

## Förväntat resultat

Resolvern får alla 6315 företag, `unresolved` börjar sjunka på riktigt, scrapern får domäner att jobba på, och domänstatistiken i jobbvyn visar korrekta tal utan konsolfel.

## Filer som ändras

- `supabase/functions/resolve-domains-batch/index.ts` — paginering av id-hämtningen
- `supabase/functions/scrape-emails-batch/index.ts` — striktare stuck-detektion
- ny migration — RPC `job_domain_stats` + engångsstädning av jobbet
- `src/pages/JobDetail.tsx` — använd RPC:n, lägg till "Starta om worker"
