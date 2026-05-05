## Bakgrund

Lovable Cloud exponerar inte en `psql`-anslutningssträng utåt — det finns ingen "Connect"-knapp eftersom backend är abstraherad. Vi byter därför strategi: importen görs via en HTTP-edge-function som redan finns i projektet (`supabase/functions/import-se-companies`), och Codex (på din Mac) postar CSV-rader i batchar dit.

## Vad jag gör i build-mode

### 1. Verifiera/uppdatera edge function `import-se-companies`
- Kontrollera att den accepterar tre olika "kind"-värden: `companies`, `bokslut`, `board`
- Den tar emot JSON `{ kind, rows: [...] }` med upp till ~1000 rader per request
- Använder `SUPABASE_SERVICE_ROLE_KEY` för att göra `upsert` mot rätt tabell
- Returnerar `{ inserted, errors }`
- Sätt `verify_jwt = false` i `supabase/config.toml` för denna funktion (så Codex kan posta utan auth-token, bara med anon key)

### 2. Säkerställ tabellschema
Granska migration `20260505123106_*.sql` så att `se_companies`, `se_bokslut_latest`, `se_board_members` har:
- Rätt unika constraints för upsert (orgnr, eller orgnr+period för bokslut, orgnr+person för board)
- Index på `omsattning` och `orgnr`
- RLS: läsning publik (eller authenticated), skrivning bara via service role

### 3. Skriv ett nytt importskript `scripts/import_via_edge.py`
Ersätter `import_to_cloud.sh`. Det:
- Läser de tre CSV-filerna i `/tmp/` (eller path som arg)
- Postar i batchar om 500 rader till `https://yinahywakjfgqoswqbgm.supabase.co/functions/v1/import-se-companies`
- Headers: `Authorization: Bearer <ANON_KEY>` + `apikey: <ANON_KEY>` + `Content-Type: application/json`
- Visar progress (rader/sek, ETA) och retry vid 5xx
- Skriver slutstatistik

### 4. Uppdatera `SeCompanies.tsx`-sidan
- Filter på omsättning (min/max)
- Visa styrelseledamöter per bolag (join på orgnr)
- Paginering över ~1,2M rader

### 5. Skapa Codex-prompt
En färdig prompt du kopierar till Codex på din Mac. Den behöver bara:
- Sökväg till de tre CSV:erna
- Anon-key (redan känd, finns i system-prompten)

Inget databaslösenord, ingen `psql`, inget pooler-krångel.

## Tekniska detaljer

**Endpoint:** `POST https://yinahywakjfgqoswqbgm.supabase.co/functions/v1/import-se-companies`

**Payload-exempel:**
```json
{ "kind": "companies", "rows": [{ "orgnr": "5560000000", "namn": "...", "omsattning": 1234, ... }] }
```

**Genomströmning:** 500 rader × ~3 batchar/sek ≈ 1500 rader/sek
- companies: 1,2M rader → ~13 min
- bokslut: 688k → ~8 min
- board: 2,5M → ~28 min
- **Totalt ~50 min** (mot ~15 min för `\copy`, men utan anslutningstrubbel)

**Säkerhet:** Edge function är publik (`verify_jwt = false`) men använder service role internt. För att förhindra missbruk lägger vi till en delad hemlighet: Codex skickar header `x-import-token: <SECRET>` och funktionen verifierar mot en secret `SE_IMPORT_TOKEN`. Jag ber dig sätta den via `add_secret` när vi byter mode.

## Vad du behöver göra efteråt

1. Godkänn planen → jag implementerar
2. Sätt secret `SE_IMPORT_TOKEN` (jag triggar dialogen)
3. Kopiera Codex-prompten jag genererar och kör den lokalt
4. När den är klar säger du till — jag verifierar antalet rader via `read_query`
