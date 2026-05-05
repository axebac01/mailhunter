#!/usr/bin/env bash
# Importerar de tre CSV-filerna från /tmp/se_import till Lovable Cloud / Postgres.
#
# Krav:
#   - psql installerat (brew install libpq && brew link --force libpq)
#   - Miljövariabel SUPABASE_DB_URL satt, t.ex.:
#       export SUPABASE_DB_URL="postgresql://postgres.<ref>:<password>@aws-0-eu-north-1.pooler.supabase.com:5432/postgres"
#
# Hämta connection-string i Lovable: Cloud → Connect → "Connection string" (URI, session pooler).

set -euo pipefail

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "FEL: sätt SUPABASE_DB_URL först. Se kommentar i denna fil."
  exit 1
fi

CSV_DIR="/tmp/se_import"
for f in se_companies_base.csv se_bokslut_latest.csv se_board.csv; do
  if [[ ! -f "$CSV_DIR/$f" ]]; then
    echo "FEL: $CSV_DIR/$f saknas. Kör python3 scripts/convert_dumps.py först."
    exit 1
  fi
done

echo "==> 1/4: Tömmer befintliga se_companies + se_board_members"
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
TRUNCATE public.se_companies;
TRUNCATE public.se_board_members RESTART IDENTITY;
SQL

echo "==> 2/4: Importerar grunduppgifter (~1.2 M rader, ca 5–10 min)"
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -c "\copy public.se_companies (org_nr,name,street_address,postal_code,postal_city,phone,sni_code,sni_text,municipality,county,description,revenue_interval,raw) FROM '$CSV_DIR/se_companies_base.csv' WITH (FORMAT csv, HEADER true)"

echo "==> 3/4: Importerar bokslutsdata (temp-tabell + UPDATE)"
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 <<SQL
CREATE TEMP TABLE _bok (org_nr text, revenue_ksek bigint, employees int, fiscal_year int);
\copy _bok FROM '$CSV_DIR/se_bokslut_latest.csv' WITH (FORMAT csv, HEADER true, NULL '')
UPDATE public.se_companies sc
SET revenue_ksek = b.revenue_ksek,
    employees = b.employees,
    fiscal_year = b.fiscal_year
FROM _bok b WHERE sc.org_nr = b.org_nr;
SQL

echo "==> 4/4: Importerar styrelse (~2.5 M rader)"
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -c "\copy public.se_board_members (org_nr,name,role,person_nr,appointed_at) FROM '$CSV_DIR/se_board.csv' WITH (FORMAT csv, HEADER true, NULL '')"

echo "==> Statistik:"
psql "$SUPABASE_DB_URL" -c "SELECT (SELECT count(*) FROM se_companies) AS bolag, (SELECT count(*) FROM se_companies WHERE revenue_ksek IS NOT NULL) AS med_oms, (SELECT count(*) FROM se_board_members) AS styrelseledamoter;"

echo ""
echo "KLART! Gå till /se-companies i appen och börja söka."
