-- Add weather location to app_settings (defaults to Singapore)
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS weather_location text    NOT NULL DEFAULT 'Singapore',
  ADD COLUMN IF NOT EXISTS weather_lat      float8  NOT NULL DEFAULT 1.3521,
  ADD COLUMN IF NOT EXISTS weather_lon      float8  NOT NULL DEFAULT 103.8198;

-- Ensure existing rows have the defaults
UPDATE public.app_settings
SET weather_location = 'Singapore', weather_lat = 1.3521, weather_lon = 103.8198
WHERE weather_location IS NULL OR weather_location = '';
