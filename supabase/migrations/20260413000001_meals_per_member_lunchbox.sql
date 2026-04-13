-- Replace for_members (jsonb array) with a single for_member_id column
-- so each child can have their own lunchbox entry per day.
ALTER TABLE public.meals
  DROP COLUMN IF EXISTS for_members,
  ADD COLUMN IF NOT EXISTS for_member_id text;

-- Drop the old (date, meal_type) unique constraint
ALTER TABLE public.meals
  DROP CONSTRAINT IF EXISTS meals_date_meal_type_unique;

-- New unique index: one entry per (date, meal_type, member).
-- Dinner rows have NULL for_member_id which coalesces to '' so they are unique per day too.
CREATE UNIQUE INDEX IF NOT EXISTS meals_date_type_member_unique
  ON public.meals (date, meal_type, COALESCE(for_member_id, ''));
