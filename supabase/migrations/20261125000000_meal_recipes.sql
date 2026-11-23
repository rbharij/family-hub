-- ── Recipes on the Meals page ────────────────────────────────────────────────
-- Stores each meal's full recipe (ingredients, method, timings) so the Meals
-- page can show how to make it. Filled from the meal plan on confirm, or
-- written on demand the first time a meal is opened.
alter table public.meals
  add column if not exists recipe jsonb;
