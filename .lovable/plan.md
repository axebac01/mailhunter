# Bulk-skapa 10 CRMdata-jobb från uppladdade xlsx-filer

## Vad som ska byggas

En **engångs-sida** `/bulk-crmdata` med en knapp "Skapa alla jobb". När du klickar går den igenom de 10 xlsx-filerna i sekvens och kör samma flöde som `CreateJob`-sidan idag:

1. Parsa filen (samma `parseFile` + `autoMap` som vanligt — kolumnen `Företagsnamn` mappas automatiskt till `company_name`).
2. Kör `runImport` (matchar mot `companies`-tabellen + skapar bolag som saknas).
3. Skapar `crawl_job` med:
   - **name**: `CRMdata: <originalnamn utan .xlsx>` (med åäö, mellanslag, &, kommatecken bevarade)
   - **status**: `draft`
   - **source_type**: `uploaded`
   - **max_companies**: antalet matchade rader (ingen cap)
   - **allowed_days**: mån–fre, **start**: 09:00, **end**: 18:00 (samma defaults som UI:t)
   - **include_generic_emails**: ✅
   - **include_person_emails**: ✅
   - **include_phones**: ✅
   - **include_contact_forms**: ❌ (enda undantaget)
   - **include_contact_person_names**: ✅
   - **include_contact_person_roles**: ✅
   - **include_departments**: ✅
   - **deduplicate**: ✅
4. Kopplar importen till jobbet (`api.updateImport(importId, { crawl_job_id })`) och triggar `resolve-domains-batch` i bakgrunden — exakt som vanliga flödet.

Progress visas live per fil ("3/10 · Larm, Säkerhet & Bevakning · 398 rader matchade").

## Jobbnamn (exakt)

| Fil | Jobbnamn | Rader |
|---|---|---|
| IT-konsulter.xlsx | CRMdata: IT-konsulter | 2 504 |
| IT-säkerhet.xlsx | CRMdata: IT-säkerhet | 63 |
| Larm, Säkerhet & Bevakning.xlsx | CRMdata: Larm, Säkerhet & Bevakning | 398 |
| Ledarskapsutveckling.xlsx | CRMdata: Ledarskapsutveckling | 70 |
| Lyft, Gods & Materialhantering.xlsx | CRMdata: Lyft, Gods & Materialhantering | 295 |
| Mät, Styr & Reglerteknik.xlsx | CRMdata: Mät, Styr & Reglerteknik | 593 |
| Organisationskonsulter.xlsx | CRMdata: Organisationskonsulter | 5 280 |
| PR-byråer.xlsx | CRMdata: PR-byråer | 58 |
| Profil & Reklam - leverantörer.xlsx | CRMdata: Profil & Reklam - leverantörer | 78 |
| Profil & Reklam - återförsäljare.xlsx | CRMdata: Profil & Reklam - återförsäljare | 271 |

Totalt ~9 600 företag fördelade på 10 draft-jobb.

## Tekniska detaljer

- **Filerna bundlas** som lovable-assets pointers under `src/assets/crmdata-bulk/` (skapas via `lovable-assets create` från `/mnt/user-uploads/`). Sidan fetchar varje fil via dess CDN-URL och skickar in i `parseFile`.
- **Ny route**: `/bulk-crmdata` registreras i `src/App.tsx`. Sidan är intern — inte länkad från sidopanelen.
- **Återanvänder** `parseFile`, `autoMap`, `runImport`, `api.createJob`, `api.updateImport` — ingen ändring i pipeline-koden.
- **Inget databasschema ändras.** Inga edge functions ändras.
- **Sekventiellt** (en fil i taget) för att inte överbelasta `resolve-domains-batch`. Stora filer (IT-konsulter 2 504, Organisationskonsulter 5 280) tar några minuter var att importera/matcha.
- Efter att alla 10 jobb är skapade kan rutten/sidan tas bort i ett separat steg om du vill.

## Filer som skapas/ändras

- `src/pages/BulkCreateCrmdata.tsx` (ny)
- `src/App.tsx` (lägg till route)
- `src/assets/crmdata-bulk/*.asset.json` (10 nya pointers)
