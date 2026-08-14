# Bisdata: Generationsskifte — resolvern har stått still i 25 minuter

## Vad som faktiskt händer (verifierat i databasen)

Jobbet står som `scheduled` och har **aldrig körts**: `last_run_at` är null, 0 sidor skrapade, 0 Firecrawl-credits. Domänstatistiken: 9 629 företag totalt — 434 resolved, 65 no_domain_found, 1 failed, **9 129 unresolved**.

Tidslinjen:

1. **09:05:34** — importen blev klar (9 629 rader). De 9 129 nya företagen skapades med `updated_at` 09:04:57–09:05:06.
2. **09:05:43** — CreateJob kickade resolvern (`{ importId, jobId }`). Resolverns 90-sekundersfilter ("skippa bolag som rörts de senaste 90 sekunderna") filtrerade bort **alla** 9 129 — de var ju nyss skapade. Loggen säger: *"Resolving domains for 0 companies"* → *"Domain resolution complete: 0 resolved, 0 failed"*. Resolvern har inte rört jobbet sedan dess.
3. **09:05–09:09** — importens egna resolver-vågor (som skjuts från webbläsaren) hann processa exakt de ~500 bolag som har status idag. Sen slutade de — vågorna är fire-and-forget från browsern och dör när man navigerar vidare från importsidan.
4. Scrapern (`scrape-emails-batch`) startades aldrig — och det är där watchdogen bor som automatiskt kickar en stående resolver. Jobbet är `scheduled`, så ingen återhämtning finns.

Det finns dessutom två latenta buggar som skulle försvåra räddningen:
- Importvågorna skickar **både** `importId` och `companyIds` — resolvern unionerar dem, så varje 200-våg hämtar om och processar **hela** importens unresolved-mängd. Massiv överlappning och dubbla Firecrawl-anrop.
- `resume-job` ("Restart worker"-knappen) kickar resolvern med bara `retryFailed: true` — den plockar `failed`-bolag men **missar alla 9 129 aldrig-prövade**. Knappen hade alltså inte räddat det här jobbet.

## Fix

**1. `resolve-domains-batch`: `companyIds` blir en exakt mängd**
När `companyIds` skickas ska resolvern processa exakt de id:na — inte unionera med importens/jobbets hela bolagslista. Dödar överlappet och de dubbla Firecrawl-krediterna.

**2. `resolve-domains-batch`: 90s-cooldown gäller aldrig `unresolved`**
Resolvern lämnar alltid ett bolag med resolved/failed/no_domain_found efter ett färdigt försök — ett bolag som fortfarande är `unresolved` har per definition inte prövats klart. Cooldown-filtret ska bara gälla `failed`-försök. Då kan aldrig import→kick-racen ge "0 companies" igen.

**3. `importPipeline`: bort med browser-vågorna**
Ta bort `enqueueResolverWaves` (vågdispatch från webbläsaren under importen). Ersätt med **en enda** fire-and-forget-kick vid importens slut (`{ importId, jobId }`). Resolvern kedjar sig själv server-side via sin 100s-budget + continuation tills allt är klart — oberoende av om fliken stängs.

**4. `resume-job`: kicka resolvern med `includeUnresolved: true`**
Så att "Restart worker" faktiskt plockar upp aldrig-prövade bolag, inte bara failed.

**5. Få igång det här jobbet direkt (engångsåtgärd, ingen kod)**
Efter deploy av fixarna kör jag en server-side kick: status → `running`, nollställ watchdog-räknare, invoka resolvern med `{ jobId, retryFailed: true, includeUnresolved: true }` och starta scrapern. (Att bara klicka Start hade också funkat nu — men först efter fix 4 är "Restart worker" en tillförlitlig räddningsknapp.)

## Förväntat resultat

Resolvern börjar arbeta igenom de 9 129 bolagen i kedjade körningar, scrapern väntar in domäner och börjar skrapa allt eftersom, och watchdogen kickar resolvern automatiskt om den stannar igen. Framtida importer kan inte fastna på samma sätt.

## Filer som ändras

- `supabase/functions/resolve-domains-batch/index.ts` — exakt companyIds-mängd + cooldown bara för failed
- `supabase/functions/resume-job/index.ts` — includeUnresolved i resolver-kicken
- `src/lib/importPipeline.ts` — en server-side resolver-kick i stället för browser-vågor
