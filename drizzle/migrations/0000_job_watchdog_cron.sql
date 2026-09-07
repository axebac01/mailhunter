-- lovable-cron-fallback-reviewed: 720 runs/day; scraper worker chains die from edge timeouts/crashes with no event to hook onto, so a short-interval liveness check is the only way to keep long jobs running without the browser tab open.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $$
BEGIN
  PERFORM cron.unschedule('job-watchdog');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'job-watchdog',
  '*/2 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://yinahywakjfgqoswqbgm.supabase.co/functions/v1/job-watchdog',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  )
  WHERE EXISTS (SELECT 1 FROM public.crawl_jobs WHERE status = 'running');
  $$
);