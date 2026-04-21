do $$
begin
  alter publication supabase_realtime add table public.crawl_logs;
exception when duplicate_object then null;
end $$;

alter table public.crawl_logs replica identity full;