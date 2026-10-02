create table clinic_staff (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  clinic_id uuid not null references clinics(id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (profile_id, clinic_id)
);

create index idx_clinic_staff_profile on clinic_staff(profile_id);
create index idx_clinic_staff_clinic on clinic_staff(clinic_id);

alter table clinic_staff enable row level security;

-- A receptionist can see their own staff assignment(s).
create policy "Receptionists can view their own assignment"
  on clinic_staff for select
  using (profile_id = auth.uid());

-- A doctor can see who is staff at their own clinic, and assign new staff there.
create policy "Doctors can view staff at their clinic"
  on clinic_staff for select
  using (
    clinic_id in (
      select dc.clinic_id from doctor_clinics dc
      join doctors d on d.id = dc.doctor_id
      where d.profile_id = auth.uid()
    )
  );

create policy "Doctors can add staff to their clinic"
  on clinic_staff for insert
  with check (
    clinic_id in (
      select dc.clinic_id from doctor_clinics dc
      join doctors d on d.id = dc.doctor_id
      where d.profile_id = auth.uid()
    )
  );

create policy "Doctors can deactivate staff at their clinic"
  on clinic_staff for update
  using (
    clinic_id in (
      select dc.clinic_id from doctor_clinics dc
      join doctors d on d.id = dc.doctor_id
      where d.profile_id = auth.uid()
    )
  );

grant select, insert on clinic_staff to authenticated;
grant update (is_active) on clinic_staff to authenticated;   