CREATE OR REPLACE FUNCTION public.se_sni_options()
RETURNS TABLE(sni_code text, sni_text text, company_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT sni_code, MAX(sni_text) AS sni_text, COUNT(*)::bigint AS company_count
  FROM public.se_companies
  WHERE sni_code IS NOT NULL
  GROUP BY sni_code
  ORDER BY sni_code;
$$;
GRANT EXECUTE ON FUNCTION public.se_sni_options() TO anon, authenticated;