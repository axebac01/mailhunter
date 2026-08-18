# Målroll per jobb + "en person per bolag"

## Mål

När man skapar ett jobb ska man kunna välja **vilken roll man letar efter** (t.ex. VD/CEO). Skraparen letar då målmedvetet efter den rollen på varje bolag och **slutar skrapa bolaget så fort rätt person hittats**. Valfri inställning **"En person per bolag"** gör att bara den bästa personen sparas — aldrig mer 30 personer från samma företag.

Beslut från användaren:
- Om målrollen inte hittas: spara **bästa alternativa beslutsfattare** (grundare, partner, annan C-nivå).
- "En person per bolag" är **valbart per jobb** (kryssruta i formuläret).

## Del 1: Jobbinställningar (databas + formulär)

**Databas** — migration på `crawl_jobs`:
- `target_roles text[]` — valda rollgrupper (samma id:n som exportfiltret: `ceo`, `cfo`, `clevel`, `founder`, `owner`, `partner`, `chair`, `head`). Tomt/null = dagens beteende (alla beslutsfattare).
- `one_person_per_company boolean not null default false`.

**CreateJob.tsx** — ny sektion "Målroll" mellan Basics och Schedule:
- Kryssrutor för rollgrupperna (samma etiketter som i exportdialogen: "CEO / VD / Managing Director", "CFO / Ekonomichef", "Grundare", "Ägare", "Partner", "Styrelseordförande", "Head of / Director / VP", övriga C-nivåer).
- Kryssruta "En person per bolag — stoppa bolaget vid första träff och spara bara den bästa".
- Hjälptext: "Skraparen letar efter dessa roller och stoppar när rätt person hittats. Hittas inte rollen sparas bästa alternativa beslutsfattare."
- Validering: målroller kräver att "Collect contact person names" är på (aktiveras automatiskt).

**JobDetail.tsx**: visa valda målroller + "en person per bolag" som små badges i jobbets header.

**api.ts**: `createJob` + `mapJob`/`Job` får `targetRoles` och `onePersonPerCompany`.

## Del 2: Skraparen (scrape-emails) — det viktigaste

**Delad roll-lista**: flytta `TITLE_GROUPS` till `supabase/functions/_shared/titleGroups.ts` (ren TS, regex som strängar). Importeras både av edge-funktionen och av frontend (`exporters.ts` pekas om) — en enda källa, ingen drift mellan exportfilter och skrapare.

**Nya options**: `targetRoles: string[]` och `onePersonPerCompany: boolean` skickas med från batch-workern (läses från jobbraden).

**Målmedveten LLM-prompt**: när målroller är valda skriver prompten explicit att den ska leta efter just dessa roller först (t.ex. "Prioritize CEO/VD/Verkställande direktör").

**Tidigt stopp (sparar både tid och Firecrawl-credits)**:
- Efter varje skrapad sida körs en snabb koll: har vi en person som matchar målrollen **och** har mejl? Då avbryts resterande sidor för bolaget direkt (loggas som `target_found`).
- Utan målroll gäller som tidigare: beslutsfattare med mejl räcker för stopp.
- Matchningen mejl↔namn körs inkrementellt efter varje tier så stopp-kollen alltid har färsk data.

**Sparande**:
- `one_person_per_company` på: exakt **en** person sparas — bästa enligt ranking: (1) matchar målroll, (2) är beslutsfattare, (3) har mejl, (4) högst mejl-konfidens. Hittas ingen person med titel alls sparas max **en** namnrekonstruerad person (från personlig mejladress) så bolaget ändå får någon att nå.
- Målroller utan "en person": bara personer som matchar målrollerna sparas (upp till dagens tak på 5); matchar ingen sparas bästa beslutsfattarna som fallback.
- Inget av detta valt: oförändrat beteende.

**Domän-cache (Tier 0)**: vid cache-träff kopieras idag bara generella kontakter. Komplettera: kopiera även **bästa matchande personen** från syskonbolaget (samma domän = samma team-sida) när målroller/"en person" är aktiva — annars skulle duplicerade domäner sakna person i exporten. 0 credits som tidigare.

## Del 3: Batch-workern

- `scrape-emails-batch/index.ts`: skicka med `targetRoles` och `onePersonPerCompany` från `crawl_jobs`-raden i anropet till `scrape-emails`. (Den läser redan jobbkolumnerna — ingen annan ändring.)
- Verifiera att `resume-job` inte skickar egna options (den startar bara batch-workern).

## Del 4: Deploy + driftsättning

- Migration körs (två nya kolumner — inga GRANTs behövs, de ärvs från tabellen).
- Deploya `scrape-emails` + `scrape-emails-batch`.
- Befintliga jobb/data påverkas inte — exportdialogens titelfilter + "max en per bolag" finns kvar för redan skrapad data.
- `BulkCreateCrmdata` lämnas som den är (nya fält är valfria, default = dagens beteende). Kan enkelt få samma val senare om du vill.

## Tekniska detaljer

- Rollmatchning sker case-insensitivt mot normaliserade regex (samma stil som `DECISION_MAKER_RE`), delad kod i `_shared/titleGroups.ts`.
- Stopp-koll per bolag: "person matchar målroll (eller är beslutsfattare om ingen målroll) OCH har mejl med confidence extracted/matched_high/matched_low".
- Ranking vid "en person": målrollsmatch → `is_decision_maker` → har mejl → konfidens (extracted > matched_high > matched_low).
- Tidigt stopp minskar typiskt 1–3 Firecrawl-credits per bolag där rollen hittas på första ledningssidan.
- Frontend importerar delad fil via relativ sökväg (`supabase/functions/_shared/...`) — fungerar i Vite eftersom den ligger inom projektroten.
