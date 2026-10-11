create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_role text := new.raw_user_meta_data ->> 'role';
  full_name_value text := coalesce(new.raw_user_meta_data ->> 'full_name', '');
  phone_digits text := regexp_replace(
    coalesce(nullif(new.phone, ''), new.raw_user_meta_data ->> 'phone', ''), '\D', '', 'g');
  phone_value text := nullif(right(phone_digits, 10), '');
begin
  insert into public.profiles (id, full_name, phone, email, role)
  values (
    new.id,
    full_name_value,
    phone_value,
    nullif(new.email, ''),
    case when requested_role = 'DOCTOR'
      then 'DOCTOR'::user_role
      else 'PATIENT'::user_role
    end
  );

  if requested_role = 'DOCTOR' then
    insert into public.doctors (profile_id, display_name, qualifications)
    values (new.id, full_name_value, new.raw_user_meta_data ->> 'qualifications');
  end if;

  return new;
end;
$$;

-- add_receptionist now accepts an email OR a 10-digit phone number.
drop function if exists add_receptionist(text);

create or replace function add_receptionist(p_identifier text)
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
  v_phone text;
  v_matches integer;
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

  if position('@' in p_identifier) > 0 then
    select id, role into v_target_profile_id, v_target_role
    from profiles where lower(email) = lower(trim(p_identifier));
  else
    v_phone := right(regexp_replace(p_identifier, '\D', '', 'g'), 10);
    select count(*) into v_matches from profiles where phone = v_phone;
    if v_matches > 1 then
      raise exception 'More than one account uses that number. Use their email instead.';
    end if;
    select id, role into v_target_profile_id, v_target_role
    from profiles where phone = v_phone;
  end if;

  if v_target_profile_id is null then
    raise exception 'No account found. Ask them to register as a patient first.';
  end if;
  if v_target_role = 'ADMIN' then
    raise exception 'That account cannot be made a receptionist.';
  end if;
  if v_target_role = 'DOCTOR' then
    raise exception 'That account is already a doctor.';
  end if;

  update profiles set role = 'RECEPTIONIST' where id = v_target_profile_id;

  insert into clinic_staff (profile_id, clinic_id, is_active)
  values (v_target_profile_id, v_clinic_id, true)
  on conflict (profile_id, clinic_id) do update set is_active = true;
end;
$$;

revoke all on function add_receptionist(text) from public;
grant execute on function add_receptionist(text) to authenticated;  