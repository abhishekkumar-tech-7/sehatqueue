create or replace function create_clinic_session(
  p_doctor_clinic_id uuid,
  p_session_date date,
  p_start_time time,
  p_end_time time,
  p_booking_mode booking_mode,
  p_capacity integer,
  p_avg_consultation_minutes integer default 5
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid := auth.uid();
  v_is_owner boolean;
  v_session_id uuid;
begin
  if v_caller_id is null then
    raise exception 'You must be logged in.';
  end if;

  select exists (
    select 1 from doctor_clinics dc
    join doctors d on d.id = dc.doctor_id
    where dc.id = p_doctor_clinic_id and d.profile_id = v_caller_id
  ) into v_is_owner;

  if not v_is_owner then
    raise exception 'You do not manage this clinic link.';
  end if;

  if p_end_time <= p_start_time then
    raise exception 'End time must be after start time.';
  end if;

  if p_capacity < 1 then
    raise exception 'Capacity must be at least 1.';
  end if;

  insert into clinic_sessions (
    doctor_clinic_id, session_date, start_time, end_time,
    booking_mode, capacity, avg_consultation_minutes, status
  )
  values (
    p_doctor_clinic_id, p_session_date, p_start_time, p_end_time,
    p_booking_mode, p_capacity, p_avg_consultation_minutes, 'OPEN'
  )
  returning id into v_session_id;

  return v_session_id;
end;
$$;

revoke all on function create_clinic_session(uuid, date, time, time, booking_mode, integer, integer) from public;
grant execute on function create_clinic_session(uuid, date, time, time, booking_mode, integer, integer) to authenticated;  