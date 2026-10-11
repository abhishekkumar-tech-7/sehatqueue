-- Who each token is actually for.
alter table bookings
  add column if not exists patient_name text,
  add column if not exists patient_age integer check (patient_age between 0 and 120);

-- Hold replaces No-show. A held booking can still be completed or skipped.
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

  if p_new_status not in ('COMPLETED', 'ON_HOLD', 'SKIPPED') then
    raise exception 'Only completed, on hold, or skipped are allowed here.';
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

  if v_booking.status not in ('CONFIRMED', 'ON_HOLD') then
    raise exception 'Only confirmed or on-hold bookings can be updated.';
  end if;

  if v_booking.status = 'ON_HOLD' and p_new_status = 'ON_HOLD' then
    raise exception 'This booking is already on hold.';
  end if;

  update bookings set status = p_new_status where id = p_booking_id;

  if p_new_status = 'COMPLETED' then
    insert into notifications (recipient_profile_id, booking_id, type, title, body)
    values (v_booking.patient_id, p_booking_id, 'QUEUE_UPDATE', 'Visit Completed', 'Your visit has been marked as completed.');
  elsif p_new_status = 'ON_HOLD' then
    insert into notifications (recipient_profile_id, booking_id, type, title, body)
    values (v_booking.patient_id, p_booking_id, 'QUEUE_UPDATE', 'Token On Hold', 'Your token has been put on hold. Please tell the front desk when you arrive.');
  end if;
end;
$$;

-- Token booking now takes a name and age for every token.
drop function if exists book_tokens(uuid, integer[]);

create or replace function book_tokens(p_session_id uuid, p_patients jsonb)
returns table (booking_id uuid, token_number integer, booking_reference text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session clinic_sessions%rowtype;
  v_user_id uuid := auth.uid();
  v_item jsonb;
  v_token integer;
  v_name text;
  v_age integer;
  v_reference text;
  v_max_token integer := 0;
  v_new_booking_id uuid;
  v_count integer;
  v_distinct integer;
begin
  if v_user_id is null then
    raise exception 'You must be logged in to book.';
  end if;

  if (select role from profiles where id = v_user_id) <> 'PATIENT' then
    raise exception 'Only patient accounts can book a token.';
  end if;

  if p_patients is null
     or jsonb_typeof(p_patients) <> 'array'
     or jsonb_array_length(p_patients) = 0 then
    raise exception 'Select at least one token.';
  end if;

  v_count := jsonb_array_length(p_patients);
  if v_count > 5 then
    raise exception 'You can book at most 5 tokens at a time.';
  end if;

  -- Validate every entry before touching any data.
  for v_item in select value from jsonb_array_elements(p_patients) loop
    if coalesce(v_item->>'token_number', '') !~ '^\d{1,6}$' then
      raise exception 'Invalid token number.';
    end if;

    v_name := btrim(coalesce(v_item->>'name', ''));
    if char_length(v_name) < 2 or char_length(v_name) > 60 then
      raise exception 'Enter a name (2 to 60 characters) for every token.';
    end if;

    if coalesce(v_item->>'age', '') !~ '^\d{1,3}$' then
      raise exception 'Enter a valid age (0 to 120) for every token.';
    end if;
    if (v_item->>'age')::integer > 120 then
      raise exception 'Enter a valid age (0 to 120) for every token.';
    end if;
  end loop;

  select count(distinct (e->>'token_number')::integer) into v_distinct
  from jsonb_array_elements(p_patients) e;
  if v_distinct <> v_count then
    raise exception 'You selected the same token number more than once.';
  end if;

  -- Lock the session for the whole batch.
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

  -- Check every token is valid and free before booking any of them.
  for v_item in select value from jsonb_array_elements(p_patients) loop
    v_token := (v_item->>'token_number')::integer;

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

  for v_item in select value from jsonb_array_elements(p_patients) loop
    v_token := (v_item->>'token_number')::integer;
    v_name := btrim(v_item->>'name');
    v_age := (v_item->>'age')::integer;
    v_reference := 'SQ-' || to_char(now(), 'YYMMDD') || '-' || lpad(v_token::text, 4, '0')
      || '-' || substr(md5(random()::text), 1, 4);

    insert into bookings (
      patient_id, doctor_clinic_id, session_id, booking_mode,
      token_number, patient_name, patient_age, status, booking_reference
    )
    values (
      v_user_id, v_session.doctor_clinic_id, p_session_id, 'TOKEN',
      v_token, v_name, v_age, 'CONFIRMED', v_reference
    )
    returning id into v_new_booking_id;

    insert into notifications (recipient_profile_id, booking_id, type, title, body)
    values (
      v_user_id, v_new_booking_id, 'BOOKING_CONFIRMED',
      'Token Booked',
      'Token #' || v_token || ' for ' || v_name || ' is confirmed. Reference: ' || v_reference
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

revoke all on function book_tokens(uuid, jsonb) from public;
grant execute on function book_tokens(uuid, jsonb) to authenticated;   