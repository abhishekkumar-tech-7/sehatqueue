create policy "Doctors can insert their own specialty links"
  on doctor_specialties for insert
  with check (doctor_id in (select id from doctors where profile_id = auth.uid()));

create policy "Doctors can delete their own specialty links"
  on doctor_specialties for delete
  using (doctor_id in (select id from doctors where profile_id = auth.uid()));

grant insert, delete on doctor_specialties to authenticated;  