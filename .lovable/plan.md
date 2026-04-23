

## Mål

Dela upp namnfältet i exporterade fil­er så att varje rad innehåller `first_name`, `last_name` **och** `full_name` istället för bara `full_name`.

## Omfattning

Endast personexporten (Persons-sidan, samt eventuella jobbexporter som innehåller personer). Kontakter (emails/telefon) påverkas inte – de saknar namn.

## Ändringar

### `src/lib/exporters.ts`

1. Lägg till en liten hjälpare:
   ```ts
   function splitName(full: string): { first: string; last: string } {
     const parts = full.trim().split(/\s+/);
     if (parts.length === 0 || parts[0] === "") return { first: "", last: "" };
     if (parts.length === 1) return { first: parts[0], last: "" };
     return { first: parts[0], last: parts.slice(1).join(" ") };
   }
   ```
   - Ett ord → bara `first_name`.
   - Två+ ord → första ordet = förnamn, resten = efternamn (hanterar mellannamn/dubbla efternamn rimligt, t.ex. "Anna Maria Svensson" → first="Anna", last="Maria Svensson").

2. Uppdatera `PEOPLE_EXPORT_FIELDS` så att kolumnordningen blir:
   ```
   company_name, website, domain, country, industry,
   first_name, last_name, full_name,
   role_title, department, source_url, found_at,
   job_name, import_status
   ```

3. Uppdatera `projectPersonRow(p)` så att den returnerar:
   ```ts
   const { first, last } = splitName(p.fullName);
   return {
     ...,
     first_name: first,
     last_name: last,
     full_name: p.fullName,
     ...
   };
   ```

Inga andra filer behöver ändras – `exportPeople` använder redan `projectPersonRow`, och CSV/XLSX-genereringen plockar kolumnerna automatiskt från objektet.

## Edge cases

- Tomt/null-namn: båda fälten blir tomma strängar, `full_name` blir `""`.
- Ett enda ord ("Madonna"): `first_name="Madonna"`, `last_name=""`.
- Extra mellanslag normaliseras via `split(/\s+/)`.

## Inte i scope

- Att lagra `first_name`/`last_name` i databasen (`contact_people` har bara `full_name`). Splitten görs vid export.
- Kontakt-exporten (emails) – inga namn finns där.

## Klart när

- En nedladdad people-CSV/XLSX innehåller kolumnerna `first_name`, `last_name`, `full_name` i den ordningen, korrekt ifyllda för alla rader.
- Inga andra exportkolumner ändras.

