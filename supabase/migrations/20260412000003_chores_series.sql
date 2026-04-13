-- Group recurring chore instances into a series so they can be edited/deleted together.
ALTER TABLE public.chores
  ADD COLUMN IF NOT EXISTS recur_series_id uuid;

-- Index for fast "all chores in this series" lookups
CREATE INDEX IF NOT EXISTS idx_chores_recur_series ON public.chores (recur_series_id)
  WHERE recur_series_id IS NOT NULL;
