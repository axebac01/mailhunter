
CREATE TABLE public.outreach_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_url text,
  default_target_type text NOT NULL DEFAULT 'none' CHECK (default_target_type IN ('sequence','campaign','none')),
  default_target_id text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.outreach_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read_outreach_settings" ON public.outreach_settings FOR SELECT USING (true);
CREATE POLICY "public_insert_outreach_settings" ON public.outreach_settings FOR INSERT WITH CHECK (true);
CREATE POLICY "public_update_outreach_settings" ON public.outreach_settings FOR UPDATE USING (true) WITH CHECK (true);

CREATE TRIGGER outreach_settings_touch BEFORE UPDATE ON public.outreach_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.outreach_send_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table text NOT NULL,
  count int NOT NULL DEFAULT 0,
  inserted int NOT NULL DEFAULT 0,
  skipped int NOT NULL DEFAULT 0,
  errors int NOT NULL DEFAULT 0,
  target_type text,
  target_id text,
  response_summary jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.outreach_send_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read_outreach_send_log" ON public.outreach_send_log FOR SELECT USING (true);
CREATE POLICY "public_insert_outreach_send_log" ON public.outreach_send_log FOR INSERT WITH CHECK (true);
