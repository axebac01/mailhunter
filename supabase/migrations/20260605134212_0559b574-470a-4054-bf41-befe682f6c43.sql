ALTER TABLE public.contact_people
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS email_confidence text CHECK (email_confidence IN ('extracted','matched_high','matched_low')),
  ADD COLUMN IF NOT EXISTS phone text;

CREATE INDEX IF NOT EXISTS idx_contact_people_email
  ON public.contact_people (company_id, lower(email))
  WHERE email IS NOT NULL;