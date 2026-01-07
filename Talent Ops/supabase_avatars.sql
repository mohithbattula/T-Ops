-- 1. Create the 'avatars' bucket (Public)
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- 2. Enable Row Level Security (RLS)
-- note: storage.objects has RLS enabled by default, but policies need to be added.

-- 3. Policy: Public Read Access
-- Allows anyone to view the profile photos
create policy "Public Access Avatars"
  on storage.objects for select
  using ( bucket_id = 'avatars' );

-- 4. Policy: Authenticated Upload
-- Allows any logged-in user to upload a file to the avatars bucket
create policy "Authenticated Upload Avatars"
  on storage.objects for insert
  with check ( bucket_id = 'avatars' and auth.role() = 'authenticated' );

-- 5. Policy: Authenticated Update
-- Allows users to update images (e.g. overwrites if file names collide)
create policy "Authenticated Update Avatars"
  on storage.objects for update
  using ( bucket_id = 'avatars' and auth.role() = 'authenticated' );

-- 6. Policy: Authenticated Delete
-- Allows users to delete files (useful if allowing removal of photo)
create policy "Authenticated Delete Avatars"
  on storage.objects for delete
  using ( bucket_id = 'avatars' and auth.role() = 'authenticated' );
