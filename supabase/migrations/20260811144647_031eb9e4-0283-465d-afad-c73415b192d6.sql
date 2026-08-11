CREATE OR REPLACE FUNCTION public.job_domain_stats(job_id uuid)
RETURNS TABLE(total bigint, resolved bigint, unresolved bigint, failed bigint, no_domain_found bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ids AS (
    SELECT DISTINCT r.matched_company_id AS id
    FROM public.import_rows r
    JOIN public.imports i ON i.id = r.import_id
    WHERE i.crawl_job_id = job_domain_stats.job_id
      AND r.matched_company_id IS NOT NULL
    UNION
    SELECT c.id FROM public.companies c WHERE c.created_by_job_id = job_domain_stats.job_id
  )
  SELECT
    count(*)::bigint,
    count(*) FILTER (WHERE c.domain IS NOT NULL)::bigint,
    count(*) FILTER (WHERE c.domain IS NULL AND (c.domain_status = 'unresolved' OR c.domain_status IS NULL))::bigint,
    count(*) FILTER (WHERE c.domain IS NULL AND c.domain_status = 'failed')::bigint,
    count(*) FILTER (WHERE c.domain IS NULL AND c.domain_status = 'no_domain_found')::bigint
  FROM public.companies c
  JOIN ids ON ids.id = c.id;
$$;

GRANT EXECUTE ON FUNCTION public.job_domain_stats(uuid) TO anon, authenticated, service_role;