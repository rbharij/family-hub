-- ── Tables ──────────────────────────────────────────────────────────────────────

create table public.plants (
  id               uuid primary key default gen_random_uuid(),
  name             text not null unique,
  emoji            text,
  category         text not null check (category in ('vegetable','fruit','herb','spice','nut','seed','legume','grain','other')),
  first_eaten_date date,
  times_eaten      integer not null default 0,
  created_at       timestamptz not null default now()
);

create table public.weekly_plants (
  id         uuid primary key default gen_random_uuid(),
  plant_id   uuid not null references public.plants(id) on delete cascade,
  week_start date not null,
  added_by   text not null default 'manual',
  meal_id    uuid references public.meals(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(plant_id, week_start)
);

alter table public.plants        enable row level security;
alter table public.weekly_plants enable row level security;
create policy "Allow all" on public.plants        for all using (true) with check (true);
create policy "Allow all" on public.weekly_plants for all using (true) with check (true);
alter publication supabase_realtime add table public.plants;
alter publication supabase_realtime add table public.weekly_plants;

-- ── Helper: log a plant for a week (atomic, returns discovery info) ────────────

create or replace function public.log_plant_for_week(
  p_plant_id   uuid,
  p_week_start date,
  p_added_by   text default 'manual',
  p_meal_id    uuid default null
) returns json language plpgsql security definer as $$
declare
  v_rows          int;
  v_times_eaten   int;
  v_is_first_ever boolean := false;
begin
  select times_eaten into v_times_eaten
  from public.plants where id = p_plant_id;

  insert into public.weekly_plants (plant_id, week_start, added_by, meal_id)
  values (p_plant_id, p_week_start, p_added_by, p_meal_id)
  on conflict (plant_id, week_start) do nothing;

  get diagnostics v_rows = row_count;

  if v_rows > 0 then
    v_is_first_ever := (v_times_eaten = 0);
    update public.plants set
      times_eaten      = times_eaten + 1,
      first_eaten_date = case when times_eaten = 0 then current_date else first_eaten_date end
    where id = p_plant_id;
  end if;

  return json_build_object(
    'was_new_discovery', (v_is_first_ever and v_rows > 0),
    'was_duplicate',     (v_rows = 0)
  );
end;
$$;

-- ── Seed: 60+ starter plants ──────────────────────────────────────────────────

insert into public.plants (name, emoji, category) values
  -- vegetables
  ('Carrot',       '🥕', 'vegetable'),
  ('Broccoli',     '🥦', 'vegetable'),
  ('Spinach',      '🌿', 'vegetable'),
  ('Garlic',       '🧄', 'vegetable'),
  ('Onion',        '🧅', 'vegetable'),
  ('Tomato',       '🍅', 'vegetable'),
  ('Pepper',       '🫑', 'vegetable'),
  ('Cucumber',     '🥒', 'vegetable'),
  ('Courgette',    '🥒', 'vegetable'),
  ('Sweet Potato', '🍠', 'vegetable'),
  ('Corn',         '🌽', 'vegetable'),
  ('Peas',         '🫛', 'vegetable'),
  ('Beetroot',     '🫚', 'vegetable'),
  ('Kale',         '🥬', 'vegetable'),
  ('Cabbage',      '🥬', 'vegetable'),
  ('Mushroom',     '🍄', 'vegetable'),
  ('Lettuce',      '🥬', 'vegetable'),
  ('Celery',       '🌿', 'vegetable'),
  -- fruits
  ('Apple',        '🍎', 'fruit'),
  ('Banana',       '🍌', 'fruit'),
  ('Mango',        '🥭', 'fruit'),
  ('Orange',       '🍊', 'fruit'),
  ('Strawberry',   '🍓', 'fruit'),
  ('Blueberry',    '🫐', 'fruit'),
  ('Grape',        '🍇', 'fruit'),
  ('Pineapple',    '🍍', 'fruit'),
  ('Watermelon',   '🍉', 'fruit'),
  ('Avocado',      '🥑', 'fruit'),
  ('Lemon',        '🍋', 'fruit'),
  ('Lime',         '🍋', 'fruit'),
  ('Peach',        '🍑', 'fruit'),
  ('Pear',         '🍐', 'fruit'),
  ('Kiwi',         '🥝', 'fruit'),
  -- herbs
  ('Basil',        '🌿', 'herb'),
  ('Parsley',      '🌿', 'herb'),
  ('Coriander',    '🌿', 'herb'),
  ('Mint',         '🌿', 'herb'),
  ('Rosemary',     '🌿', 'herb'),
  ('Thyme',        '🌿', 'herb'),
  ('Oregano',      '🌿', 'herb'),
  ('Dill',         '🌿', 'herb'),
  -- spices
  ('Turmeric',     '🟡', 'spice'),
  ('Cumin',        '🌰', 'spice'),
  ('Cinnamon',     '🌰', 'spice'),
  ('Paprika',      '🌶️', 'spice'),
  ('Ginger',       '🫚', 'spice'),
  ('Chilli',       '🌶️', 'spice'),
  ('Cardamom',     '🌰', 'spice'),
  -- nuts
  ('Almond',       '🌰', 'nut'),
  ('Walnut',       '🌰', 'nut'),
  ('Cashew',       '🌰', 'nut'),
  ('Peanut',       '🥜', 'nut'),
  ('Pistachio',    '🌰', 'nut'),
  -- seeds
  ('Sunflower Seeds', '🌻', 'seed'),
  ('Pumpkin Seeds',   '🎃', 'seed'),
  ('Sesame',          '🌾', 'seed'),
  ('Chia',            '🌱', 'seed'),
  ('Flaxseed',        '🌾', 'seed'),
  -- legumes
  ('Lentils',      '🫘', 'legume'),
  ('Chickpeas',    '🫘', 'legume'),
  ('Black Beans',  '🫘', 'legume'),
  ('Kidney Beans', '🫘', 'legume'),
  ('Edamame',      '🫛', 'legume'),
  ('Tofu',         '🧊', 'legume'),
  -- grains
  ('Oats',         '🌾', 'grain'),
  ('Quinoa',       '🌾', 'grain'),
  ('Brown Rice',   '🍚', 'grain'),
  ('Barley',       '🌾', 'grain'),
  ('Buckwheat',    '🌾', 'grain')
on conflict (name) do nothing;
