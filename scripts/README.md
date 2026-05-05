# Importera Bolagsverket-dumpen till Lovable Cloud

Engångsjobb som tar dina tre MySQL-dumpar och laddar in ~1,2 miljoner svenska bolag i din databas.

## 1. Kontrollera att du har psql

```bash
psql --version
```

Om kommandot inte finns:
```bash
brew install libpq
brew link --force libpq
```

## 2. Hämta connection-string

I Lovable: **Cloud → Connect → Connection string** (välj **URI**, **Session pooler**). 
Den ser ut såhär: `postgresql://postgres.xxxxx:LÖSENORD@aws-0-eu-north-1.pooler.supabase.com:5432/postgres`

Sätt den som env-variabel:
```bash
export SUPABASE_DB_URL="postgresql://postgres.xxxxx:LÖSENORD@aws-0-eu-north-1.pooler.supabase.com:5432/postgres"
```

## 3. Konvertera MySQL-dumparna till CSV (~5–10 min)

```bash
cd /sökväg/till/projektet
python3 scripts/convert_dumps.py /Users/axel/Downloads/SCB_2.0/Företagsdata
```

Detta läser de tre `.sql`-filerna och skriver tre CSV-filer till `/tmp/se_import/`. Inga npm/pip-paket behövs — bara Python 3.

## 4. Importera till Cloud (~10–20 min)

```bash
bash scripts/import_to_cloud.sh
```

Skriptet:
1. Tömmer eventuell tidigare data i `se_companies` + `se_board_members`
2. Laddar grunduppgifter (1,2 M rader)
3. Joinar in bokslutsdata (omsättning + antal anställda)
4. Laddar styrelseledamöter (2,5 M rader)
5. Skriver ut statistik

## 5. Klart

Öppna `/se-companies` i appen. Filtrera på SNI/län/kommun/omsättning, markera bolag, klicka "Importera till Companies" → kör crawl-jobben som vanligt.

## Felsökning

**`psql: connection refused`** — Använd Session pooler, inte Direct connection. Connection-stringen ska innehålla `pooler.supabase.com`.

**`ERROR: invalid byte sequence`** — Dumpen kan vara skadad i någon rad. Kör om `convert_dumps.py` — den hoppar tysta över skräp.

**Vill köra om från scratch** — Kör bara `bash scripts/import_to_cloud.sh` igen, den gör TRUNCATE först.
