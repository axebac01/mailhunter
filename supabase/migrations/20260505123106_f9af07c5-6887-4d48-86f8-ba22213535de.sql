
ALTER TABLE public.se_companies ADD COLUMN IF NOT EXISTS revenue_interval text;

CREATE INDEX IF NOT EXISTS ix_se_companies_name_trgm ON public.se_companies USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS ix_se_companies_postal_city ON public.se_companies (postal_city);
CREATE INDEX IF NOT EXISTS ix_se_companies_postal_code ON public.se_companies (postal_code);
CREATE INDEX IF NOT EXISTS ix_se_companies_sni_code ON public.se_companies (sni_code);
CREATE INDEX IF NOT EXISTS ix_se_companies_county ON public.se_companies (county);
CREATE INDEX IF NOT EXISTS ix_se_companies_municipality ON public.se_companies (municipality);
CREATE INDEX IF NOT EXISTS ix_se_companies_revenue_ksek ON public.se_companies (revenue_ksek);
CREATE INDEX IF NOT EXISTS ix_se_companies_employees ON public.se_companies (employees);

CREATE TABLE IF NOT EXISTS public.se_board_members (
  id bigserial PRIMARY KEY,
  org_nr text NOT NULL,
  name text NOT NULL,
  role text,
  person_nr text,
  appointed_at date,
  raw jsonb,
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_se_board_org_nr ON public.se_board_members (org_nr);
CREATE INDEX IF NOT EXISTS ix_se_board_name ON public.se_board_members (name);

ALTER TABLE public.se_board_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read_se_board_members" ON public.se_board_members FOR SELECT USING (true);
