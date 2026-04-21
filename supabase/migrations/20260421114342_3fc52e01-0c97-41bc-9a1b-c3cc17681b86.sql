create table public.domain_blocklist (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  host text not null,
  reason text,
  created_at timestamptz not null default now(),
  unique (company_id, host)
);
create index idx_domain_blocklist_company on public.domain_blocklist(company_id);
create index idx_domain_blocklist_host on public.domain_blocklist(host);

alter table public.domain_blocklist enable row level security;

create policy "public_read_domain_blocklist"
  on public.domain_blocklist for select using (true);

create policy "public_insert_domain_blocklist"
  on public.domain_blocklist for insert with check (true);

create policy "public_delete_domain_blocklist"
  on public.domain_blocklist for delete using (true);