-- Add google_origin flag and updated_at timestamp to events.
-- google_origin: true when the event was created in Google Calendar (not in the app).
-- updated_at: auto-updated on every change, used for conflict resolution during sync.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS google_origin boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at    timestamptz NOT NULL DEFAULT now();

-- Auto-update updated_at on every row change
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS events_set_updated_at ON public.events;
CREATE TRIGGER events_set_updated_at
  BEFORE UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Index to speed up conflict-resolution comparisons during sync
CREATE INDEX IF NOT EXISTS idx_events_google_event_id ON public.events (google_event_id)
  WHERE google_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_updated_at ON public.events (updated_at);
