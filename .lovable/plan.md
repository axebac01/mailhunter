## Fix: Visa omsättning korrekt på SE Bolagsregister

`revenue_ksek` lagras i tkr men visas som rå siffra, vilket gör belopp ser 1000x mindre ut än de är.

### Ändringar i `src/pages/SeCompanies.tsx`

1. **Smart formatter för omsättning**
   - `≥ 1 000` tkr → visa som Mkr med 1 decimal (sv-SE), t.ex. `5,0 Mkr`
   - `< 1 000` tkr → visa som tkr, t.ex. `450 tkr`
   - `null` → `—`

2. **Tabellkolumn**
   - Header: "Omsättning" (enheten visas i värdet)
   - Cell använder den nya formattern

3. **Filterfält**
   - Behåll inmatning i tkr (matchar databasen)
   - Tydligare labels: "Oms. min (tkr)" / "Oms. max (tkr)" med hjälptext: "1 000 tkr = 1 Mkr"

Inga DB- eller schemaändringar. Endast presentationsfix.