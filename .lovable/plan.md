## Vad som behöver göras

Koden är redan klar och matchar `import-leads`-funktionen i MailLead Pro (samma payload-format, Bearer-auth, target `sequence|campaign|none`, tom `leads`-array = connection test). Det som saknas är bara konfiguration.

## Steg

1. **Skapa API-nyckel i MailLead Pro**
   - Öppna MailLead Pro → Settings → Integrations (eller motsv.) och generera en API-nyckel.
   - Kopiera klartext-nyckeln (den hashas server-side i `integration_api_keys`, så den visas bara en gång).

2. **Lagra nyckeln som secret i denna app**
   - `OUTREACH_API_KEY` finns redan som secret. Om du behöver byta värde: använd update_secret. Annars hoppa över.

3. **Spara endpoint i Settings → Outreach**
   - Endpoint URL: `https://xnhxokvtcuwfyxaulaxc.supabase.co/functions/v1/import-leads`
   - Default target type: `none` (då hamnar leads i en auto-skapad sekvens "Imported leads" hos MailLead Pro), eller välj `sequence`/`campaign` med ID från MailLead Pro.
   - Klicka **Spara**.

4. **Testa anslutning**
   - Klicka **Testa anslutning** → ska ge "Anslutning OK ✔" (skickar `leads: []` → MailLead Pro svarar `{ ok: true, message: "Connection OK" }`).

## Inga kodändringar

Fältmappningen stämmer redan med vad MailLead Pro accepterar. Inga edits behövs i edge function eller UI-komponenter.
