create table birthdays (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  date date not null,
  type text not null check (type in ('birthday','anniversary')),
  color text not null default '#534AB7',
  created_at timestamptz not null default now()
);

alter table birthdays enable row level security;
create policy "Allow all" on birthdays for all using (true) with check (true);

alter publication supabase_realtime add table birthdays;

insert into birthdays (name, date, type, color)
values ('Add your first birthday', '2000-01-01', 'birthday', '#534AB7');
