-- Insert a notification for booking confirmation inside book_tokens.
create or replace function book_tokens(p_session_id uuid, p_token_numbers integer[])
returns table (booking_id uuid, token_number integer, booking_reference text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session clinic_sessions%rowtype;
  v_patient_id uuid := auth.uid();
  v_token integer;
  v_reference text;
  v_max_token integer := 0;
  v_new_booking_id uuid;
begin
  if v_patient_id is null then
    raise exception 'You must be logged in to book.';
  end if;

  if (select role from profiles where id = v_patient_id) <> 'PATIENT' then
    raise exception 'Only patient accounts can book a token.';
  end if;

  if p_token_numbers is null or array_length(p_token_numbers, 1) is null then
    raise exception 'Select at least one token.';
  end if;

  if array_length(p_token_numbers, 1) > 5 then
    raise exception 'You can book at most 5 tokens at a time.';
  end if;

  if array_length(p_token_numbers, 1) <> (select count(distinct x) from unnest(p_token_numbers) x) then
    raise exception 'You selected the same token number more than once.';
  end if;

  select * into v_session from clinic_sessions where id = p_session_id for update;

  if v_session.id is null then
    raise exception 'This session does not exist.';
  end if;
  if v_session.status <> 'OPEN' then
    raise exception 'This session is not open for booking.';
  end if;
  if v_session.booking_mode <> 'TOKEN' then
    raise exception 'This session does not use token booking.';
  end if;

  foreach v_token in array p_token_numbers loop
    if v_token < 1 or v_token > v_session.capacity then
      raise exception 'Token number % is not valid for this session.', v_token;
    end if;
    if exists (
      select 1 from bookings b
      where b.session_id = p_session_id
        and b.token_number = v_token
        and b.status not in ('CANCELLED', 'EXPIRED')
    ) then
      raise exception 'Token number % has just been taken. Please choose another.', v_token;
    end if;
    if v_token > v_max_token then
      v_max_token := v_token;
    end if;
  end loop;

  foreach v_token in array p_token_numbers loop
    v_reference := 'SQ-' || to_char(now(), 'YYMMDD') || '-' || lpad(v_token::text, 4, '0')
      || '-' || substr(md5(random()::text), 1, 4);
    insert into bookings (patient_id, doctor_clinic_id, session_id, booking_mode, token_number, status, booking_reference)
    values (v_patient_id, v_session.doctor_clinic_id, p_session_id, 'TOKEN', v_token, 'CONFIRMED', v_reference)
    returning id into v_new_booking_id;

    insert into notifications (recipient_profile_id, booking_id, type, title, body)
    values (
      v_patient_id, v_new_booking_id, 'BOOKING_CONFIRMED',
      'Token Booked', 'Your token #' || v_token || ' is confirmed. Reference: ' || v_reference
    );

    booking_id := v_new_booking_id;
    token_number := v_token;
    booking_reference := v_reference;
    return next;
  end loop;

  update clinic_sessions
  set last_token_issued = greatest(last_token_issued, v_max_token)
  where id = p_session_id;
end;
$$;

-- Insert a notification for booking confirmation inside book_slot.
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

  v_session_start := (v_session.session_date + v_session.start_time) at time zone 'Asia/Kolkata';
  v_session_end := (v_session.session_date + v_session.end_time) at time zone 'Asia/Kolkata';

  if p_start_time < v_session_start or v_end_time > v_session_end then
    raise exception 'That time is outside the session hours.';
  end if;

  if exists (
    select 1 from bookings b
    where b.doctor_clinic_id = v_session.doctor_clinic_id
      and b.status not in ('CANCELLED', 'EXPIRED')
      and b.appointment_start < v_end_time
      and b.appointment_end > p_start_time
  ) then
    raise exception 'That time has just been booked. Please choose another slot.';
  end if;

  if exists (
    select 1 from bookings b
    where b.session_id = p_session_id
      and b.patient_id = v_patient_id
      and b.status not in ('CANCELLED', 'EXPIRED')
  ) then
    raise exception 'You already have a booking for this session.';
  end if;

  v_reference := 'SQ-' || to_char(now(), 'YYMMDD') || '-' || substr(md5(random()::text), 1, 4);

  insert into bookings (patient_id, doctor_clinic_id, session_id, booking_mode, appointment_start, appointment_end, status, booking_reference)
  values (v_patient_id, v_session.doctor_clinic_id, p_session_id, 'SLOT', p_start_time, v_end_time, 'CONFIRMED', v_reference)
  returning id into v_booking_id;

  insert into notifications (recipient_profile_id, booking_id, type, title, body)
  values (
    v_patient_id, v_booking_id, 'BOOKING_CONFIRMED',
    'Appointment Booked', 'Your appointment is confirmed. Reference: ' || v_reference
  );

  return query select v_booking_id, p_start_time, v_end_time, v_reference;
end;
$$;

-- Insert a notification when a patient cancels their own booking.
create or replace function cancel_booking(p_booking_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_patient_id uuid := auth.uid();
  v_booking bookings%rowtype;
begin
  if v_patient_id is null then
    raise exception 'You must be logged in to cancel a booking.';
  end if;

  select * into v_booking from bookings where id = p_booking_id for update;

  if v_booking.id is null then
    raise exception 'Booking not found.';
  end if;

  if v_booking.patient_id <> v_patient_id then
    raise exception 'You can only cancel your own bookings.';
  end if;

  if v_booking.status in ('CANCELLED', 'COMPLETED', 'NO_SHOW', 'EXPIRED') then
    raise exception 'This booking can no longer be cancelled.';
  end if;

  update bookings
  set status = 'CANCELLED',
      cancellation_reason = p_reason
  where id = p_booking_id;

  insert into notifications (recipient_profile_id, booking_id, type, title, body)
  values (
    v_patient_id, p_booking_id, 'BOOKING_CANCELLED',
    'Booking Cancelled', 'Your booking has been cancelled.'
  );
end;
$$;

-- Notify the patient when a doctor marks their booking completed or no-show.
create or replace function update_booking_status(p_booking_id uuid, p_new_status booking_status)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid := auth.uid();
  v_booking bookings%rowtype;
  v_is_owner boolean;
begin
  if v_caller_id is null then
    raise exception 'You must be logged in.';
  end if;

  if p_new_status not in ('COMPLETED', 'NO_SHOW', 'SKIPPED') then
    raise exception 'Doctors can only mark a booking as completed, no-show, or skipped.';
  end if;

  select * into v_booking from bookings where id = p_booking_id for update;

  if v_booking.id is null then
    raise exception 'Booking not found.';
  end if;

  select exists (
    select 1 from doctor_clinics dc
    join doctors d on d.id = dc.doctor_id
    where dc.id = v_booking.doctor_clinic_id and d.profile_id = v_caller_id
  ) into v_is_owner;

  if not v_is_owner then
    raise exception 'You do not manage this booking.';
  end if;

  if v_booking.status <> 'CONFIRMED' then
    raise exception 'Only confirmed bookings can be updated.';
  end if;

  update bookings set status = p_new_status where id = p_booking_id;

  if p_new_status = 'COMPLETED' then
    insert into notifications (recipient_profile_id, booking_id, type, title, body)
    values (v_booking.patient_id, p_booking_id, 'QUEUE_UPDATE', 'Visit Completed', 'Your visit has been marked as completed.');
  elsif p_new_status = 'NO_SHOW' then
    insert into notifications (recipient_profile_id, booking_id, type, title, body)
    values (v_booking.patient_id, p_booking_id, 'QUEUE_UPDATE', 'Marked as No-show', 'You were marked as a no-show for your booking.');
  end if;
end;
$$;

-- Notify the current waiting patient (next in line) when the doctor advances the queue.
create or replace function call_next_token(p_session_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session clinic_sessions%rowtype;
  v_caller_id uuid := auth.uid();
  v_is_owner boolean;
  v_patient_id uuid;
begin
  if v_caller_id is null then
    raise exception 'You must be logged in.';
  end if;

  select * into v_session from clinic_sessions where id = p_session_id for update;

  if v_session.id is null then
    raise exception 'Session not found.';
  end if;

  select exists (
    select 1 from doctor_clinics dc
    join doctors d on d.id = dc.doctor_id
    where dc.id = v_session.doctor_clinic_id and d.profile_id = v_caller_id
  ) into v_is_owner;

  if not v_is_owner then
    raise exception 'You do not manage this session.';
  end if;

  if v_session.current_token >= v_session.last_token_issued then
    raise exception 'No more patients waiting in this session.';
  end if;

  update clinic_sessions
  set current_token = current_token + 1
  where id = p_session_id
  returning current_token into v_session.current_token;

  select patient_id into v_patient_id
  from bookings
  where session_id = p_session_id
    and token_number = v_session.current_token
    and status not in ('CANCELLED', 'EXPIRED');

  if v_patient_id is not null then
    insert into notifications (recipient_profile_id, booking_id, type, title, body)
    select v_patient_id, b.id, 'QUEUE_UPDATE', 'Your Turn', 'You are now being called. Token #' || v_session.current_token
    from bookings b
    where b.session_id = p_session_id and b.token_number = v_session.current_token
    limit 1;
  end if;

  return v_session.current_token;
end;
$$;   