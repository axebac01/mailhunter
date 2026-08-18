# Stoppa fabricerade kontakter — källfix, städning och nytt exportkontrakt

## Bakgrund (verifierat i kod och data)

Tre fabriceringsvägar i `scrape-emails` har producerat felaktig data:

1. **Påhittade namn**: hittad adress `magnus.wikstrom@bolag.se` utan namn på sidan → personen "Magnus Wikstrom" skapades från adressen. **10 604 rader.**
2. **Gissade mejl-kopplingar**: äkta person "Anna Svensson, VD" + adress `anna.svensson@…` på samma sajt → kopplade ihop utan belägg. **185 rader.**
3. **LLM-hallucinerade adresser**: adresser från AI-extraktion godtogs utan att kontrolleras mot sidans faktiska text och märktes som högsta säkerhet ("extracted"). **Upp till 6 027 rader kan vara drabbade.**

## Del 1 — Scrapern får aldrig gissa (`scrape-emails/index.ts`)

- Ta bort namnfabrikationen helt. Adress utan namn på sidan → sparas som namnlös företagskontakt (`person_email`), aldrig som person.
- Ta bort namn↔mejl-gissningen (`matched_high`/`matched_low` upphör att finnas).
- LLM-levererad adress accepteras bara om den förekommer ordagrant i sidans text/mailto — annars kasseras adressen (personen behålls utan mejl).
- Personnamn måste finnas ordagrant på sidan. Platshållare (`[...]`, "Name Surname", "CFO Name", "N/A", "Okänd" m.fl.) kasseras.
- Validering vid lagring: format-regex, adressens domän måste tillhöra bolagets domän, MX-post måste finnas (en DNS-slagning per domän, cachead). Underkänt → kassera + logga.
- Klassificering: rollprefix (info@, kontakt@, vd@ …) → `email_type="role"`, annars `"personal"`. Dedupe på lowercase-adress.
- Ärlighet om gräns: SMTP-verifiering av själva brevlådan går inte från plattformen (port 25 spärrad). Vi verifierar via format + MX + domänägarskap + "hittad ordagrant på publicerad sida".

## Del 2 — Databasschema (migration)

- `contact_people`: nya kolumner `email_type` (personal/role) och `email_status` (verified/unverified).
- Ny tabell `domain_mx_cache` (host, has_mx, checked_at) så DNS-slagningar inte upprepas.

## Del 3 — Städning av all befintlig data (ny edge-funktion `audit-contacts`)

Körs på alla jobb en gång nu, och därefter automatiskt före varje export ("sista kontrollen"):

- De 10 604 fabricerade namnraderna raderas; adressen (som är äkta och publicerad) flyttas till namnlös företagskontakt med källa-URL — enligt ditt val "behåll utan namn".
- De 185 gissade kopplingarna: `email` sätts till tomt, personen behålls (namn/roll är äkta).
- Alla kvarvarande adresser (inkl. "extracted") valideras: format + MX + domän-match. Underkända rensas bort.
- Sätt `email_type` + `email_status` på allt: belagd adress med MX+domän ok → confidence 0.9, "verified". Namnlös publicerad → 0.5, "unverified" (under 0,7-gränsen).
- Funktionen returnerar en rapport: hittade rader, verifierade personadresser, rollbaserade, utan adress, borttagna.

## Del 4 — Nytt exportkontrakt (`exporters.ts` + exportdialog)

CSV-kolumner exakt enligt din spec: `company, website, full_name, first_name, last_name, role, email, email_type, email_status, email_confidence, email_source`.

- Tomma värden = helt tomma strängar. Aldrig "N/A", "-", "okänd".
- Dedupe på lowercase-adress i exporten.
- Exportflödet kör städning/verifiering först och visar rapporten innan filen laddas ner.
- Samma kontrakt gäller zip-massexporten från Jobs-sidan.

## Del 5 — UI och outreach-skydd

- Nya badges i People-vyerna: "Roll-adress" / "Overifierad" ersätter "matchad"/"svag match".
- `send-to-outreach`: skickar bara verifierade personadresser och rolladresser — aldrig overifierade personadresser.

## Del 6 — Permanent regel

Sparar "aldrig fabricera kontakter/mejl, tomma fält före gissningar" + exportkontraktet i projektminnet så regeln gäller all framtidig utveckling.

## Tekniska detaljer

- Filer: `supabase/functions/scrape-emails/index.ts`, ny `supabase/functions/audit-contacts/index.ts`, `src/lib/exporters.ts`, `src/components/app/PeopleExportOptionsDialog.tsx`, `src/components/jobDetail/JobPeopleTab.tsx`, `src/pages/People.tsx`, `supabase/functions/send-to-outreach/index.ts`, ny migration.
- Edge-funktioner deployas om (`scrape-emails`, `send-to-outreach`, ny `audit-contacts`).
- Verifiering: kör städningen, kontrollräkna i databasen (0 rader kvar med gissnings-märkning), testexportera CSV och kontrollera kolumner + rapport, kör ett litet testjobb med nya pipelinen.
- Ej ingår: om-skrapning av drabbade bolag med nya pipelinen (kostar credits) — kan göras efteråt per jobb om du vill.
