# Ny skrapning — noll påhitt, helst 1 och max 3 personer per bolag

## Verifierat: detta skydd finns redan i skraparen

- **Inga påhittade namn**: namn måste finnas ordagrant i sidans text; platshållare kasseras.
- **Inga gissade mejl**: en persons adress sparas bara om den står ordagrant på sidan. Gamla gissningsvägarna (`matched_high`/`matched_low`) är borta.
- **Validering vid lagring**: format, domän tillhör bolaget, MX-post finns.
- **Märkning**: `email_type` (personal/role) + `email_status` (verified/unverified).
- Batch-workern skickar med målroller och person-tak till skraparen.

## Ändring som saknas: tak 5 → 3 personer per bolag

Idag: "One person per company" ger **exakt 1**, annars sparas **upp till 5**. Inget av det är "helst 1, max 3".

- `supabase/functions/scrape-emails/index.ts`: `MAX_PEOPLE_PER_COMPANY` ändras 5 → 3.
- Rankingen (bästa personen först: målroll → beslutsfattare → har mejl → högst konfidens) är oförändrad — den bästa sparas alltid först.
- Tidigt stopp finns redan: hittas målrollspersonen med mejl avbryts bolaget direkt → i praktiken oftast 1 person när den rätta hittas tidigt.
- Deploya om `scrape-emails` så det är 100 % säkert att senaste koden kör.

## Så startar du den nya skrapningen

1. Välj målroll (t.ex. VD/CEO) i formuläret → skraparen letar målmedvetet och stoppar bolaget vid träff.
2. Välj tak:
   - "One person per company" ikryssad = exakt 1 per bolag
   - Urkryssad = upp till 3 per bolag (bästa först)

## Permanent regel

Spara i projektminnet: aldrig fabricera namn/mejl, tomt fält före gissning, max 3 personer per bolag (helst 1).

## Verifiering

Efter deploy: starta ett litet testjobb (några bolag) och kontrollera i People-fliken att inget bolag har fler än 3 personer, att alla mejl har källa, och att inga platshållarnamn finns.

## Tekniska detaljer

- Enda kodändringen: en konstant i `scrape-emails/index.ts` (5 → 3). Ingen migration, inga andra filer.
- Deploy via deploy-verktyget, därefter testjobb mot databasen för bekräftelse.
