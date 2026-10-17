-- 1. Doctor consultation fee, in paise (100 paise = 1 rupee). 0 means free.
alter table doctors
  add column if not exists consultation_fee_paise integer not null default 0
  check (consultation_fee_paise >= 0);

-- 2. Platform fee settings: exactly one row, starts at zero.
create table if not exists platform_settings (
  id boolean primary key default true check (id),
  platform_fee_percent numeric(5,2) not null default 0
    check (platform_fee_percent >= 0 and platform_fee_percent <= 100),
  platform_fee_min_paise integer not null default 0 check (platform_fee_min_paise >= 0),
  platform_fee_max_paise integer not null default 0 check (platform_fee_max_paise >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (platform_fee_max_paise >= platform_fee_min_paise)
);

insert into platform_settings (id) values (true) on conflict (id) do nothing;

alter table platform_settings enable row level security;
revoke all on platform_settings from anon, authenticated;

-- 3. Price locked on each booking.
alter table bookings
  add column if not exists consultation_fee_paise integer check (consultation_fee_paise >= 0),
  add column if not exists platform_fee_paise integer check (platform_fee_paise >= 0),
  add column if not exists total_paise integer check (total_paise >= 0),
  add column if not exists fee_locked_at timestamptz;

alter table bookings add constraint bookings_fee_total_matches
  check (total_paise is null
         or total_paise = coalesce(consultation_fee_paise, 0) + coalesce(platform_fee_paise, 0));

create or replace function bookings_fee_immutable_trg() returns trigger
language plpgsql as $$
begin
  if (old.consultation_fee_paise, old.platform_fee_paise, old.total_paise, old.fee_locked_at)
     is distinct from
     (new.consultation_fee_paise, new.platform_fee_paise, new.total_paise, new.fee_locked_at) then
    raise exception 'The fee on a booking cannot be changed after it is made.';
  end if;
  return new;
end;
$$;

create trigger bookings_fee_immutable
  before update on bookings
  for each row execute function bookings_fee_immutable_trg();

-- 4. The one place fees are calculated. Internal: app users cannot call it directly.
create or replace function internal_fee_quote(p_doctor_id uuid)
returns table (consultation_paise integer, platform_paise integer, total_paise integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fee integer;
  v_pct numeric;
  v_min integer;
  v_max integer;
  v_platform integer := 0;
begin
  select d.consultation_fee_paise into v_fee from doctors d where d.id = p_doctor_id;
  if v_fee is null then
    raise exception 'Doctor not found.';
  end if;

  select s.platform_fee_percent, s.platform_fee_min_paise, s.platform_fee_max_paise
    into v_pct, v_min, v_max
  from platform_settings s where s.id;

  -- Free consultations carry no platform fee.
  if v_fee > 0 then
    v_platform := least(v_max, greatest(v_min, round(v_fee * v_pct / 100.0)::integer));
  end if;

  return query select v_fee, v_platform, v_fee + v_platform;
end;
$$;

revoke all on function internal_fee_quote(uuid) from public, anon, authenticated;

-- 5. What a patient (or the doctor themselves) may see.
create or replace function get_doctor_fee_quote(p_doctor_id uuid)
returns table (consultation_paise integer, platform_paise integer, total_paise integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be logged in.';
  end if;

  if not exists (
    select 1 from doctors d
    where d.id = p_doctor_id
      and (d.verification_status = 'APPROVED' or d.profile_id = auth.uid())
  ) then
    raise exception 'Doctor not found.';
  end if;

  return query
  select q.consultation_paise, q.platform_paise, q.total_paise
  from internal_fee_quote(p_doctor_id) q;
end;
$$;

revoke all on function get_doctor_fee_quote(uuid) from public;
grant execute on function get_doctor_fee_quote(uuid) to authenticated;

-- 6. A doctor sets their own fee (whole rupees; no business limit).
create or replace function set_my_consultation_fee(p_rupees integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_doctor_id uuid;
begin
  if v_uid is null then
    raise exception 'You must be logged in.';
  end if;
  if p_rupees is null or p_rupees < 0 then
    raise exception 'Enter a fee of 0 or more.';
  end if;
  if p_rupees > 10000000 then
    raise exception 'That amount is too large.';
  end if;

  select d.id into v_doctor_id from doctors d where d.profile_id = v_uid;
  if v_doctor_id is null then
    raise exception 'Doctors only.';
  end if;

  update doctors set consultation_fee_paise = p_rupees * 100 where id = v_doctor_id;
  return p_rupees;
end;
$$;

revoke all on function set_my_consultation_fee(integer) from public;
grant execute on function set_my_consultation_fee(integer) to authenticated;

-- 7. Admin reads and sets the platform fee.
create or replace function admin_get_platform_settings()
returns table (fee_percent numeric, fee_min_paise integer, fee_max_paise integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Admins only.';
  end if;

  return query
  select s.platform_fee_percent, s.platform_fee_min_paise, s.platform_fee_max_paise
  from platform_settings s where s.id;
end;
$$;

revoke all on function admin_get_platform_settings() from public;
grant execute on function admin_get_platform_settings() to authenticated;

create or replace function admin_set_platform_settings(
  p_percent numeric, p_min_rupees integer, p_max_rupees integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Admins only.';
  end if;
  if p_percent is null or p_percent < 0 or p_percent > 100 then
    raise exception 'The percentage must be between 0 and 100.';
  end if;
  if p_min_rupees is null or p_max_rupees is null or p_min_rupees < 0 or p_max_rupees < 0 then
    raise exception 'The minimum and maximum must be 0 or more.';
  end if;
  if p_max_rupees > 10000000 then
    raise exception 'The maximum is too large.';
  end if;
  if p_max_rupees < p_min_rupees then
    raise exception 'The maximum cannot be less than the minimum.';
  end if;

  update platform_settings
  set platform_fee_percent = round(p_percent, 2),
      platform_fee_min_paise = p_min_rupees * 100,
      platform_fee_max_paise = p_max_rupees * 100,
      updated_at = now(),
      updated_by = auth.uid()
  where id;
end;
$$;

revoke all on function admin_set_platform_settings(numeric, integer, integer) from public;
grant execute on function admin_set_platform_settings(numeric, integer, integer) to authenticated;

-- 8. Audit trail for fee changes.
create or replace function audit_doctor_fee_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform write_audit_log('DOCTOR_FEE_CHANGED', 'doctor', new.id,
    jsonb_build_object(
      'doctor_name', new.display_name,
      'from_paise', old.consultation_fee_paise,
      'to_paise', new.consultation_fee_paise));
  return new;
end;
$$;

create trigger audit_doctor_fee
  after update of consultation_fee_paise on doctors
  for each row when (old.consultation_fee_paise is distinct from new.consultation_fee_paise)
  execute function audit_doctor_fee_trg();

create or replace function audit_platform_settings_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform write_audit_log('PLATFORM_FEE_CHANGED', 'platform_settings', null::uuid,
    jsonb_build_object(
      'from', jsonb_build_object('percent', old.platform_fee_percent,
        'min_paise', old.platform_fee_min_paise, 'max_paise', old.platform_fee_max_paise),
      'to', jsonb_build_object('percent', new.platform_fee_percent,
        'min_paise', new.platform_fee_min_paise, 'max_paise', new.platform_fee_max_paise)));
  return new;
end;
$$;

create trigger audit_platform_settings
  after update on platform_settings
  for each row when (
    (old.platform_fee_percent, old.platform_fee_min_paise, old.platform_fee_max_paise)
    is distinct from
    (new.platform_fee_percent, new.platform_fee_min_paise, new.platform_fee_max_paise))
  execute function audit_platform_settings_trg();

-- 9. Token booking now locks the fee. Same behaviour as before, plus the price snapshot
-- and an optional "the fee I saw" check.
drop function if exists book_tokens(uuid, jsonb);

create or replace function book_tokens(
  p_session_id uuid,
  p_patients jsonb,
  p_expected_total_paise integer default null
)
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
  v_doctor_id uuid;
  v_consult integer;
  v_platform integer;
  v_total integer;
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

  -- Work out the fee on the server, and check it matches what the patient saw.
  select dc.doctor_id into v_doctor_id from doctor_clinics dc where dc.id = v_session.doctor_clinic_id;
  select q.consultation_paise, q.platform_paise, q.total_paise
    into v_consult, v_platform, v_total
  from internal_fee_quote(v_doctor_id) q;

  if p_expected_total_paise is not null and p_expected_total_paise <> v_total then
    raise exception 'The consultation fee has changed. Please go back and review the new fee.';
  end if;

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
      token_number, patient_name, patient_age, status, booking_reference,
      consultation_fee_paise, platform_fee_paise, total_paise, fee_locked_at
    )
    values (
      v_user_id, v_session.doctor_clinic_id, p_session_id, 'TOKEN',
      v_token, v_name, v_age, 'CONFIRMED', v_reference,
      v_consult, v_platform, v_total, now()
    )
    returning id into v_new_booking_id;

    insert into notifications (recipient_profile_id, booking_id, type, title, body)
    values (
      v_user_id, v_new_booking_id, 'BOOKING_CONFIRMED',
      'Token Booked',
      'Token #' || v_token || ' for ' || v_name || ' is confirmed. Reference: ' || v_reference
        || case when v_total > 0
             then '. Total fee: Rs ' || to_char(v_total / 100.0, 'FM99999999990.00') || ' (pay at clinic).'
             else '. Free consultation.' end
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

revoke all on function book_tokens(uuid, jsonb, integer) from public;
grant execute on function book_tokens(uuid, jsonb, integer) to authenticated;

-- 10. Slot booking locks the fee the same way.
drop function if exists book_slot(uuid, timestamptz, integer);

create or replace function book_slot(
  p_session_id uuid,
  p_start_time timestamptz,
  p_duration_minutes integer default 15,
  p_expected_total_paise integer default null
)
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
  v_doctor_id uuid;
  v_consult integer;
  v_platform integer;
  v_total integer;
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

  select dc.doctor_id into v_doctor_id from doctor_clinics dc where dc.id = v_session.doctor_clinic_id;
  select q.consultation_paise, q.platform_paise, q.total_paise
    into v_consult, v_platform, v_total
  from internal_fee_quote(v_doctor_id) q;

  if p_expected_total_paise is not null and p_expected_total_paise <> v_total then
    raise exception 'The consultation fee has changed. Please go back and review the new fee.';
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

  insert into bookings (
    patient_id, doctor_clinic_id, session_id, booking_mode,
    appointment_start, appointment_end, status, booking_reference,
    consultation_fee_paise, platform_fee_paise, total_paise, fee_locked_at
  )
  values (
    v_patient_id, v_session.doctor_clinic_id, p_session_id, 'SLOT',
    p_start_time, v_end_time, 'CONFIRMED', v_reference,
    v_consult, v_platform, v_total, now()
  )
  returning id into v_booking_id;

  insert into notifications (recipient_profile_id, booking_id, type, title, body)
  values (
    v_patient_id, v_booking_id, 'BOOKING_CONFIRMED',
    'Appointment Booked',
    'Your appointment is confirmed. Reference: ' || v_reference
      || case when v_total > 0
           then '. Total fee: Rs ' || to_char(v_total / 100.0, 'FM99999999990.00') || ' (pay at clinic).'
           else '. Free consultation.' end
  );

  return query select v_booking_id, p_start_time, v_end_time, v_reference;
end;
$$;

revoke all on function book_slot(uuid, timestamptz, integer, integer) from public;
grant execute on function book_slot(uuid, timestamptz, integer, integer) to authenticated;        