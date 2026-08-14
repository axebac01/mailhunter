# Exportera kontaktpersoner från jobb (namn, roll, mejl)

## Problem

Jobbexporterna (både enkel export på jobbdetaljsidan och massexport-zipen från Jobs-sidan) hämtar bara rader från `contacts`-tabellen — alltså företagets generella mejladresser, telefonnummer och kontaktformulär. Kontaktpersonerna (`contact_people`: namn, roll/befattning, personmejl, telefon) ingår aldrig i jobbexporten. De syns bara under fliken "People" och på People-sidan.

## Lösning

Låt användaren välja vad som ska exporteras varje gång: **Kontaktpersoner** (högst prioritet, listas först), **Företagskontakter**, eller **Båda**.

## Ändringar

### 1. Ny exportmeny med val av datatyp (`src/components/app/JobExportMenu.tsx`)

Ny dropdown-komponent som används på både jobbdetaljsidan och Jobs-sidan. Alternativ:

- **People (kontaktpersoner)** — CSV / XLSX
- **Company contacts** (generella mejl/telefon/formulär) — CSV / XLSX
- **Both** — CSV / XLSX (levereras som zip med två filer per jobb)

`ExportButton` som används på Contacts/People/Companies/Imports-sidorna rörs inte.

### 2. Exportlogik (`src/lib/exporters.ts`)

- Ny typ `JobExportDataset = "people" | "contacts" | "both"`.
- **Enkel jobbexport** (`exportJobResults` byggs ut): tar emot både kontakter och personer + valt dataset.
  - `people` → filen `<jobbnamn>.csv/.xlsx` innehåller personrader (samma kolumner som People-exporten idag: company_name, website, domain, country, industry, first_name, last_name, full_name, role_title, department, email, email_confidence, phone, source_url, found_at, job_name, import_status).
  - `contacts` → som idag.
  - `both` → en zip `<jobbnamn>.zip` med `<jobbnamn> - people.csv` och `<jobbnamn> - contacts.csv`.
- **Massexport** (`exportJobsZip`): tar dataset-parameter. Per markerat jobb hämtas `api.listPeople({ jobId })` och/eller `api.listContacts({ jobId })` beroende på val. Vid `both` får varje jobb två filer i zipen med suffixen `- people` / `- contacts`.
- `exports`-tabellen loggas per fil med rätt typ (`people` respektive `job_results`), så exportstatistiken fortsätter stämma.
- Jobb utan rader får ändå en fil (med "No rows to export"-notering), som idag.

### 3. Jobbdetaljsidan (`src/pages/JobDetail.tsx`)

- Byter `ExportButton` mot nya `JobExportMenu`.
- Persondatan finns redan hämtad (`jobPeople`), kontakterna likaså — ingen ny datahämtning behövs.

### 4. Jobs-sidan (`src/pages/Jobs.tsx`)

- Dropdownen "Export selected (N)" får samma tre val (People / Contacts / Both) × CSV/XLSX.
- Framdrifts-toasten fungerar som idag.

## Tekniska detaljer

- `api.listPeople({ jobId })` stödjer redan jobbfilter och paginerar upp till 10 000 rader — samma täckning som kontakthämtningen.
- Personraderna projiceras med befintliga `projectPersonRow()` (delar upp namn i first/last, mappar email_confidence m.m.).
- Ingen databas- eller edge-funktionsändring behövs. Inget nytt beroende (`fflate` finns redan).
- UI-texterna blir på engelska (People / Company contacts / Both) för att matcha resten av appen.
