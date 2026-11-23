-- ── Meal planner: week balance settings ──────────────────────────────────────
-- Minimum vegetarian dinners a week, and the most times any one meat can appear.
alter table public.meal_planner_settings
  add column if not exists veg_dinners_per_week integer not null default 2 check (veg_dinners_per_week between 0 and 7),
  add column if not exists max_same_protein     integer not null default 2 check (max_same_protein between 1 and 7);
