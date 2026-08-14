# Jobbnamn på exportfiler + massexport från Jobs-sidan

## Mål

1. Exporten från ett jobbs detaljsida ska heta som jobbet (t.ex. `CRMdata - Fintech.csv`) istället för `job_results_2026-08-14.csv`.
2. På sidan **Jobs** ska man kunna markera flera jobb med checkboxar och exportera alla samtidigt. Resultatet laddas ner som en zip-fil som packas upp till en mapp med en fil per jobb, döpta efter jobbens namn.

## Ändringar

### 1. Filnamn baserat på jobbnamn (`src/lib/exporters.ts`)

- `exportJobResults()` tar ett nytt argument `jobName` och bygger filnamnet från det: `<jobbnamn>.csv` / `.xlsx`.
- Ny hjälpfunktion `sanitizeFileName()` som ersätter tecken som är olagliga i filnamn (`: / \ ? % * | " < >`) med `-`, så `CRMdata: Fintech` blir `CRMdata - Fintech.csv`.
- `src/pages/JobDetail.tsx` skickar med jobbets namn vid export.

### 2. Markering av jobb på Jobs-sidan (`src/pages/Jobs.tsx`)

- Ny checkbox-kolumn längst till vänster i jobbtabellen (per rad + "markera alla filtrerade" i tabellhuvudet), samma mönster som på Contacts/People-sidorna.
- Checkboxklick ska inte trigga radens navigering till jobbdetaljen.

### 3. Massexport till zip (`src/pages/Jobs.tsx` + `src/lib/exporters.ts`)

- När minst ett jobb är markerat visas en exportknapp (dropdown: CSV eller XLSX) i filterkortet, med texten t.ex. "Exportera valda (3)".
- Vid export:
  - För varje markerat jobb hämtas jobbets kontakter via `api.listContacts({ jobId })` (samma data som dagens jobbexport, inkl. person-mejl).
  - Varje jobb blir en fil i zip:en döpt till `<jobbnamn>.csv` / `.xlsx`. Dubblettnamn får suffix `(2)`, `(3)` osv.
  - Zip-filen heter `jobs_export_<datum>.zip` och laddas ner direkt i webbläsaren.
  - Toast visar framdrift under exporten ("Exporterar jobb 2 av 5…") och en sammanfattning när den är klar.
  - En rad loggas i exports-tabellen per jobb (som idag), så exportstatistiken fortsätter stämma.
- Jobb utan kontakter får ändå en fil (med dagens "inga rader"-notering) så att mappen alltid speglar exakt de valda jobben.

### 4. Nytt beroende

- Installerar `fflate` (litet zip-bibliotek, ~8 kB) för att bygga zip-filen i webbläsaren. Ingen backend ändras.

## Tekniska detaljer

- `fflate`s `zipSync({ "fil.csv": bytes })` ger en Uint8Array som laddas ner via befintlig `triggerDownload()`-helper (utökad med valfri MIME/ändelse).
- CSV genereras med befintligt `xlsx`-paket (`sheet_to_csv`), XLSX via `XLSX.write(..., { type: "array" })` — exakt samma innehåll och kolumner (`projectContactRow`) som dagens export.
- Markeringen är en `Set<string>` av jobb-id:n i lokal state; "markera alla" tar alla **filtrerade** jobb (respekterar sök/status/filter).
- Ingen databas- eller edge-funktionsändring behövs.
