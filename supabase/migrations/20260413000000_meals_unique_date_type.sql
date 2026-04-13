-- Required for upsert(onConflict: "date,meal_type") in the meal editor
ALTER TABLE public.meals
  ADD CONSTRAINT meals_date_meal_type_unique UNIQUE (date, meal_type);
