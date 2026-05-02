-- ── Recipes ───────────────────────────────────────────────────────────────────

create table public.recipes (
  id         uuid        primary key default gen_random_uuid(),
  title      text        not null,
  url        text,
  notes      text,
  tags       text[]      not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.recipes enable row level security;

create policy "allow all on recipes"
  on public.recipes
  for all
  using (true)
  with check (true);

alter publication supabase_realtime add table public.recipes;
