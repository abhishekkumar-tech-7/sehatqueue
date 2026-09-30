-- Advances the session's "currently called" token by one and returns it.
-- Only the doctor who owns this session can call it.
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

  return v_session.current_token;
end;
$$;

revoke all on function call_next_token(uuid) from public;
grant execute on function call_next_token(uuid) to authenticated;

-- Lets the owning doctor mark any of their bookings as COMPLETED, NO_SHOW or SKIPPED.
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
end;
$$;

revoke all on function update_booking_status(uuid, booking_status) from public;
grant execute on function update_booking_status(uuid, booking_status) to authenticated;  