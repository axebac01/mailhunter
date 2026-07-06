## Vad som faktiskt händer

Jobbet är **inte pausat** — det står `status=running` och worker-heartbeat är från nyss. Så här ser det ut just nu:

- **574** företag scrapade (alla med löst domän) → det är därför "kontakter/personer" står still: scrapern har inget nytt att jobba på.
- **5370** företag väntar fortfarande på domän-resolution.
- **347** är markerade `no_domain_found`, **25** `failed`.

Scrapern loggar varje 20 sek: *"Wave start: 0 to scrape (574 already done), 5370 awaiting domain resolution"* — dvs. den snurrar i tomgång och väntar på att resolvern ska plocka undan mer av backloggen.

## Varför resolvern knappt gör framsteg

Resolvern körs faktiskt hela tiden och loggar 60–80 `Resolved …` per minut för det här jobbet. Men i databasen ökar antalet företag med satt `domain` bara med **~2/min**. Orsak: parallella resolver-invocations racear på samma lista.

- Scrapern anropar `resolve-domains-batch` var 40:e sekund ("kicked resolver").
- Varje anrop läser ALLA 5370 unresolved-företag, sorterar dem lika, och börjar processa från toppen.
- Resolvern har dessutom en egen `continuation`-loop (self-invoke efter 100 s).
- Resultat: 3–5 parallella resolver-processer betar samma företag om och om igen. Loggen visar t.ex. "Fixaren i Stockholm AB → it-fixaren.se" resolvat två gånger inom 90 sekunder.

Så det mesta av resolvern-jobbet är dubblerat arbete som skriver samma domän flera gånger istället för att komma vidare i listan.

## Fix

Två små ändringar, inga schemaändringar:

**1. Dedupa i resolvern (`supabase/functions/resolve-domains-batch/index.ts`, urvals-steget kring rad 538–544)**

Efter att `todo` beräknats, filtrera bort företag som redan blivit rörda de senaste 90 sekunderna (annan resolver håller på med dem):

```
todo = todo.filter(c => !c.updated_at || Date.now() - new Date(c.updated_at).getTime() > 90_000)
```

Kräver att `updated_at` finns i `select` (den saknas i chunk-select rad 526 — lägg till).

**2. Backoff i scrapern (`supabase/functions/scrape-emails-batch/index.ts`, "kicked resolver"-blocket)**

Lagra `meta_json.last_resolver_kick_at`. Kicka bara resolvern om det gått ≥ 90 sek sedan förra kick. Så länge resolvern jobbar (den self-continueter) behövs ingen ny kick.

Detta räcker för att eliminera race:et. Resolvern behåller sin nuvarande kapacitet men slutar dubbla arbete → verklig throughput ~5–10× högre.

## Vad som händer efter deployen

- Ingen manuell action krävs på det pausade jobbet — det körs redan.
- Antal resolvade företag börjar öka snabbt, scrapern får material att jobba på, `contacts_found`/`people` börjar ticka upp igen.
- ETA för att beta av 5370 företag: ~30–60 min (mot flera timmar med nuvarande race).

## Filer som ändras

- `supabase/functions/resolve-domains-batch/index.ts` — lägg till `updated_at` i select + filter i `todo`-beräkningen.
- `supabase/functions/scrape-emails-batch/index.ts` — cooldown på "kicked resolver".

Ingen schemaändring. Ingen UI-ändring.
