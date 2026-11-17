-- ── Pocket money payouts ─────────────────────────────────────────────────────
-- A child's balance = pocket money from all completed tasks minus payouts.
-- "Reset to zero" on the Tasks page records a payout of the current balance,
-- so the history of what was earned and paid is kept.

create table public.pocket_money_payouts (
  id         uuid          primary key default gen_random_uuid(),
  member_id  uuid          not null references public.family_members(id) on delete cascade,
  amount     numeric(10,2) not null check (amount > 0),
  note       text,
  paid_at    timestamptz   not null default now()
);

create index pocket_money_payouts_member_idx on public.pocket_money_payouts (member_id);

alter table public.pocket_money_payouts enable row level security;

create policy "allow all on pocket_money_payouts"
  on public.pocket_money_payouts
  for all
  using (true)
  with check (true);

alter publication supabase_realtime add table public.pocket_money_payouts;
