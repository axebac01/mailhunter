ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS created_by_job_id uuid;
CREATE INDEX IF NOT EXISTS idx_companies_created_by_job_id ON public.companies(created_by_job_id);