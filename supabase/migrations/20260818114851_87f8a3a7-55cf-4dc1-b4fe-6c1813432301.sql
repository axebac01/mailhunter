ALTER TABLE public.contact_people ADD COLUMN IF NOT EXISTS email_type text;
ALTER TABLE public.contact_people ADD COLUMN IF NOT EXISTS email_status text;

CREATE TABLE IF NOT EXISTS public.domain_mx_cache (
  host text PRIMARY KEY,
  has_mx boolean NOT NULL DEFAULT false,
  checked_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.domain_mx_cache TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.domain_mx_cache TO authenticated;
GRANT ALL ON public.domain_mx_cache TO service_role;
ALTER TABLE public.domain_mx_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read_domain_mx_cache" ON public.domain_mx_cache FOR SELECT TO public USING (true);
CREATE POLICY "public_insert_domain_mx_cache" ON public.domain_mx_cache FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "public_update_domain_mx_cache" ON public.domain_mx_cache FOR UPDATE TO public USING (true) WITH CHECK (true);
CREATE POLICY "public_delete_domain_mx_cache" ON public.domain_mx_cache FOR DELETE TO public USING (true);