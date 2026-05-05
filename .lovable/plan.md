## Mål

Lägg till en "Skicka till Outreach"-integration så markerade rader på Companies/Contacts/People/ImportDetail kan skickas som leads till en annan Lovable-app. Ingen auth införs nu — API-nyckeln ligger som Supabase secret, övriga inställningar i en singleton-rad.

## Arkitektur

```text
UI (bulk-select)
  └─> Dialog (target override + preview)
        └─> supabase.functions.invoke("send-to-outreach", { ids, source_table, target })
              ├─> läser outreach_settings (singleton) för endpoint + default target
              ├─> läser OUTREACH_API_KEY från Deno.env
              ├─> hämtar rader + joinar companies
              ├─> mappar till outreach lead-format
              ├─> POST batchat (max 500) till endpoint
              └─> loggar i outreach_send_log, returnerar { inserted, skipped, errors }
```

Ingen befintlig data rörs. Endast nya tabeller och en ny edge function läggs till.

## Databasändringar (migration)

1. **`outreach_settings`** — singleton (en rad)
   - `id` uuid PK default gen_random_uuid()
   - `endpoint_url` text
   - `default_target_type` text check in ('sequence','campaign','none') default 'none'
   - `default_target_id` text
   - `updated_at` timestamptz default now()
   - RLS: public read/update/insert (matchar resten av appen tills auth införs)

2. **`outreach_send_log`**
   - `id` uuid PK
   - `source_table` text
   - `count` int
   - `inserted` int, `skipped` int, `errors` int
   - `target_type` text, `target_id` text
   - `response_summary` jsonb
   - `created_at` timestamptz default now()
   - RLS: public read/insert

3. **Secret**: `OUTREACH_API_KEY` (begärs via add_secret innan edge function deployas).

## Settings-sida — ny "Outreach"-sektion

I `src/pages/Settings.tsx` läggs en `SectionCard "Outreach integration"` till med:
- `endpoint_url` (input)
- `default_target_type` (select: sequence / campaign / none)
- `default_target_id` (input, dold när type=none)
- "Spara"-knapp → upsert i `outreach_settings`
- "Testa anslutning"-knapp → anropar `send-to-outreach` med `{ ids: [], source_table: 'companies', target: { type: 'none' } }`. Edge function gör då bara en ping-POST `{ source, target, leads: [] }` och returnerar status. Toast visar OK/fel.
- Liten hjälptext: "API-nyckeln lagras säkert som Supabase secret (OUTREACH_API_KEY)."

## Edge function `supabase/functions/send-to-outreach/index.ts`

- CORS + OPTIONS-hantering
- Validerar input med zod: `{ ids: string[], source_table: 'companies'|'contacts'|'contact_people', target?: { type, id? } }`
- Ingen JWT-validering (eftersom appen inte har auth än) — men kräver att anrop kommer via supabase.functions.invoke (anon key)
- Läser `outreach_settings` (limit 1) för endpoint + default target. Override med inkommande target om givet.
- Läser `OUTREACH_API_KEY` från env. Om saknas → 400 med tydligt fel.
- Hämtar rader baserat på `source_table`:
  - **contacts**: `select id, value, contact_type, source_url, company_id, companies(name, website, domain)` där `id in ids` och `contact_type='generic_email'`. Mappa till lead `{ email, company, website, notes }`.
  - **contact_people**: `select id, full_name, role_title, source_url, company_id, companies(name, website, domain)` där `id in ids`. Mappa till `{ full_name, first_name, last_name, role, company, website }` (split-name samma logik som exporters.ts).
  - **companies**: för varje company-id, hämta första `contacts.value` där `contact_type='generic_email'`. Skippa bolag utan email om target.type !== 'none'. Mappa till `{ email, company, website }`.
- Batcha leads i chunks om 500 och POST:a till endpoint:
  ```
  POST {endpoint_url}
  Authorization: Bearer {OUTREACH_API_KEY}
  Content-Type: application/json
  { "source": "company-intel-hub", "target": {...}, "leads": [...] }
  ```
- Aggregerar svar → `{ inserted, skipped, errors: string[] }`. Loggar rad i `outreach_send_log`.
- Empty `ids` (test-pingen) → POST:ar `leads: []` och returnerar svaret som "test OK".

## UI bulk-action

Ny komponent `src/components/outreach/SendToOutreachDialog.tsx`:
- Props: `open, onOpenChange, ids: string[], sourceTable: 'companies'|'contacts'|'contact_people'`
- Hämtar `outreach_settings` för default target
- Fält: target type select + target id input (förfyllt med default)
- Visar "X leads kommer skickas"
- "Skicka"-knapp → `supabase.functions.invoke('send-to-outreach', ...)`, toast med resultat

Knapp "Skicka till Outreach" läggs till på:

1. **`src/pages/Contacts.tsx`** — bredvid ExportButton, aktiveras när `t.selected.size > 0`. Skickar `t.selected` med `source_table: 'contacts'`.
2. **`src/pages/People.tsx`** — samma mönster, `source_table: 'contact_people'`.
3. **`src/pages/Companies.tsx`** — kräver lite utökning: idag finns ingen rad-checkbox. Vi lägger till checkbox-kolumn + selection-state (samma mönster som Contacts), och knappen aktiveras när urval finns. `source_table: 'companies'`.
4. **`src/pages/ImportDetail.tsx`** — knapp som skickar alla matchade companies från importen (`source_table: 'companies'`, ids = matched_company_id där status='matched'). Enklast utan rad-selection eftersom det är en kontextuell vy.

## Filer som skapas

- `supabase/functions/send-to-outreach/index.ts`
- `src/components/outreach/SendToOutreachDialog.tsx`
- `src/components/outreach/OutreachSettingsCard.tsx` (används från Settings)

## Filer som ändras

- `src/pages/Settings.tsx` — render `<OutreachSettingsCard />`
- `src/pages/Contacts.tsx` — bulk-knapp
- `src/pages/People.tsx` — bulk-knapp
- `src/pages/Companies.tsx` — checkbox-kolumn + bulk-knapp
- `src/pages/ImportDetail.tsx` — knapp för matchade companies

## Ordning vid implementation

1. Migration (skapa två tabeller).
2. Begär `OUTREACH_API_KEY` via add_secret. **Stoppa** tills den är satt.
3. Bygg edge function.
4. Bygg `OutreachSettingsCard` + lägg in i Settings.
5. Bygg `SendToOutreachDialog` + koppla in på de fyra sidorna.

## Out of scope

- Auth / per-user settings (skjuts till senare).
- pgp_sym_encrypt (onödigt när nyckeln ligger som secret).
- Linkedin/phone-mappning utöver det som faktiskt finns i DB (inga sådana kolumner finns idag — fälten skickas tomma).

## Klart när

- Settings visar Outreach-sektion, "Testa anslutning" returnerar OK/fel.
- Bulk-knappen finns på Companies, Contacts, People, ImportDetail.
- En lyckad send loggas i `outreach_send_log` och toast visar `{ inserted, skipped }`.
- Ingen befintlig data har påverkats.