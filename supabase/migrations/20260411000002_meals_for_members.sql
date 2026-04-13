-- Add for_members (jsonb array of family_member ids) to meals
ALTER TABLE public.meals
  ADD COLUMN IF NOT EXISTS for_members jsonb DEFAULT NULL;

-- Add is_child flag to family_members so we can filter the lunchbox "For:" field
ALTER TABLE public.family_members
  ADD COLUMN IF NOT EXISTS is_child boolean NOT NULL DEFAULT false;

-- Mark the two child placeholder rows as children
UPDATE public.family_members
SET is_child = true
WHERE name IN ('Child 1', 'Child 2');
