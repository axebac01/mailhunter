
-- ============ ENUMS ============
CREATE TYPE public.job_status AS ENUM ('draft','scheduled','running','paused','completed','failed','stopped');
CREATE TYPE public.import_status AS ENUM ('pending','matched','partial_match','not_found','duplicate','failed','processing','completed');
CREATE TYPE public.contact_type AS ENUM ('generic_email','phone','contact_form');
CREATE TYPE public.crawl_log_level AS ENUM ('info','warn','error','success');
CREATE TYPE public.source_type AS ENUM ('industry_country','uploaded','manual');
CREATE TYPE public.export_type AS ENUM ('contacts','people','job_results','import_results');
CREATE TYPE public.file_format AS ENUM ('csv','xlsx');
CREATE TYPE public.page_type AS ENUM ('homepage','contact','about','team','people','other');
CREATE TYPE public.weekday AS ENUM ('mon','tue','wed','thu','fri','sat','sun');

-- ============ updated_at trigger fn ============
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- ============ companies ============
CREATE TABLE public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  website text,
  domain text UNIQUE,
  country text,
  industry text,
  source_url text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_companies_country ON public.companies(country);
CREATE INDEX idx_companies_industry ON public.companies(industry);
CREATE TRIGGER trg_companies_updated BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ crawl_jobs ============
CREATE TABLE public.crawl_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  industry text,
  country text,
  max_companies integer NOT NULL DEFAULT 100 CHECK (max_companies > 0),
  allowed_start_time time NOT NULL DEFAULT '09:00',
  allowed_end_time time NOT NULL DEFAULT '18:00',
  allowed_days public.weekday[] NOT NULL DEFAULT ARRAY['mon','tue','wed','thu','fri']::public.weekday[],
  include_generic_emails boolean NOT NULL DEFAULT true,
  include_phones boolean NOT NULL DEFAULT true,
  include_contact_forms boolean NOT NULL DEFAULT true,
  include_contact_person_names boolean NOT NULL DEFAULT true,
  include_contact_person_roles boolean NOT NULL DEFAULT true,
  include_departments boolean NOT NULL DEFAULT true,
  deduplicate boolean NOT NULL DEFAULT true,
  notes text,
  status public.job_status NOT NULL DEFAULT 'draft',
  source_type public.source_type NOT NULL DEFAULT 'industry_country',
  progress integer NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  companies_found integer NOT NULL DEFAULT 0,
  contacts_found integer NOT NULL DEFAULT 0,
  people_found integer NOT NULL DEFAULT 0,
  pages_crawled integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_run_at timestamptz,
  CHECK (allowed_end_time > allowed_start_time)
);
CREATE INDEX idx_crawl_jobs_status ON public.crawl_jobs(status);
CREATE INDEX idx_crawl_jobs_created ON public.crawl_jobs(created_at DESC);
CREATE TRIGGER trg_crawl_jobs_updated BEFORE UPDATE ON public.crawl_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ imports ============
CREATE TABLE public.imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name text NOT NULL,
  file_type text NOT NULL,
  status public.import_status NOT NULL DEFAULT 'pending',
  total_rows integer NOT NULL DEFAULT 0,
  processed_rows integer NOT NULL DEFAULT 0,
  matched_rows integer NOT NULL DEFAULT 0,
  failed_rows integer NOT NULL DEFAULT 0,
  contacts_found integer NOT NULL DEFAULT 0,
  people_found integer NOT NULL DEFAULT 0,
  crawl_job_id uuid REFERENCES public.crawl_jobs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_imports_created ON public.imports(created_at DESC);
CREATE TRIGGER trg_imports_updated BEFORE UPDATE ON public.imports
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ import_rows ============
CREATE TABLE public.import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES public.imports(id) ON DELETE CASCADE,
  company_name text NOT NULL,
  country text,
  website text,
  industry text,
  notes text,
  matched_company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  matched_domain text,
  status public.import_status NOT NULL DEFAULT 'pending',
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_import_rows_import ON public.import_rows(import_id);
CREATE INDEX idx_import_rows_status ON public.import_rows(status);
CREATE TRIGGER trg_import_rows_updated BEFORE UPDATE ON public.import_rows
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ contacts ============
-- Block person-tied emails (firstname.lastname@, firstname_lastname@, firstnamelastname patterns are
-- impossible to detect perfectly; we forbid the most common "first.last@" form).
CREATE TABLE public.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  crawl_job_id uuid REFERENCES public.crawl_jobs(id) ON DELETE SET NULL,
  import_id uuid REFERENCES public.imports(id) ON DELETE SET NULL,
  import_row_id uuid REFERENCES public.import_rows(id) ON DELETE SET NULL,
  contact_type public.contact_type NOT NULL,
  value text NOT NULL,
  source_url text NOT NULL,
  is_publicly_listed boolean NOT NULL DEFAULT true,
  found_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contacts_no_personal_email CHECK (
    contact_type <> 'generic_email'
    OR value !~* '^[a-z]+[._-][a-z]+@'
  ),
  CONSTRAINT contacts_unique_per_company UNIQUE (company_id, contact_type, value)
);
CREATE INDEX idx_contacts_company ON public.contacts(company_id);
CREATE INDEX idx_contacts_job ON public.contacts(crawl_job_id);
CREATE INDEX idx_contacts_import ON public.contacts(import_id);
CREATE INDEX idx_contacts_found_at ON public.contacts(found_at DESC);

-- ============ contact_people ============
CREATE TABLE public.contact_people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  crawl_job_id uuid REFERENCES public.crawl_jobs(id) ON DELETE SET NULL,
  import_id uuid REFERENCES public.imports(id) ON DELETE SET NULL,
  import_row_id uuid REFERENCES public.import_rows(id) ON DELETE SET NULL,
  full_name text NOT NULL,
  role_title text,
  department text,
  source_url text NOT NULL,
  found_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_people_unique ON public.contact_people(
  company_id, full_name, COALESCE(role_title,''), COALESCE(department,'')
);
CREATE INDEX idx_people_company ON public.contact_people(company_id);
CREATE INDEX idx_people_job ON public.contact_people(crawl_job_id);
CREATE INDEX idx_people_found_at ON public.contact_people(found_at DESC);

-- ============ crawl_logs ============
CREATE TABLE public.crawl_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  crawl_job_id uuid NOT NULL REFERENCES public.crawl_jobs(id) ON DELETE CASCADE,
  level public.crawl_log_level NOT NULL DEFAULT 'info',
  message text NOT NULL,
  meta_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_logs_job ON public.crawl_logs(crawl_job_id, created_at DESC);

-- ============ source_pages ============
CREATE TABLE public.source_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  crawl_job_id uuid REFERENCES public.crawl_jobs(id) ON DELETE SET NULL,
  url text NOT NULL,
  page_type public.page_type NOT NULL DEFAULT 'other',
  crawled_at timestamptz NOT NULL DEFAULT now(),
  status_code integer,
  extracted_summary text
);
CREATE INDEX idx_source_pages_company ON public.source_pages(company_id);
CREATE INDEX idx_source_pages_job ON public.source_pages(crawl_job_id);

-- ============ exports ============
CREATE TABLE public.exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  export_type public.export_type NOT NULL,
  file_format public.file_format NOT NULL,
  file_name text NOT NULL,
  row_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_exports_created ON public.exports(created_at DESC);

-- ============ RLS — internal MVP, no auth ============
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crawl_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crawl_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exports ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['companies','crawl_jobs','imports','import_rows','contacts','contact_people','crawl_logs','source_pages','exports'])
  LOOP
    EXECUTE format('CREATE POLICY "public_read_%1$s" ON public.%1$I FOR SELECT USING (true);', t);
    EXECUTE format('CREATE POLICY "public_insert_%1$s" ON public.%1$I FOR INSERT WITH CHECK (true);', t);
    EXECUTE format('CREATE POLICY "public_update_%1$s" ON public.%1$I FOR UPDATE USING (true) WITH CHECK (true);', t);
    EXECUTE format('CREATE POLICY "public_delete_%1$s" ON public.%1$I FOR DELETE USING (true);', t);
  END LOOP;
END $$;

-- ============ Reseed RPC ============
CREATE OR REPLACE FUNCTION public.clear_all_data()
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  DELETE FROM public.crawl_logs;
  DELETE FROM public.source_pages;
  DELETE FROM public.contacts;
  DELETE FROM public.contact_people;
  DELETE FROM public.import_rows;
  DELETE FROM public.imports;
  DELETE FROM public.exports;
  DELETE FROM public.crawl_jobs;
  DELETE FROM public.companies;
END; $$;
