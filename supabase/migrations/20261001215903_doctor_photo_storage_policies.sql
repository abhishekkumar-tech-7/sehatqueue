-- Anyone can view doctor photos (they're public profile images).
create policy "Public can view doctor photos"
  on storage.objects for select
  using (bucket_id = 'doctor-photos');

-- A doctor can only upload a file named after their own doctor id.
create policy "Doctors can upload their own photo"
  on storage.objects for insert
  with check (
    bucket_id = 'doctor-photos'
    and (storage.foldername(name))[1] in (
      select d.id::text from doctors d where d.profile_id = auth.uid()
    )
  );

-- A doctor can replace (update) only their own photo file.
create policy "Doctors can update their own photo"
  on storage.objects for update
  using (
    bucket_id = 'doctor-photos'
    and (storage.foldername(name))[1] in (
      select d.id::text from doctors d where d.profile_id = auth.uid()
    )
  );  