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
    -- A short random suffix keeps this unique even if the same token number
    -- on the same date is booked, cancelled, and booked again later.
    v_reference := 'SQ-' || to_char(now(), 'YYMMDD') || '-' || lpad(v_token::text, 4, '0')
      || '-' || substr(md5(random()::text), 1, 4);
    insert into bookings (patient_id, doctor_clinic_id, session_id, booking_mode, token_number, status, booking_reference)
    values (v_patient_id, v_session.doctor_clinic_id, p_session_id, 'TOKEN', v_token, 'CONFIRMED', v_reference)
    returning id into booking_id;
    token_number := v_token;
    booking_reference := v_reference;
    return next;
  end loop;

  update clinic_sessions
  set last_token_issued = greatest(last_token_issued, v_max_token)
  where id = p_session_id;
end;
$$;    