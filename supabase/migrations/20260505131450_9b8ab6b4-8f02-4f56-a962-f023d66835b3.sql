
-- Unique index på board för idempotent insert
CREATE UNIQUE INDEX IF NOT EXISTS ux_se_board_org_name_role
  ON public.se_board_members (org_nr, name, COALESCE(role, ''));

-- 1. Upsert grunduppgifter
CREATE OR REPLACE FUNCTION public.ingest_se_companies(p jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  INSERT INTO public.se_companies (
    org_nr, name, street_address, postal_code, postal_city, phone,
    sni_code, sni_text, municipality, county, description, revenue_interval, raw
  )
  SELECT
    org_nr, COALESCE(name, '(okänt)'), street_address, postal_code, postal_city, phone,
    sni_code, sni_text, municipality, county, description, revenue_interval,
    NULLIF(raw, 'null'::jsonb)
  FROM jsonb_to_recordset(p) AS x(
    org_nr text, name text, street_address text, postal_code text, postal_city text,
    phone text, sni_code text, sni_text text, municipality text, county text,
    description text, revenue_interval text, raw jsonb
  )
  ON CONFLICT (org_nr) DO UPDATE SET
    name = EXCLUDED.name,
    street_address = EXCLUDED.street_address,
    postal_code = EXCLUDED.postal_code,
    postal_city = EXCLUDED.postal_city,
    phone = EXCLUDED.phone,
    sni_code = EXCLUDED.sni_code,
    sni_text = EXCLUDED.sni_text,
    municipality = EXCLUDED.municipality,
    county = EXCLUDED.county,
    description = EXCLUDED.description,
    revenue_interval = EXCLUDED.revenue_interval,
    raw = EXCLUDED.raw,
    imported_at = now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- 2. Update bokslut (lämna övriga fält orörda)
CREATE OR REPLACE FUNCTION public.ingest_se_bokslut(p jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  UPDATE public.se_companies c
  SET revenue_ksek = x.revenue_ksek,
      employees = x.employees,
      fiscal_year = x.fiscal_year
  FROM jsonb_to_recordset(p) AS x(
    org_nr text, revenue_ksek bigint, employees integer, fiscal_year integer
  )
  WHERE c.org_nr = x.org_nr;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- 3. Insert styrelse (idempotent via unique index)
CREATE OR REPLACE FUNCTION public.ingest_se_board(p jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  INSERT INTO public.se_board_members (org_nr, name, role, person_nr, appointed_at)
  SELECT org_nr, name, role, person_nr,
         CASE WHEN appointed_at = '' THEN NULL ELSE appointed_at::date END
  FROM jsonb_to_recordset(p) AS x(
    org_nr text, name text, role text, person_nr text, appointed_at text
  )
  WHERE org_nr IS NOT NULL AND name IS NOT NULL
  ON CONFLICT (org_nr, name, COALESCE(role, '')) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
