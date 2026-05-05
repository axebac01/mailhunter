CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE public.se_companies (
  org_nr text PRIMARY KEY,
  name text NOT NULL,
  sni_code text,
  sni_text text,
  revenue_ksek bigint,
  employees int,
  county text,
  municipality text,
  postal_code text,
  postal_city text,
  street_address text,
  website text,
  email text,
  phone text,
  description text,
  fiscal_year int,
  raw jsonb,
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_se_companies_sni ON public.se_companies (sni_code);
CREATE INDEX idx_se_companies_county ON public.se_companies (county);
CREATE INDEX idx_se_companies_municipality ON public.se_companies (municipality);
CREATE INDEX idx_se_companies_revenue ON public.se_companies (revenue_ksek);
CREATE INDEX idx_se_companies_employees ON public.se_companies (employees);
CREATE INDEX idx_se_companies_name_trgm ON public.se_companies USING gin (name gin_trgm_ops);

ALTER TABLE public.se_companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read_se_companies"
  ON public.se_companies FOR SELECT
  USING (true);