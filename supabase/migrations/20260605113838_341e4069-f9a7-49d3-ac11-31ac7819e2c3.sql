
CREATE OR REPLACE FUNCTION public.increment_firecrawl_calls(job_id uuid, delta int)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.crawl_jobs
     SET firecrawl_calls = COALESCE(firecrawl_calls, 0) + delta
   WHERE id = job_id;
$$;

GRANT EXECUTE ON FUNCTION public.increment_firecrawl_calls(uuid, int) TO service_role, authenticated;
