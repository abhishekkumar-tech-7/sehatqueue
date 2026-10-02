create or replace function call_next_token(p_session_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session clinic_sessions%rowtype;
  v_caller_id uuid := auth.uid();
  v_is_authorized boolean;
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
  ) or exists (
    select 1 from doctor_clinics dc
    join clinic_staff cs on cs.clinic_id = dc.clinic_id
    where dc.id = v_session.doctor_clinic_id and cs.profile_id = v_caller_id and cs.is_active
  ) into v_is_authorized;

  if not v_is_authorized then
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

create or replace function update_booking_status(p_booking_id uuid, p_new_status booking_status)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid := auth.uid();
  v_booking bookings%rowtype;
  v_is_authorized boolean;
begin
  if v_caller_id is null then
    raise exception 'You must be logged in.';
  end if;

  if p_new_status not in ('COMPLETED', 'NO_SHOW', 'SKIPPED') then
    raise exception 'Only completed, no-show, or skipped are allowed here.';
  end if;

  select * into v_booking from bookings where id = p_booking_id for update;

  if v_booking.id is null then
    raise exception 'Booking not found.';
  end if;

  select exists (
    select 1 from doctor_clinics dc
    join doctors d on d.id = dc.doctor_id
    where dc.id = v_booking.doctor_clinic_id and d.profile_id = v_caller_id
  ) or exists (
    select 1 from doctor_clinics dc
    join clinic_staff cs on cs.clinic_id = dc.clinic_id
    where dc.id = v_booking.doctor_clinic_id and cs.profile_id = v_caller_id and cs.is_active
  ) into v_is_authorized;

  if not v_is_authorized then
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