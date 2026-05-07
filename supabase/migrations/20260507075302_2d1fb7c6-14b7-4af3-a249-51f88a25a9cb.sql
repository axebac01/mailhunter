
CREATE INDEX IF NOT EXISTS idx_se_companies_sni_code ON public.se_companies (sni_code text_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_se_companies_county_lower ON public.se_companies (lower(county));
CREATE INDEX IF NOT EXISTS idx_se_companies_municipality_lower ON public.se_companies (lower(municipality));
