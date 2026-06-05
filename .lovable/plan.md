## Vad som hände med CRMdata:Fintech

Jobbet fastnade på 83% (60 av 74 företag scrapade) i ett oändligt watchdog-loop tills stall-skyddet pausade det efter ~5 min.

**Status i databasen för de 14 olösta företagen:**
- 12 har `domain_status = 'unresolved'` (aldrig prövade klart)
- 2 har `domain_status = 'failed'` (t.ex. "Evida AB" — söket hittar inget rimligt)

**Buggen** finns i `scrape-emails-batch/index.ts` rad 220:
```ts
body: JSON.stringify({ jobId, retryFailed: true }),
```

När watchdogen "kickar resolvern" skickar den `retryFailed: true`. I `resolve-domains-batch` rad 538–540 betyder det:
```ts
retryFailed ? allCompanies.filter(c => !c.domain && c.domain_status === "failed") : ...
```
→ Endast de 2 `failed`-företagen plockas upp. De 12 `unresolved` ignoreras varje gång, och de 2 `failed` försöker resolvern om och om igen utan resultat → 0 progress → 20 idle waves → auto-pause.

Loggarna bekräftar det exakt: varje kick loggar `Domain resolution complete: 0 resolved, 2 failed. total:2` — bara 2 företag processas per kick.

Dessutom: Evida AB:s två "no domain found" är permanenta (företaget har ingen webbplats som matchar sökningarna). Att retrya dem för evigt är meningslöst — de borde markeras som färdigt-misslyckade så watchdogen slutar räkna dem som "pending".

## Plan

### 1. Fixa watchdog-kick (huvudfixen)
I `supabase/functions/scrape-emails-batch/index.ts`, ändra resolver-kicket så det hanterar **alla** företag utan domän (både `unresolved` och `failed`):
```ts
body: JSON.stringify({ jobId, retryFailed: true, includeUnresolved: true }),
```
Och i `resolve-domains-batch/index.ts` lägg till `includeUnresolved` i selection-läget:
```ts
const todo = reresolveAll ? allCompanies
  : (retryFailed && includeUnresolved) ? allCompanies.filter(c => !c.domain)
  : retryFailed ? allCompanies.filter(c => !c.domain && c.domain_status === "failed")
  : allCompanies.filter(c => !c.domain);
```
Alternativ (enklare): bara skicka `{ jobId }` utan `retryFailed` så används default-läget (`!c.domain`), som plockar både unresolved och failed.
→ Jag väljer det enklare alternativet.

### 2. Markera permanent-misslyckade så de inte räknas som pending
När en `failed` resolveas igen och fortfarande misslyckas N gånger (t.ex. 3), sätt en ny status `no_domain_found` (eller använd `meta_json.resolve_attempts >= 3`). Watchdogens `pendingResolution`-räkning i `scrape-emails-batch` (där den filtrerar `!company.domain && status !== "no_domain_found"`) ska då exkludera dem.

Konkret:
- Lägg till räknare `resolve_attempts` i `companies.meta_json` som ökas i `resolve-domains-batch` vid varje failed-utfall.
- Vid `attempts >= 3` sätt `domain_status = 'no_domain_found'`.
- Uppdatera scrape-emails-batch pendingResolution-filter att exkludera `no_domain_found` (och visa dem som "no domain found" precis som befintliga `failed` utan retry-möjlighet).

### 3. Återstarta CRMdata:Fintech-jobbet
Efter deploy: manuellt klicka **Start** på jobbet. `resume-job` återställer redan `failed → unresolved` (existerande kod), och med fix 1 plockar resolvern nu alla 14 företag. De 2 omöjliga går till `no_domain_found` efter 3 försök och jobbet kan slutföras med 72 av 74 scrapade.

### Filer som ändras
- `supabase/functions/scrape-emails-batch/index.ts` — fix watchdog-kick body, filter pendingResolution mot `no_domain_found`.
- `supabase/functions/resolve-domains-batch/index.ts` — räkna `resolve_attempts`, sätt `no_domain_found` vid 3 misslyckanden.
- (ingen UI-ändring nödvändig — "no domain found"-räknaren i banner finns redan)

### Ingen automatik
Inga jobb startas automatiskt. Du klickar Start på CRMdata:Fintech själv när fixen är deployad.
