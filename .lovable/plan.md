## Varför siffran fastnar på 500

KPI-korten (`CONTACTS 732` / `PEOPLE 616`) läses från `crawl_jobs.contacts_found` / `people_found` och är korrekta totalsummor.

Tabbarna (`Contacts (500)` / `People (500)`) visar däremot **antalet rader som hämtats till klienten**, inte totalen. I `src/lib/api.ts`:

```
const MAX_PAGE = 500;
// listContacts / listPeople:
const limit = Math.min(opts.limit ?? 2000, MAX_PAGE);
```

PostgREST returnerar högst `MAX_PAGE` rader per anrop, och JobDetail gör bara ett anrop utan paginering. Så oavsett hur många kontakter jobbet har får UI:t alltid max 500.

## Fix

Låt `listContacts` / `listPeople` paginera internt när anroparen inte anger `limit` / `offset`, och slå ihop resultaten. Hämta i chunks om 500 rader (`range(offset, offset+499)`) tills en chunk är kortare än 500 eller en trygg hård gräns (`FETCH_ALL_MAX = 10_000`) nås.

Beteende:

- `listContacts({ jobId })` / `listPeople({ jobId })` — hämtar alla rader upp till 10 000.
- `listContacts({ jobId, limit, offset })` — oförändrat (för framtida paginerade sidor).
- Övriga anropssidor (`/contacts`, `/people`) fortsätter fungera; om de skickar `limit` respekteras det, annars hämtar de också allt.

Om totalen någon gång når 10 000 rader visar tabben `10000+` istället för `10000` så det syns att listan är trunkerad.

## Filer som ändras

- `src/lib/api.ts` — utöka `listContacts` och `listPeople` med intern paginering.
- `src/components/jobDetail/JobContactsTab.tsx`, `JobPeopleTab.tsx` (eller där tabbrubriken renderas) — visa `10000+` när gränsen nåtts.

Inga DB-, edge- eller schemaändringar.
