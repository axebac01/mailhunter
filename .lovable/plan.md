## Problem

Alla anrop mot `se_companies` returnerar `57014: canceling statement due to statement timeout`:
- `se_sni_options()` gör `GROUP BY sni_code` över 877 726 rader → SNI-dropdownen visar "Ingen träff".
- Listan sorterar `ORDER BY revenue_ksek DESC` utan index → tabellen är tom/spinner.

Datan finns alltså på riktigt (~878k bolag), men frågorna är för tunga utan stöd från index/cache.

## Lösning

### 1. Lookup-tabell för SNI-koder (löser dropdownen)

Skapa en liten tabell `se_sni_codes(sni_code, sni_text, company_count)` som är en cachad sammanställning. ~800 rader istället för 878k vid varje render.

```sql
create table public.se_sni_codes (
  sni_code text primary key,
  sni_text text,
  company_count bigint not null default 0
);
alter table public.se_sni_codes enable row level security;
create policy "public_read_se_sni_codes" on public.se_sni_codes for select using (true);
```

Fyll den engångs:
```sql
insert into public.se_sni_codes (sni_code, sni_text, company_count)
select sni_code, max(sni_text), count(*)::bigint
from public.se_companies
where sni_code is not null
group by sni_code;
```
(Körs som migration; ~800 rader, ska gå snabbt även på 878k.)

Skriv om `se_sni_options()` att läsa från `se_sni_codes` istället. Frontend behöver inte ändras.

Lägg också till en `refresh_se_sni_codes()`-funktion som kan köras av `ingest_se_companies` framöver (eller manuellt efter import).

### 2. Index för tabellistan och filter (löser den tomma tabellen)

```sql
create index if not exists idx_se_companies_revenue_desc
  on public.se_companies (revenue_ksek desc nulls last);

create index if not exists idx_se_companies_sni_code
  on public.se_companies (sni_code text_pattern_ops);

create index if not exists idx_se_companies_county
  on public.se_companies (lower(county));

create index if not exists idx_se_companies_municipality
  on public.se_companies (lower(municipality));

create index if not exists idx_se_companies_name_trgm
  on public.se_companies using gin (name gin_trgm_ops);
```

`pg_trgm` finns redan (extension är installerad enligt funktionslistan), så `ilike '%...%'` på namn kan använda GIN-indexet.

### 3. Inga frontend-ändringar krävs

`SeCompanies.tsx` förblir oförändrad. När indexen finns och `se_sni_options()` läser från lookup-tabellen kommer både dropdown och listan att svara på <100ms istället för att timeouta.

## Tekniska noter

- Migrationen körs i en transaktion. `CREATE INDEX` utan `CONCURRENTLY` blockerar tabellen kort, vilket är ok eftersom den bara läses från SE Bolagsregister-sidan.
- GIN-indexet på `name` tar några sekunder att bygga på 878k rader men är värt det.
- Om vi senare importerar fler bolag kör vi `select refresh_se_sni_codes()` så att counten uppdateras.