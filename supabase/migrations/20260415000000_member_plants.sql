-- ── 1. New tables ──────────────────────────────────────────────────────────────

create table public.member_weekly_plants (
  id         uuid primary key default gen_random_uuid(),
  plant_id   uuid not null references public.plants(id)          on delete cascade,
  member_id  uuid not null references public.family_members(id)  on delete cascade,
  week_start date not null,
  added_by   text not null default 'manual',
  meal_id    uuid references public.meals(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (plant_id, member_id, week_start)
);

create table public.plant_discoveries (
  id               uuid primary key default gen_random_uuid(),
  plant_id         uuid not null references public.plants(id)         on delete cascade,
  member_id        uuid not null references public.family_members(id) on delete cascade,
  first_eaten_date date not null default current_date,
  times_eaten      integer not null default 0,
  unique (plant_id, member_id)
);

alter table public.member_weekly_plants enable row level security;
alter table public.plant_discoveries    enable row level security;
create policy "Allow all" on public.member_weekly_plants for all using (true) with check (true);
create policy "Allow all" on public.plant_discoveries    for all using (true) with check (true);
alter publication supabase_realtime add table public.member_weekly_plants;
alter publication supabase_realtime add table public.plant_discoveries;

-- ── 2. Migrate existing weekly_plants data (assign to oldest member) ──────────

do $$
declare
  v_member_id uuid;
begin
  select id into v_member_id from public.family_members order by created_at limit 1;

  if v_member_id is not null and exists (select 1 from information_schema.tables where table_name = 'weekly_plants' and table_schema = 'public') then
    insert into public.member_weekly_plants (plant_id, member_id, week_start, added_by, meal_id, created_at)
    select plant_id, v_member_id, week_start, added_by, meal_id, created_at
    from   public.weekly_plants
    on conflict (plant_id, member_id, week_start) do nothing;

    -- seed plant_discoveries from migrated data
    insert into public.plant_discoveries (plant_id, member_id, first_eaten_date, times_eaten)
    select
      plant_id,
      v_member_id,
      min(week_start)::date,
      count(*)::int
    from public.weekly_plants
    group by plant_id
    on conflict (plant_id, member_id) do nothing;
  end if;
end;
$$;

-- ── 3. Drop the old table (safe: data migrated above) ─────────────────────────

drop table if exists public.weekly_plants;

-- ── 4. New RPC: log one plant for one member atomically ───────────────────────

create or replace function public.log_plant_for_member(
  p_plant_id   uuid,
  p_member_id  uuid,
  p_week_start date,
  p_added_by   text default 'manual',
  p_meal_id    uuid default null
) returns json language plpgsql security definer as $$
declare
  v_rows             int;
  v_discovery_exists boolean;
begin
  insert into public.member_weekly_plants (plant_id, member_id, week_start, added_by, meal_id)
  values (p_plant_id, p_member_id, p_week_start, p_added_by, p_meal_id)
  on conflict (plant_id, member_id, week_start) do nothing;

  get diagnostics v_rows = row_count;

  if v_rows > 0 then
    select exists(
      select 1 from public.plant_discoveries
      where plant_id = p_plant_id and member_id = p_member_id
    ) into v_discovery_exists;

    -- upsert discovery record
    insert into public.plant_discoveries (plant_id, member_id, first_eaten_date, times_eaten)
    values (p_plant_id, p_member_id, current_date, 1)
    on conflict (plant_id, member_id) do update
      set times_eaten = plant_discoveries.times_eaten + 1;
  end if;

  return json_build_object(
    'was_new_discovery', (not v_discovery_exists and v_rows > 0),
    'was_duplicate',     (v_rows = 0)
  );
end;
$$;

-- ── 5. Drop old function ───────────────────────────────────────────────────────

drop function if exists public.log_plant_for_week(uuid, date, text, uuid);
