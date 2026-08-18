ALTER TABLE public.crawl_jobs
  ADD COLUMN target_roles text[],
  ADD COLUMN one_person_per_company boolean NOT NULL DEFAULT false;