-- Enable realtime for core tables that were missing from the publication.
-- Later migrations already added birthdays, plants, chore_streaks, member_weekly_plants.

alter publication supabase_realtime add table public.events;
alter publication supabase_realtime add table public.chores;
alter publication supabase_realtime add table public.meals;
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.shopping_lists;
alter publication supabase_realtime add table public.shopping_items;
alter publication supabase_realtime add table public.family_members;
