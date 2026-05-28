ALTER TABLE public.contact_people ADD COLUMN IF NOT EXISTS is_decision_maker boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_contact_people_decision_maker ON public.contact_people (is_decision_maker) WHERE is_decision_maker = true;
ALTER TABLE public.crawl_jobs ADD COLUMN IF NOT EXISTS firecrawl_calls integer NOT NULL DEFAULT 0;