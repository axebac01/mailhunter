ALTER TABLE public.crawl_jobs ADD COLUMN include_person_emails boolean NOT NULL DEFAULT false;
ALTER TYPE public.contact_type ADD VALUE IF NOT EXISTS 'person_email';