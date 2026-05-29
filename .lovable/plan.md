
# Robust återstart av fastnade jobb — med manuell kontroll

Du behåller full kontroll: **inget jobb startas automatiskt**. Du återupptar varje jobb manuellt från UI:t, och då kör vi en korrekt återstart (reset av failed-domäner + resolver + scraper) så det inte fastnar igen.

## Vad som byggs

### 1. Ny edge function: `resume-job`
Centraliserad, idempotent återstart för ETT jobb i taget. När den anropas:
- Sätter jobbets `status = running` och rensar `paused_reason`.
- Resettar `domain_status` från `failed` → `unresolved` för alla bolag kopplade till jobbet som saknar domän.
- Invokar `resolve-domains-batch` med `{ jobId, retryFailed: true }`.
- Invokar `scrape-emails-batch` med `{ jobId }`.
- Loggar tydligt i `crawl_logs` vad som gjordes.

### 2. Watchdog i `scrape-emails-batch` (säkerhetsnät, inte auto-start)
Bara aktivt för jobb som **redan är `running`**. Startar inga pausade jobb.
- **Auto-kick av resolver**: om vågen har `pendingResolution > 0` och inget rört sig på resolver-sidan på 2 vågor (~30s), invokeras `resolve-domains-batch` automatiskt för det jobbet. Detta löser dagens grundbug där scrapern väntar i evighet på en resolver som aldrig kördes.
- **Stall-skydd**: om jobbet inte gör framsteg på 20 vågor (~5 min) sätts det till `paused` med `paused_reason = 'stalled'` så det inte snurrar för evigt.

### 3. UI — manuell kontroll per jobb
- `JobDetail`: befintlig **Start/Resume**-knapp på pausade jobb kopplas om till `resume-job` (istället för bara `status=running`). Banner uppdateras med text: *"Klicka Start för att återuppta — domänupplösning och scraping startas i kontrollerad ordning."*
- `Jobs.tsx`: **ingen** "Resume all"-knapp läggs till (per ditt önskemål). Listan visar pausade jobb tydligt så du kan starta dem en i taget.
- Lägg till en liten **credit-räknare** i jobb-headern (`firecrawl_calls` finns redan på `crawl_jobs`) så du ser i realtid hur mycket Firecrawl drar för det jobb du just startat.

### 4. Engångs-städning (ingen auto-start)
SQL som **bara** normaliserar data — startar inga jobb:
- För alla bolag i jobb som är `paused` med `paused_reason = 'firecrawl_payment_required'`: sätt `domain_status` från `failed` → `unresolved` så att en framtida manuell resume faktiskt kan retry:a dem.
- Lämnar jobbens `status = paused`. Du startar dem själv när du vill.

## Flöde när du klickar Start på CRMdata: Fintech
```text
[Du klickar Start]
      │
      ▼
resume-job (jobId)
      ├─ status = running, rensa paused_reason
      ├─ failed → unresolved (för detta jobbs bolag)
      ├─ invoke resolve-domains-batch (retryFailed: true)
      └─ invoke scrape-emails-batch
              │
              ▼
        Vågor körs, watchdog håller resolver vid liv vid behov
              │
              ▼
        Klar ELLER stall-pausad efter 5 min utan framsteg
```

## Filer som ändras
- **Ny**: `supabase/functions/resume-job/index.ts`
- `supabase/functions/scrape-emails-batch/index.ts` — auto-kick av resolver + stall-skydd
- `src/pages/JobDetail.tsx` — Start-knappen anropar `resume-job`
- `src/components/jobDetail/JobStatusBanners.tsx` — uppdaterad text
- `src/lib/api.ts` — `resumeJob(jobId)` helper
- En SQL-update (via insert-tool) för engångs-städning av failed-domäner i pausade jobb

## Vad som INTE händer
- Inga jobb startas automatiskt.
- Ingen mass-resume knapp.
- Inga credits dras förrän du själv klickar Start på ett specifikt jobb.
