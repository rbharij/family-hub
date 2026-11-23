-- ── AI weekly meal planner ───────────────────────────────────────────────────
-- Adds: food profiles per person, planner settings (lunch pattern, car dinner
-- days, favourite slots), freezer inventory, weekly plan drafts, and a
-- "car_dinner" meal type.

-- 1. Food profile per family member ------------------------------------------
alter table public.family_members
  add column if not exists food_likes    text,
  add column if not exists food_dislikes text,
  add column if not exists dietary_needs text;

-- 2. Meal types: allow lunch and car_dinner ----------------------------------
alter table public.meals drop constraint if exists meals_meal_type_check;
alter table public.meals
  add constraint meals_meal_type_check
  check (meal_type in ('dinner', 'lunch', 'lunchbox', 'car_dinner'));

-- Link a planned meal to a freezer item (for defrost reminders)
alter table public.meals
  add column if not exists freezer_item_id uuid;

-- 3. Planner settings (single row) -------------------------------------------
create table if not exists public.meal_planner_settings (
  id                    uuid        primary key default gen_random_uuid(),
  -- School lunch pattern, keyed by weekday index (0 = Mon … 4 = Fri):
  -- "hot" (food flask), "cold", "school" (school provides), "none"
  lunch_pattern         jsonb       not null default '{"0":"cold","1":"cold","2":"cold","3":"cold","4":"cold"}',
  -- Weekday indexes (0 = Mon … 6 = Sun) when a car dinner is needed
  car_dinner_days       integer[]   not null default '{}',
  -- Weekday indexes when a home lunch is planned (default Sat and Sun)
  lunch_days            integer[]   not null default '{5,6}',
  car_dinner_member_id  uuid        references public.family_members (id) on delete set null,
  -- Fixed favourite slots, e.g. [{"day":4,"title":"Pizza night"}] (dinner only)
  favourite_slots       jsonb       not null default '[]',
  -- Free-text household notes for the planner (cuisines, kit, budget, etc.)
  household_notes       text,
  -- Weekly auto-draft (runs Saturday morning via Vercel cron)
  auto_draft            boolean     not null default true,
  created_at            timestamptz not null default now()
);

alter table public.meal_planner_settings enable row level security;
create policy "allow all on meal_planner_settings"
  on public.meal_planner_settings for all using (true) with check (true);

insert into public.meal_planner_settings (auto_draft)
select true
where not exists (select 1 from public.meal_planner_settings);

-- 4. Freezer inventory -------------------------------------------------------
create table if not exists public.freezer_items (
  id          uuid        primary key default gen_random_uuid(),
  dish        text        not null,
  portions    integer     not null default 1 check (portions >= 0),
  frozen_on   date        not null default current_date,
  notes       text,
  created_at  timestamptz not null default now()
);

alter table public.freezer_items enable row level security;
create policy "allow all on freezer_items"
  on public.freezer_items for all using (true) with check (true);

create index if not exists idx_freezer_items_frozen_on on public.freezer_items (frozen_on);

alter table public.meals
  drop constraint if exists meals_freezer_item_fk;
alter table public.meals
  add constraint meals_freezer_item_fk
  foreign key (freezer_item_id) references public.freezer_items (id) on delete set null;

-- 5. Weekly plan drafts ------------------------------------------------------
create table if not exists public.meal_plans (
  id            uuid        primary key default gen_random_uuid(),
  week_start    date        not null unique,           -- Monday
  status        text        not null default 'draft' check (status in ('draft', 'confirmed')),
  plan          jsonb       not null,                  -- see lib/meal-planner.ts (WeekPlan)
  -- Portions taken from the freezer on confirm, so a re-confirm can put them back
  freezer_deductions jsonb  not null default '[]',
  source        text        not null default 'manual' check (source in ('manual', 'auto')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  confirmed_at  timestamptz
);

alter table public.meal_plans enable row level security;
create policy "allow all on meal_plans"
  on public.meal_plans for all using (true) with check (true);

drop trigger if exists meal_plans_set_updated_at on public.meal_plans;
create trigger meal_plans_set_updated_at
  before update on public.meal_plans
  for each row execute function public.set_updated_at();

-- Realtime
alter publication supabase_realtime add table public.freezer_items;
alter publication supabase_realtime add table public.meal_plans;
alter publication supabase_realtime add table public.meal_planner_settings;
