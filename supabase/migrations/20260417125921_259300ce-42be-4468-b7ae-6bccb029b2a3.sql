ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS domain_status text NOT NULL DEFAULT 'unresolved';
CREATE INDEX IF NOT EXISTS idx_companies_domain_status ON public.companies(domain_status);