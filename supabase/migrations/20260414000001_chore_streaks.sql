-- chore_streaks: one row per family member, tracks streak state
create table public.chore_streaks (
  id                   uuid primary key default gen_random_uuid(),
  member_id            uuid not null references public.family_members(id) on delete cascade,
  streak_count         integer not null default 0,
  last_completed_date  date,
  longest_streak       integer not null default 0,
  updated_at           timestamptz not null default now(),
  unique(member_id)
);

alter table public.chore_streaks enable row level security;
create policy "Allow all" on public.chore_streaks for all using (true) with check (true);
alter publication supabase_realtime add table public.chore_streaks;

-- Called from the client after a chore is marked complete.
-- Checks if ALL chores for p_member_id on p_date are done; if so, updates streak.
create or replace function public.update_chore_streak(p_member_id uuid, p_date date)
returns void language plpgsql security definer as $$
declare
  v_total   int;
  v_done    int;
  v_streak  int;
  v_longest int;
  v_last    date;
begin
  select
    count(*),
    count(*) filter (where completed = true)
  into v_total, v_done
  from public.chores
  where assigned_to = p_member_id
    and due_date    = p_date;

  -- Only proceed when all chores for that day are done
  if v_total = 0 or v_done < v_total then
    return;
  end if;

  select streak_count, longest_streak, last_completed_date
  into   v_streak, v_longest, v_last
  from   public.chore_streaks
  where  member_id = p_member_id;

  if not found then
    v_streak  := 1;
    v_longest := 1;
  elsif v_last = p_date then
    -- Already counted today, nothing to do
    return;
  elsif v_last = p_date - 1 then
    -- Consecutive day — continue streak
    v_streak := v_streak + 1;
  else
    -- Gap — start fresh
    v_streak := 1;
  end if;

  v_longest := greatest(v_longest, v_streak);

  insert into public.chore_streaks
    (member_id, streak_count, last_completed_date, longest_streak, updated_at)
  values
    (p_member_id, v_streak, p_date, v_longest, now())
  on conflict (member_id) do update set
    streak_count        = v_streak,
    last_completed_date = p_date,
    longest_streak      = v_longest,
    updated_at          = now();
end;
$$;
