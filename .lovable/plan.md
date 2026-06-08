## Vad som händer

Filen `Redovisningskonsulter - Insynia.xlsx` har **6 315 rader i en enda kolumn** (`Företagsnamn`). Inget land, ingen domän, ingen website.

Importpipelinen (`src/lib/importPipeline.ts`) gör så här:

1. Parsar filen klart → vet totalt 6 315 rader → skapar `imports`-rad → emit `"matching", 0, 6315`
2. Delar i batchar om **2 000 rader** (`BATCH_SIZE`)
3. För varje batch: matcha mot DB → infoga nya företag → infoga `import_rows`
4. **Först när hela batchen är klar** uppdateras `processed_rows` och `onProgress` triggas.

För den här filen är det extra långsamt eftersom **varje rad går på "name-only"-vägen** (ingen domän att slå upp), vilket betyder för varje batch om 2 000:
- 4 sekventiella `companies`-SELECT (chunkade 500 åt gången, namn-uppslag utan land-filter)
- Upp till 2 000 `companies` INSERT (4 parallella chunkar à 500)
- 2 000 `import_rows` INSERT (4 parallella chunkar à 500)

Det är ~12 round-trips per batch, varje med 500–2 000 rader, och under tiden står UI:t på **"0 / 6315"** utan rörelse. Användaren tolkar det som att den hänger. Övriga CRMdata-filer (mindre, ofta en enda batch) klarar sig precis och första uppdateringen kommer som ett "hopp" från 0 → klart, så ingen reagerar. Med 6 315 rader = 4 batchar tar första uppdateringen för lång tid.

Sekundärt: namn-uppslaget gör 2 queries (`in country` + `is null country`) bara när `countriesInBatch.size > 0`. Här är `defaultCountry` tomt i CreateJob → ingen `country` per rad → vi tar `else`-grenen som ändå är OK, så det är inte huvudorsaken.

## Vad jag ändrar

Enbart `src/lib/importPipeline.ts` (frontend, ingen schema-ändring):

1. **Mindre batchar för buffrade filer (CSV/XLSX) med fler rader**: sänk effektiv `BATCH_SIZE` till 500 när total är känd och > 1 000. Det ger ~13 framstegs-uppdateringar för den här filen istället för 4.
2. **Intra-batch progress**: anropa `onProgress` på tre punkter inuti `processBatch` — efter matchning, efter företags-insert, efter `import_rows`-insert — som "fraktionellt" framsteg (t.ex. +33%, +66%, +100% av batchens rader). UI:t rör sig då även mitt i en stor batch.
3. **Tidig "saving"-emit i `runImport`**: direkt efter `createImport` emit:a `("saving", 0, total)` istället för `"matching", 0, total`, så användaren ser samma faspraktiker som senare batchar (kosmetik, valfritt).
4. **Console-logga** start och slut på varje batch på `console.debug` så vi i framtida felsökning kan se exakt var det stannar.

Inga ändringar i edge functions, ingen DB-migration, inga UI-komponenter.

## Resultat

För `Redovisningskonsulter - Insynia.xlsx`:
- Användaren ser räknaren börja röra sig inom ~3–5 sek (efter första lookup) istället för att vänta ~30+ sek på första helbatchen.
- Total importtid oförändrad (samma mängd jobb, bara mindre batchar).
- Övriga uppladdningar påverkas inte märkbart (små filer hamnar i en enda batch som tidigare).

## Vad jag INTE ändrar

- Ingen auto-mappnings­logik (fallback "första kolumnen = namn" finns redan och har triggats korrekt här).
- Ingen ändring i edge function `resolve-domains-batch` — den körs som fire-and-forget efter import, opåverkad.
- Ingen ändring av bulk-sidan `/bulk-crmdata` (den här filen kom inte därifrån).
