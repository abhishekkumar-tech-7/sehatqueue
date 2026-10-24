-- The one-session-per-start-time rule now applies only to sessions that are still active.
alter table clinic_sessions
  drop constraint if exists clinic_sessions_doctor_clinic_id_session_date_start_time_key;
drop index if exists clinic_sessions_doctor_clinic_id_session_date_start_time_key;

create unique index if not exists clinic_sessions_active_slot_key
  on clinic_sessions (doctor_clinic_id, session_date, start_time)
  where status not in ('CLOSED', 'CANCELLED');

-- Same function as before, except closed sessions no longer count as overlapping.
create or replace function internal_try_add_session(
  p_dc uuid, p_date date, p_start time, p_end time, p_mode booking_mode,
  p_capacity integer, p_avg integer, p_label text)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_doctor uuid;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select dc.doctor_id into v_doctor from doctor_clinics dc where dc.id = p_dc;
  if v_doctor is null then
    return 'INVALID';
  end if;

  if p_date < v_today then
    return 'PAST';
  end if;
  if p_date = v_today and p_end <= (now() at time zone 'Asia/Kolkata')::time then
    return 'PAST';
  end if;

  perform pg_advisory_xact_lock(hashtext('sessions:' || v_doctor::text));

  if exists (select 1 from doctor_holidays h where h.doctor_id = v_doctor and h.holiday_date = p_date) then
    return 'HOLIDAY';
  end if;

  if exists (
    select 1
    from clinic_sessions cs join doctor_clinics d2 on d2.id = cs.doctor_clinic_id
    where d2.doctor_id = v_doctor
      and cs.session_date = p_date
      and cs.status not in ('CANCELLED', 'CLOSED')
      and cs.start_time < p_end
      and cs.end_time > p_start
  ) then
    return 'OVERLAP';
  end if;

  insert into clinic_sessions
    (doctor_clinic_id, session_date, start_time, end_time, booking_mode, capacity,
     avg_consultation_minutes, status, block_label)
  values
    (p_dc, p_date, p_start, p_end, p_mode, p_capacity, p_avg, 'OPEN', p_label);
  return 'CREATED';
end;
$$;
revoke all on function internal_try_add_session(uuid, date, time, time, booking_mode, integer, integer, text)
  from public, anon, authenticated;       