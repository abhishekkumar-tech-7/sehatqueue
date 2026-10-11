drop policy if exists "Receptionists can view doctor_clinics at their clinic" on doctor_clinics;

create or replace function my_staff_clinic_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select clinic_id from clinic_staff
  where profile_id = auth.uid() and is_active;
$$;

revoke all on function my_staff_clinic_ids() from public;
grant execute on function my_staff_clinic_ids() to authenticated;

create policy "Receptionists can view doctor_clinics at their clinic"
  on doctor_clinics for select
  using (clinic_id in (select my_staff_clinic_ids()));    