-- ============================================================
-- Family Hub — Initial Schema
-- ============================================================

-- ------------------------------------------------------------
-- family_members (created first — referenced by other tables)
-- ------------------------------------------------------------
create table public.family_members (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  avatar_emoji  text,
  color         text,
  created_at    timestamptz not null default now()
);

alter table public.family_members enable row level security;

create policy "allow all on family_members"
  on public.family_members
  for all
  using (true)
  with check (true);

-- Seed
insert into public.family_members (name, avatar_emoji, color) values
  ('Mum',     '👩', '#ec4899'),
  ('Dad',     '👨', '#3b82f6'),
  ('Child 1', '🧒', '#f59e0b'),
  ('Child 2', '🧒', '#10b981');

-- ------------------------------------------------------------
-- events
-- ------------------------------------------------------------
create table public.events (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  description      text,
  start_at         timestamptz not null,
  end_at           timestamptz,
  color            text,
  google_event_id  text,
  created_at       timestamptz not null default now()
);

alter table public.events enable row level security;

create policy "allow all on events"
  on public.events
  for all
  using (true)
  with check (true);

create index idx_events_start_at on public.events (start_at);
create index idx_events_end_at   on public.events (end_at);

-- ------------------------------------------------------------
-- chores
-- ------------------------------------------------------------
create table public.chores (
  id                  uuid primary key default gen_random_uuid(),
  title               text not null,
  assigned_to         uuid references public.family_members (id) on delete set null,
  due_date            date,
  completed           boolean not null default false,
  completed_at        timestamptz,
  pocket_money_value  numeric(10, 2) not null default 0,
  is_recurring        boolean not null default false,
  recur_days          integer[],   -- e.g. {1,3,5} = Mon/Wed/Fri (0=Sun … 6=Sat)
  created_at          timestamptz not null default now()
);

alter table public.chores enable row level security;

create policy "allow all on chores"
  on public.chores
  for all
  using (true)
  with check (true);

create index idx_chores_assigned_to on public.chores (assigned_to);
create index idx_chores_due_date    on public.chores (due_date);

-- ------------------------------------------------------------
-- shopping_lists
-- ------------------------------------------------------------
create table public.shopping_lists (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

alter table public.shopping_lists enable row level security;

create policy "allow all on shopping_lists"
  on public.shopping_lists
  for all
  using (true)
  with check (true);

-- Seed
insert into public.shopping_lists (name) values
  ('Groceries'),
  ('School'),
  ('Travel'),
  ('Misc');

-- ------------------------------------------------------------
-- shopping_items
-- ------------------------------------------------------------
create table public.shopping_items (
  id          uuid primary key default gen_random_uuid(),
  list_id     uuid not null references public.shopping_lists (id) on delete cascade,
  name        text not null,
  quantity    integer not null default 1,
  completed   boolean not null default false,
  added_by    uuid references public.family_members (id) on delete set null,
  created_at  timestamptz not null default now()
);

alter table public.shopping_items enable row level security;

create policy "allow all on shopping_items"
  on public.shopping_items
  for all
  using (true)
  with check (true);

create index idx_shopping_items_list_id    on public.shopping_items (list_id);
create index idx_shopping_items_created_at on public.shopping_items (created_at);

-- ------------------------------------------------------------
-- meals
-- ------------------------------------------------------------
create table public.meals (
  id          uuid primary key default gen_random_uuid(),
  date        date not null,
  meal_type   text not null check (meal_type in ('dinner', 'lunchbox')),
  title       text not null,
  notes       text,
  created_at  timestamptz not null default now()
);

alter table public.meals enable row level security;

create policy "allow all on meals"
  on public.meals
  for all
  using (true)
  with check (true);

create index idx_meals_date on public.meals (date);
