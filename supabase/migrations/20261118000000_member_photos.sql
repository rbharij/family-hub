-- ── Family member photos ─────────────────────────────────────────────────────
-- Optional profile photo per family member. When set, the app shows the photo
-- instead of the emoji avatar. Photos live in a public Storage bucket.

alter table public.family_members add column if not exists avatar_url text;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Same open access model as the rest of the app (anon key, no user logins)
create policy "avatars are publicly readable"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "anyone can upload avatars"
  on storage.objects for insert
  with check (bucket_id = 'avatars');

create policy "anyone can replace avatars"
  on storage.objects for update
  using (bucket_id = 'avatars');

create policy "anyone can delete avatars"
  on storage.objects for delete
  using (bucket_id = 'avatars');
