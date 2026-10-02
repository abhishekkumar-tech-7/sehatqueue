-- Receptionists can view sessions at their clinic.
create policy "Receptionists can view sessions at their clinic"
  on clinic_sessions for select
  using (
    doctor_clinic_id in (
      select dc.id from doctor_clinics dc
      join clinic_staff cs on cs.clinic_id = dc.clinic_id
      where cs.profile_id = auth.uid() and cs.is_active
    )
  );

-- Receptionists can view bookings at their clinic.
create policy "Receptionists can view bookings at their clinic"
  on bookings for select
  using (
    doctor_clinic_id in (
      select dc.id from doctor_clinics dc
      join clinic_staff cs on cs.clinic_id = dc.clinic_id
      where cs.profile_id = auth.uid() and cs.is_active
    )
  );   