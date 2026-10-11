create policy "Receptionists can view doctor_clinics at their clinic"
  on doctor_clinics for select
  using (
    clinic_id in (
      select cs.clinic_id from clinic_staff cs
      where cs.profile_id = auth.uid() and cs.is_active
    )
  );  