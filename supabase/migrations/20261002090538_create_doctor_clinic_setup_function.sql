create or replace function create_my_clinic(
  p_name text,
  p_address text,
  p_locality text,
  p_city text,
  p_state text,
  p_postal_code text,
  p_phone text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid := auth.uid();
  v_doctor_id uuid;
  v_clinic_id uuid;
begin
  if v_caller_id is null then
    raise exception 'You must be logged in.';
  end if;

  select id into v_doctor_id from doctors where profile_id = v_caller_id;

  if v_doctor_id is null then
    raise exception 'Doctor profile not found.';
  end if;

  insert into clinics (name, address, locality, city, state, postal_code, phone)
  values (p_name, p_address, p_locality, p_city, p_state, p_postal_code, p_phone)
  returning id into v_clinic_id;

  insert into doctor_clinics (doctor_id, clinic_id, relationship_status)
  values (v_doctor_id, v_clinic_id, 'ACTIVE');

  return v_clinic_id;
end;
$$;

revoke all on function create_my_clinic(text, text, text, text, text, text, text) from public;
grant execute on function create_my_clinic(text, text, text, text, text, text, text) to authenticated;   