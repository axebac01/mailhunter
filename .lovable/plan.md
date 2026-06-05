## Mål

Maximera **antal företag med ≥1 kontaktuppgift** per Firecrawl-credit. Vi accepterar att vi tappar djupet (färre personer/företag) i utbyte mot bredd (fler företag täckta) och lägre kostnad.

## Nuvarande beteende (scrape-emails)

- **Tier 1** (1 credit): scrape kontaktsidan. Hämtar mejl/telefon/formulär.
- **Tier 2** (≈5 credits + 1 LLM): scrape ledning/team-sida med JSON-extract för personer — körs alltid om vi inte har person-mail, även om Tier 1 hittat generic@ + telefon.
- **Tier 3** (≈2 credits): map + scrape fallback om 0 mejl OCH 0 personer.

Idag drar Tier 2 in ~5 extra credits per företag bara för att leta efter namn när vi redan har kontaktväg. Det är huvudboven.

## Föreslagen ändring — "Coverage-first"-läge

### 1. Definiera "company is reached"

Ett företag räknas som täckt så snart Tier 1 producerat **minst en** av: generic_email, person_email, phone, contact_form.

### 2. Skippa Tier 2 om företaget redan är täckt

Idag: `needsTier2 = !hasPersonMail && opt.personNames`
Nytt: `needsTier2 = (acc.emails.size === 0 && acc.phones.size === 0 && acc.forms.size === 0) && opt.personNames`

Dvs Tier 2 körs **bara** när Tier 1 inte gav någon kontaktväg alls — då är ledning/team-sidan vår sista chans att hitta en person/mejl innan Tier 3.

### 3. Skippa pattern-synthesis-loop när vi är täckta

Pattern-synthesis (rader 522–547) genererar `first.last@domain` för varje rankad person. Den drar inga credits men skapar brus. Kör bara om företaget annars saknar person-mail. (Behåller logiken men gatas av `acc.emails.size === 0` eller minst en person utan mail + sample finns — funktionellt samma som idag men cap till **max 1 syntetiserad mail per företag** istället för alla.)

### 4. Sänk HARD_CAP från 5 → 3

Med Tier 2 normalt avstängd blir realistiskt max:
- Tier 1: 1 credit (+1 om JS-retry)
- Tier 3: 2 credits (map + 1 scrape) endast om Tier 1 helt tom

Sätt `HARD_CAP = 3`. Skyddsnät mot oavsiktliga loopar.

### 5. UI-flagga (valfri, default på)

Lägg till `coverage_first_mode` på `crawl_jobs` (boolean, default true). I `CreateJob`-formuläret en checkbox: *"Coverage-first: prioritera bredd före djup (1 kontakt per företag, lägre credits)"*. När av → gammalt beteende (Tier 2 alltid).

Om du vill hålla det enkelt kan vi hoppa flaggan och bara byta default. Säg till.

### 6. Förväntad effekt på CRMdata:Fintech

Baseline: ~150–200 credits, 225 contacts, 191 people för 72 företag (~2.5 credits/företag).
Efter ändring: uppskattat ~80–110 credits (~1.2/företag), färre personer (Tier 2 körs bara på företag utan kontaktsida) men samma eller bättre **företagstäckning** (Tier 3 oförändrad som sista räddning).

## Filer som ändras

- `supabase/functions/scrape-emails/index.ts` — Tier 2-gate, HARD_CAP, ev. läs `coverage_first_mode` från jobbet.
- (valfritt) migration: lägg till `coverage_first_mode boolean default true` på `crawl_jobs`.
- (valfritt) `src/pages/CreateJob.tsx` + `src/lib/api.ts` — UI-flagga.

## Verifiering

Kör om CRMdata:Fintech (rensa source_pages/contacts/contact_people för jobbet först) och jämför:
- antal företag med ≥1 contact (mål: ≥ baseline)
- total `firecrawl_calls` (mål: ≥40 % lägre)
- antal personer (förväntat lägre — det är trade-offen)

## Beslut jag behöver

1. Vill du ha UI-flagga eller bara byta default till coverage-first för alla jobb?
2. Ska Tier 2 vara helt avstängd när Tier 1 ger kontakt, eller behållas men med striktare cap (t.ex. bara om kontaktsidan saknar mejl)?