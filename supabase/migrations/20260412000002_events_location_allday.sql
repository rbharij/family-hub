-- Add location and all-day flag to events
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS location   text,
  ADD COLUMN IF NOT EXISTS is_all_day boolean NOT NULL DEFAULT false;
