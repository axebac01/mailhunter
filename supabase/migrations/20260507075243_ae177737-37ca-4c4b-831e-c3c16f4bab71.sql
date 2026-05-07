
CREATE OR REPLACE FUNCTION public.refresh_se_sni_codes()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM public.se_sni_codes;
  INSERT INTO public.se_sni_codes (sni_code, sni_text, company_count)
  SELECT sni_code, MAX(sni_text), COUNT(*)::bigint
  FROM public.se_companies
  WHERE sni_code IS NOT NULL
  GROUP BY sni_code;
END $$;

CREATE OR REPLACE FUNCTION public.se_sni_options()
RETURNS TABLE(sni_code text, sni_text text, company_count bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT sni_code, sni_text, company_count
  FROM public.se_sni_codes
  ORDER BY sni_code;
$$;
