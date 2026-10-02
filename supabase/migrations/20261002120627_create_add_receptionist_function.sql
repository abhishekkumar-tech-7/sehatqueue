create or replace function add_receptionist(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doctor_profile_id uuid := auth.uid();
  v_clinic_id uuid;
  v_target_profile_id uuid;
  v_target_role text;
begin
  if v_doctor_profile_id is null then
    raise exception 'You must be logged in.';
  end if;

  select dc.clinic_id into v_clinic_id
  from doctor_clinics dc
  join doctors d on d.id = dc.doctor_id
  where d.profile_id = v_doctor_profile_id
  limit 1;

  if v_clinic_id is null then
    raise exception 'You are not linked to a clinic yet.';
  end if;

  select id, role into v_target_profile_id, v_target_role
  from profiles where email = p_email;

  if v_target_profile_id is null then
    raise exception 'No account found with that email. Ask them to register as a patient first.';
  end if;

  if v_target_role = 'ADMIN' then
    raise exception 'That account cannot be made a receptionist.';
  end if;

  if v_target_role = 'DOCTOR' then
    raise exception 'That account is already a doctor.';
  end if;

  -- Promote their role so our role-aware Home screen routes them correctly.
  update profiles set role = 'RECEPTIONIST' where id = v_target_profile_id;

  insert into clinic_staff (profile_id, clinic_id, is_active)
  values (v_target_profile_id, v_clinic_id, true)
  on conflict (profile_id, clinic_id) do update set is_active = true;
end;
$$;

revoke all on function add_receptionist(text) from public;
grant execute on function add_receptionist(text) to authenticated; 