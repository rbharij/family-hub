-- Required for upsert conflict resolution in the Google Calendar sync.
-- PostgreSQL allows multiple NULLs in a UNIQUE column, so manually-created
-- events (where google_event_id IS NULL) are unaffected.
ALTER TABLE public.events
  ADD CONSTRAINT events_google_event_id_unique UNIQUE (google_event_id);
