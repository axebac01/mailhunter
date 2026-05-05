
## Vad vi vet nu

Tre MySQL-dumpar i `~/Downloads/SCB_2.0/Företagsdata/`:

| Fil | Tabell | Rader | Storlek |
|---|---|---|---|
| grunduppgifter.sql | grunduppgifter | ~1,2 M | 498 MB |
| bokslutsuppgifter.sql | bokslutsuppgifter | ~3,96 M (flera år/bolag) | 1,75 GB |
| styrelse.sql | styrelse | ~2,54 M | 268 MB |

UTF-8 (utf8mb4). Alla kopplas via `OrgNr`. Filerna är för stora för browseruppladdning — vi kör konvertering + import på din maskin via skript jag genererar, sen `\copy` mot Lovable Cloud.

## Kolumnmappning (klar)

**grunduppgifter → `se_companies`:**

| MySQL-kolumn | Postgres-kolumn |
|---|---|
| `OrgNr` | `org_nr` (PK) |
| `Företagsnamn` | `name` |
| `Postadress` | `street_address` |
| `Postnummer` | `postal_code` |
| `Postort` | `postal_city` |
| `Telefon` | `phone` |
| `Huvud SNI-kod` | `sni_code` |
| `Huvud SNI-text` | `sni_text` |
| `Kommun besöksadress` | `municipality` |
| `Län besöksadress` | `county` |
| `Bolagsordning_Korrekt` | `description` |
| Allt övrigt (Bolagsform, F-skatt, Omsättningsintervall, Moder, Koncernmoder, etc.) | `raw` jsonb |

`website` och `email` finns INTE i dumpen — de hittas senare via crawl-jobben.

**bokslutsuppgifter → uppdaterar `se_companies` (senaste året per OrgNr):**

| MySQL-kolumn | Postgres-kolumn |
|---|---|
| `Nettoomsättning` (fallback `OMSETTNING`), delas med 1000 | `revenue_ksek` |
| `Antal anställda` | `employees` |
| `Bokslutsperiodens slut` (första 4 tecken) | `fiscal_year` |

Vi tar bara raden med högst `Bokslutsperiodens slut` per `OrgNr` (där `Slutkod='B'`).

**styrelse → ny tabell `se_board_members`** (för "kontaktpersoner" senare):

```text
org_nr text, name text, role text, person_nr text,
appointed_at date, raw jsonb, id bigserial PK
+ index på org_nr och name
```

## Import-pipeline (engångsjobb)

```text
[din Mac]                                    [Lovable Cloud / Postgres]
  *.sql (MySQL dump)
    └─ Python-skript: parsa INSERT-statements
        └─ skriv 3 CSV-filer:
            se_companies_base.csv  (från grunduppgifter)
            se_bokslut_latest.csv  (senaste året per OrgNr)
            se_board.csv           (från styrelse)
              └─ psql \copy direkt till databasen
                  └─ SQL-merge: uppdatera se_companies med bokslutsdata
```

Skriptet kör i strömmande läge — läser dumpfilerna rad för rad, behöver aldrig ladda hela 1,75 GB i minnet. För bokslutsuppgifter görs en första pass där vi sparar bara senaste året per OrgNr (i en dict på OrgNr → senaste rad).

Estimerad tid: ~5–10 min konvertering + ~10–20 min `\copy` över wifi.

## Vad jag bygger när du godkänner

**1. Migration: lägg till `se_board_members`-tabell** + index på `se_companies(name)` för bättre namnsökning.

**2. Skript du kör lokalt:**
- `scripts/convert_dumps.py` — parsar MySQL-dumparna → 3 CSV-filer i `/tmp/`. Beroenden: bara Python 3 standard library.
- `scripts/import_to_cloud.sh` — kör `psql \copy` mot Lovable Cloud med din connection-string. Inkluderar också MERGE-steget som joinar bokslut → se_companies.
- `scripts/README.md` — exakt vad du klistrar in i terminalen, steg för steg.

**3. UI-uppdatering:**
- `Omsättningsintervall`-filter (text-intervall finns på i princip alla bolag, även små som inte lämnar bokslut) som komplement till exakt `revenue_ksek`.
- Visa antal styrelseledamöter i listan, klickbart till en dialog med namn/funktion.
- "Importera till Companies" tar med styrelseledamöter som `contact_people` direkt (sparar ett crawl-steg för bolag där styrelsenamn räcker).

**4. Edge function-uppdatering:** `import-se-companies` skapar även `contact_people`-rader från `se_board_members` för valda bolag.

## Vad som krävs av dig

1. Godkänn planen.
2. Sen får du en connection-string + 3 terminalkommandon att klistra in (`python3 convert_dumps.py`, sen `bash import_to_cloud.sh`). Jag guidar dig.
3. Vänta ~20 min medan importen kör. Sen ligger 1,2 M svenska bolag sökbara på `/se-companies`.

## Out of scope

- Synk vid ny dump — blir `TRUNCATE` + re-import via samma skript.
- Historiska bokslut (flera år per bolag) — vi tar bara senaste. Kan läggas till senare i egen tabell `se_bokslut_history` om du vill se trender.
- Personnummer från styrelse-dumpen importeras till `se_board_members.person_nr` men exponeras INTE i UI (GDPR — visa bara namn + funktion).
