## Mål
På SE Bolagsregister: gör så att checkbox-headern öppnar en meny med valbara markeringslägen istället för att bara markera den aktuella sidan.

## Ny UX
Headerns checkbox blir en dropdown (DropdownMenu) med valen:
1. **Markera denna sida (50)** — nuvarande beteende
2. **Markera alla i träffen (N)** — laddar alla org_nr som matchar filtren och lägger i `selected`
3. **Markera ett antal…** — öppnar en liten dialog/popover med number input ("Hur många?"), markerar de N första enligt nuvarande sortering
4. **Avmarkera alla** — visas om något är valt

Klick direkt på checkbox-ikonen togglar fortfarande hela sidan (snabbväg). Pilen bredvid öppnar menyn.

## Teknisk implementation (`src/pages/SeCompanies.tsx`)

- Lägg till hjälpfunktion `fetchOrgNrs(limit?: number)` som kör samma filter-query mot `se_companies` men `select("org_nr")` och `order` som idag, med `range(0, limit-1)` om limit anges, annars hämtar alla. Supabase cap är 1000/request → loopa i batchar om 1000 tills `total` nås (eller önskat limit).
- Visa en `Loader2` spinner i header-cellen medan hämtningen pågår och disabla menyn.
- Använd `DropdownMenu` (finns redan i `components/ui/dropdown-menu.tsx`) i header-cellen. Layout: liten checkbox + chevron-knapp som triggrar menyn.
- "Markera ett antal" — använd en enkel inline `Popover` med `Input type=number` + bekräfta-knapp (max = `total`).
- Toast som bekräftar t.ex. "Markerade 3 421 bolag".
- Om träffen är väldigt stor (t.ex. > 50 000) visa toast-warning men tillåt ändå.

Ingen DB-ändring behövs — allt går via existerande filter-query.
