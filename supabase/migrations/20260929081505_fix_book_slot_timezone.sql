create or replace function book_slot(p_session_id uuid, p_start_time timestamptz, p_duration_minutes integer default 15)
returns table (booking_id uuid, appointment_start timestamptz, appointment_end timestamptz, booking_reference text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session clinic_sessions%rowtype;
  v_patient_id uuid := auth.uid();
  v_end_time timestamptz := p_start_time + make_interval(mins => p_duration_minutes);
  v_session_start timestamptz;
  v_session_end timestamptz;
  v_booking_id uuid;
  v_reference text;
begin
  if v_patient_id is null then
    raise exception 'You must be logged in to book.';
  end if;

  if (select role from profiles where id = v_patient_id) <> 'PATIENT' then
    raise exception 'Only patient accounts can book an appointment.';
  end if;

  select * into v_session from clinic_sessions where id = p_session_id for update;

  if v_session.id is null then
    raise exception 'This session does not exist.';
  end if;
  if v_session.status <> 'OPEN' then
    raise exception 'This session is not open for booking.';
  end if;
  if v_session.booking_mode <> 'SLOT' then
    raise exception 'This session does not use time-slot booking.';
  end if;

  -- session_date/start_time/end_time are stored as clinic-local (India) values,
  -- so we must explicitly interpret them as IST before comparing to p_start_time.
  v_session_start := (v_session.session_date + v_session.start_time) at time zone 'Asia/Kolkata';
  v_session_end := (v_session.session_date + v_session.end_time) at time zone 'Asia/Kolkata';

  if p_start_time < v_session_start or v_end_time > v_session_end then
    raise exception 'That time is outside the session hours.';
  end if;

  if exists (
    select 1 from bookings
    where doctor_clinic_id = v_session.doctor_clinic_id
      and status not in ('CANCELLED', 'EXPIRED')
      and appointment_start < v_end_time
      and appointment_end > p_start_time
  ) then
    raise exception 'That time has just been booked. Please choose another slot.';
  end if;

  if exists (
    select 1 from bookings
    where session_id = p_session_id
      and patient_id = v_patient_id
      and status not in ('CANCELLED', 'EXPIRED')
  ) then
    raise exception 'You already have a booking for this session.';
  end if;

  v_reference := 'SQ-' || to_char(now(), 'YYMMDD') || '-' || substr(md5(random()::text), 1, 4);

  insert into bookings (patient_id, doctor_clinic_id, session_id, booking_mode, appointment_start, appointment_end, status, booking_reference)
  values (v_patient_id, v_session.doctor_clinic_id, p_session_id, 'SLOT', p_start_time, v_end_time, 'CONFIRMED', v_reference)
  returning id into v_booking_id;

  return query select v_booking_id, p_start_time, v_end_time, v_reference;
end;
$$;  