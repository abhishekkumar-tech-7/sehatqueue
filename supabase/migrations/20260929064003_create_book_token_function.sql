create or replace function book_token(p_session_id uuid)
returns table (booking_id uuid, token_number integer, booking_reference text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session clinic_sessions%rowtype;
  v_patient_id uuid := auth.uid();
  v_next_token integer;
  v_booking_id uuid;
  v_reference text;
begin
  if v_patient_id is null then
    raise exception 'You must be logged in to book.';
  end if;

  if (select role from profiles where id = v_patient_id) <> 'PATIENT' then
    raise exception 'Only patient accounts can book a token.';
  end if;

  -- Lock the session row so no other request can read/update it
  -- until this transaction finishes.
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
  if v_session.last_token_issued >= v_session.capacity then
    raise exception 'This session is full.';
  end if;

  if exists (
    select 1 from bookings
    where session_id = p_session_id
      and patient_id = v_patient_id
      and status not in ('CANCELLED', 'EXPIRED')
  ) then
    raise exception 'You already have a booking for this session.';
  end if;

  v_next_token := v_session.last_token_issued + 1;
  v_reference := 'SQ-' || to_char(now(), 'YYMMDD') || '-' || lpad(v_next_token::text, 4, '0');

  update clinic_sessions
  set last_token_issued = v_next_token
  where id = p_session_id;

  insert into bookings (patient_id, doctor_clinic_id, session_id, booking_mode, token_number, status, booking_reference)
  values (v_patient_id, v_session.doctor_clinic_id, p_session_id, 'TOKEN', v_next_token, 'CONFIRMED', v_reference)
  returning id into v_booking_id;

  return query select v_booking_id, v_next_token, v_reference;
end;
$$;

revoke all on function book_token(uuid) from public;
grant execute on function book_token(uuid) to authenticated; 