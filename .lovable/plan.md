# Plan: Personer + kontakter i samma rad

## Problem

Idag är `contact_people` (namn/roll) och `contacts` (mejl/telefon) två separata tabeller. För Outreach behöver vi en **person-centrerad** vy där varje rad har namn + roll + mejl + telefon ihop. Generic-mejlen (info@) finns kvar som fallback för företag utan namngiven person.

## Datamodell

Lägg till på `contact_people`:
- `email text` — personens mejl
- `email_confidence text` — `extracted` (LLM hittade ihop med namnet), `matched_high` (matchat via heuristik: `fornamn.efternamn@domän`), `matched_low` (svagare match), `null` (ingen mejl hittad)
- `phone text` — direkt-tel om vi hittar det

Index på `(company_id, lower(email))` för dedupe.

## Extraktion (`scrape-emails/index.ts`)

1. **Tier 2 LLM** returnerar redan `{full_name, role_title, department, email?}` — utöka prompten: be modellen explicit koppla mejl/tel som står bredvid namnet på sidan. Spara direkt på personen.
2. **Efter Tier 1 + Tier 2**: kör en match-pass på server:
   - För varje extraherad mejl med `class=person_high` (`fornamn.efternamn@domän`): plocka ut förnamn + efternamn ur local-part och försök matcha mot `contact_people.full_name` för samma company.
     - Exakt match → fyll i `email` om tomt, sätt `email_confidence='matched_high'`.
     - Ingen match men person_high → skapa en ny person-rad med `full_name` härlett från mejlet (`Förnamn Efternamn`), `role_title=null`, `email_confidence='matched_high'`. Dessa visas som "okänd roll" i UI.
   - `person_low` (bara förnamn) → matcha bara om unikt förnamn bland företagets personer, annars lämna kvar som löst kontakt.
3. **Generic-mejl** (info@, sales@) → stannar i `contacts` som idag, används som företags-fallback.

## UI

### Ny primär vy: `JobPeopleTab` (befintlig flik döps om till "Kontakter")
Kolumner: **Namn · Roll · Mejl · Telefon · Företag · Källa · Hittad**.
Rader utan mejl visas grålt (kan ändå exporteras med `[generic]` mejl som fallback).

### `JobContactsTab` → "Företagskontakter" (fallback)
Visa bara `generic_email` + telefon — alltså företagsnivå utan namn.

### `Pages/People.tsx` + `Pages/Contacts.tsx`
Samma uppdelning globalt.

## Export → Outreach

`projectPersonRow` i `src/lib/exporters.ts` får nya fält:
- `email` (personens mejl, eller företagets generic om tomt och `include_generic_fallback=true`)
- `email_source` (`person` / `generic_fallback`)
- `phone`

`send-to-outreach`-funktionen byggs om så att `contact_people` blir huvudkällan:
- Skicka person med `email`, `first_name`, `last_name`, `role`, `company`.
- Om en person saknar mejl och företaget har ett generic → skicka med generic som mejl, märk `notes: "generic email"`.
- `contacts`-källan finns kvar för rena företagsmejlsutskick.

## Migration

```sql
ALTER TABLE public.contact_people
  ADD COLUMN email text,
  ADD COLUMN email_confidence text CHECK (email_confidence IN ('extracted','matched_high','matched_low')),
  ADD COLUMN phone text;

CREATE INDEX idx_contact_people_email
  ON public.contact_people (company_id, lower(email))
  WHERE email IS NOT NULL;
```

Ingen RLS-ändring (befintliga policies täcker).

## Verifiering

Kör om `CRMdata: Business Intelligence`. Mät:
- Andel personer med mejl (mål: ≥40 % när företaget har person_high-mejl)
- Andel företag som har minst en person-rad med mejl ELLER en generic-mejl (mål: ≥80 %)
- Outreach-export: kontrollera att rader har `email` ifyllt och rätt `email_source`

## Filer som ändras

- DB-migration (kolumner + index)
- `supabase/functions/scrape-emails/index.ts` — LLM-prompt, email-match-pass, dedupe
- `supabase/functions/send-to-outreach/index.ts` — person-centrerad payload + generic fallback
- `src/lib/api.ts` — `PersonRow` får `email`, `emailConfidence`, `phone`
- `src/lib/exporters.ts` — nya kolumner i `PEOPLE_EXPORT_FIELDS`
- `src/components/jobDetail/JobPeopleTab.tsx` — kolumner Mejl + Telefon
- `src/components/jobDetail/JobContactsTab.tsx` — filtrera till generic_email/phone
- `src/pages/People.tsx`, `src/pages/Contacts.tsx` — samma uppdatering
