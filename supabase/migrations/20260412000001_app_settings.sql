-- App-wide settings: family name, first-run flag, theme hours
CREATE TABLE IF NOT EXISTS public.app_settings (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  family_name    text        NOT NULL DEFAULT 'Family Hub',
  setup_complete boolean     NOT NULL DEFAULT false,
  dark_from_hour integer     NOT NULL DEFAULT 19,
  light_from_hour integer    NOT NULL DEFAULT 7,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow all on app_settings" ON public.app_settings
  FOR ALL USING (true) WITH CHECK (true);

-- Seed one row (idempotent)
INSERT INTO public.app_settings (family_name, setup_complete, dark_from_hour, light_from_hour)
VALUES ('Family Hub', false, 19, 7);
