ALTER TABLE public.crawl_jobs REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.crawl_jobs;