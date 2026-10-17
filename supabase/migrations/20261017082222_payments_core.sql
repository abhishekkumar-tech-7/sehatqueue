-- ===== 1. Payment settings (admin-controlled; everything starts OFF) =====
alter table platform_settings
  add column if not exists online_payment_mode text not null default 'OFF',
  add column if not exists route_enabled boolean not null default false,
  add column if not exists payment_hold_minutes integer not null default 10,
  add column if not exists refund_cutoff_hours integer not null default 2;

alter table platform_settings
  add constraint platform_settings_mode_check
    check (online_payment_mode in ('OFF', 'PLATFORM_FEE_ONLY', 'FULL')),
  add constraint platform_settings_hold_check check (payment_hold_minutes between 5 and 30),
  add constraint platform_settings_cutoff_check check (refund_cutoff_hours between 0 and 168);

create or replace function admin_get_payment_settings()
returns table (pay_mode text, route_on boolean, hold_minutes integer, cutoff_hours integer)
language plpgsql security definer set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Admins only.';
  end if;
  return query
  select s.online_payment_mode, s.route_enabled, s.payment_hold_minutes, s.refund_cutoff_hours
  from platform_settings s where s.id;
end;
$$;

revoke all on function admin_get_payment_settings() from public, anon;
grant execute on function admin_get_payment_settings() to authenticated;

create or replace function admin_set_payment_settings(
  p_mode text, p_route_enabled boolean, p_hold_minutes integer, p_cutoff_hours integer
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Admins only.';
  end if;
  if p_mode is null or p_mode not in ('OFF', 'PLATFORM_FEE_ONLY', 'FULL') then
    raise exception 'Invalid payment mode.';
  end if;
  if p_hold_minutes is null or p_hold_minutes < 5 or p_hold_minutes > 30 then
    raise exception 'The payment hold must be 5 to 30 minutes.';
  end if;
  if p_cutoff_hours is null or p_cutoff_hours < 0 or p_cutoff_hours > 168 then
    raise exception 'The refund cut-off must be 0 to 168 hours.';
  end if;

  update platform_settings
  set online_payment_mode = p_mode,
      route_enabled = coalesce(p_route_enabled, false),
      payment_hold_minutes = p_hold_minutes,
      refund_cutoff_hours = p_cutoff_hours,
      updated_at = now(),
      updated_by = auth.uid()
  where id;
end;
$$;

revoke all on function admin_set_payment_settings(text, boolean, integer, integer) from public, anon;
grant execute on function admin_set_payment_settings(text, boolean, integer, integer) to authenticated;

create or replace function audit_payment_settings_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform write_audit_log('PAYMENT_SETTINGS_CHANGED', 'platform_settings', null::uuid,
    jsonb_build_object(
      'from', jsonb_build_object('mode', old.online_payment_mode, 'route', old.route_enabled,
        'hold_minutes', old.payment_hold_minutes, 'cutoff_hours', old.refund_cutoff_hours),
      'to', jsonb_build_object('mode', new.online_payment_mode, 'route', new.route_enabled,
        'hold_minutes', new.payment_hold_minutes, 'cutoff_hours', new.refund_cutoff_hours)));
  return new;
end;
$$;

create trigger audit_payment_settings
  after update on platform_settings
  for each row when (
    (old.online_payment_mode, old.route_enabled, old.payment_hold_minutes, old.refund_cutoff_hours)
    is distinct from
    (new.online_payment_mode, new.route_enabled, new.payment_hold_minutes, new.refund_cutoff_hours))
  execute function audit_payment_settings_trg();

-- ===== 2. Doctor payout accounts (kept in a private table, never shown to patients) =====
create table doctor_payout_accounts (
  doctor_id uuid primary key references doctors(id) on delete cascade,
  razorpay_account_id text not null unique check (razorpay_account_id ~ '^acc_[A-Za-z0-9]+$'),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table doctor_payout_accounts enable row level security;
revoke all on doctor_payout_accounts from anon, authenticated;

create or replace function admin_set_doctor_payout_account(p_doctor_id uuid, p_account_id text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_id text := nullif(btrim(coalesce(p_account_id, '')), '');
begin
  if not is_admin() then
    raise exception 'Admins only.';
  end if;
  if not exists (select 1 from doctors d where d.id = p_doctor_id) then
    raise exception 'Doctor not found.';
  end if;

  if v_id is null then
    delete from doctor_payout_accounts where doctor_id = p_doctor_id;
    perform write_audit_log('PAYOUT_ACCOUNT_CHANGED', 'doctor', p_doctor_id,
      jsonb_build_object('action', 'cleared'));
  else
    if v_id !~ '^acc_[A-Za-z0-9]+$' then
      raise exception 'A Razorpay linked account ID looks like acc_XXXXXXXXXXXXXX.';
    end if;
    insert into doctor_payout_accounts (doctor_id, razorpay_account_id, updated_by)
    values (p_doctor_id, v_id, auth.uid())
    on conflict (doctor_id) do update
      set razorpay_account_id = excluded.razorpay_account_id, updated_at = now(), updated_by = auth.uid();
    perform write_audit_log('PAYOUT_ACCOUNT_CHANGED', 'doctor', p_doctor_id,
      jsonb_build_object('action', 'set', 'last4', right(v_id, 4)));
  end if;
end;
$$;

revoke all on function admin_set_doctor_payout_account(uuid, text) from public, anon;
grant execute on function admin_set_doctor_payout_account(uuid, text) to authenticated;

create or replace function admin_list_doctor_payouts()
returns table (doctor_id uuid, doctor_name text, fee_paise integer, account_last4 text)
language plpgsql security definer set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Admins only.';
  end if;
  return query
  select d.id, d.display_name, d.consultation_fee_paise, right(a.razorpay_account_id, 4)
  from doctors d
  left join doctor_payout_accounts a on a.doctor_id = d.id
  where d.verification_status = 'APPROVED'
  order by d.display_name
  limit 200;
end;
$$;

revoke all on function admin_list_doctor_payouts() from public, anon;
grant execute on function admin_list_doctor_payouts() to authenticated;

-- ===== 3. Payment fields on bookings =====
alter table bookings
  add column if not exists payment_status text not null default 'NOT_REQUIRED',
  add column if not exists amount_online_paise integer check (amount_online_paise >= 0),
  add column if not exists amount_at_clinic_paise integer check (amount_at_clinic_paise >= 0),
  add column if not exists hold_expires_at timestamptz,
  add column if not exists payment_order_id uuid;

alter table bookings
  add constraint bookings_payment_status_check
    check (payment_status in ('NOT_REQUIRED', 'PENDING', 'PAID', 'REFUND_PENDING', 'REFUNDED', 'FAILED'));

-- The locked price now includes the online / at-clinic split.
create or replace function bookings_fee_immutable_trg() returns trigger
language plpgsql as $$
begin
  if (old.consultation_fee_paise, old.platform_fee_paise, old.total_paise, old.fee_locked_at,
      old.amount_online_paise, old.amount_at_clinic_paise)
     is distinct from
     (new.consultation_fee_paise, new.platform_fee_paise, new.total_paise, new.fee_locked_at,
      new.amount_online_paise, new.amount_at_clinic_paise) then
    raise exception 'The fee on a booking cannot be changed after it is made.';
  end if;
  return new;
end;
$$;

-- ===== 4. Payment orders and webhook events (no direct access from the app) =====
-- patient_id is set to null (not deleted) if an account is deleted, so payment records survive.
create table payment_orders (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references profiles(id) on delete set null,
  razorpay_order_id text unique,
  razorpay_payment_id text unique,
  mode text not null check (mode in ('PLATFORM_FEE_ONLY', 'FULL')),
  amount_paise integer not null check (amount_paise > 0),
  doctor_share_paise integer not null default 0 check (doctor_share_paise >= 0),
  platform_share_paise integer not null default 0 check (platform_share_paise >= 0),
  split_method text not null default 'NONE' check (split_method in ('NONE', 'ROUTE', 'LEDGER')),
  status text not null default 'CREATED'
    check (status in ('CREATED', 'PAID', 'FAILED', 'EXPIRED', 'REFUND_DUE', 'REFUNDED')),
  hold_expires_at timestamptz not null,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  check (doctor_share_paise + platform_share_paise = amount_paise)
);

create index idx_payment_orders_patient on payment_orders(patient_id);

alter table payment_orders enable row level security;
create policy "Patients can view their own payment orders"
  on payment_orders for select using (patient_id = auth.uid());
revoke insert, update, delete on payment_orders from anon, authenticated;

create table payment_events (
  razorpay_event_id text primary key,
  event_type text not null,
  received_at timestamptz not null default now()
);

alter table payment_events enable row level security;
revoke all on payment_events from anon, authenticated;

-- ===== 5. Releasing unpaid holds =====
-- Called whenever someone books or views tokens. A 2-minute grace covers a payment that
-- completes just as the hold ends.
create or replace function release_expired_holds()
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update bookings
  set status = 'EXPIRED', payment_status = 'FAILED'
  where status = 'PENDING'
    and hold_expires_at is not null
    and hold_expires_at + interval '2 minutes' < now();

  update payment_orders
  set status = 'EXPIRED'
  where status = 'CREATED'
    and hold_expires_at + interval '2 minutes' < now();
end;
$$;

revoke all on function release_expired_holds() from public, anon, authenticated;

-- ===== 6. What must be paid online vs at the clinic =====
create or replace function internal_payment_split(p_doctor_id uuid)
returns table (fee_consult integer, fee_platform integer, fee_total integer,
               fee_online integer, fee_clinic integer, fee_mode text)
language plpgsql security definer set search_path = public
as $$
declare
  v_c integer;
  v_p integer;
  v_t integer;
  v_mode text;
begin
  select q.consultation_paise, q.platform_paise, q.total_paise into v_c, v_p, v_t
  from internal_fee_quote(p_doctor_id) q;

  select s.online_payment_mode into v_mode from platform_settings s where s.id;

  if v_t = 0 or v_mode = 'OFF' then
    return query select v_c, v_p, v_t, 0, v_t, 'OFF'::text;
  elsif v_mode = 'FULL' then
    return query select v_c, v_p, v_t, v_t, 0, v_mode;
  else
    -- PLATFORM_FEE_ONLY: the patient pays our fee online and the doctor's fee at the clinic.
    return query select v_c, v_p, v_t, v_p, v_c, v_mode;
  end if;
end;
$$;

revoke all on function internal_payment_split(uuid) from public, anon, authenticated;

drop function if exists get_doctor_fee_quote(uuid);

create or replace function get_doctor_fee_quote(p_doctor_id uuid)
returns table (consultation_paise integer, platform_paise integer, total_paise integer,
               online_paise integer, clinic_paise integer, pay_mode text)
language plpgsql security definer set search_path = public
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
  select s.fee_consult, s.fee_platform, s.fee_total, s.fee_online, s.fee_clinic, s.fee_mode
  from internal_payment_split(p_doctor_id) s;
end;
$$;

revoke all on function get_doctor_fee_quote(uuid) from public, anon;
grant execute on function get_doctor_fee_quote(uuid) to authenticated;

-- ===== 7. Booking creation (shared by direct booking and pay-first checkout) =====
create or replace function internal_create_token_bookings(
  p_user uuid, p_session_id uuid, p_patients jsonb, p_status booking_status,
  p_order uuid, p_hold timestamptz,
  p_consult integer, p_platform integer, p_total integer, p_online integer, p_clinic integer,
  p_expected_total integer
)
returns table (booking_id uuid, token_number integer, booking_reference text)
language plpgsql security definer set search_path = public
as $$
declare
  v_session clinic_sessions%rowtype;
  v_item jsonb;
  v_token integer;
  v_name text;
  v_age integer;
  v_reference text;
  v_max_token integer := 0;
  v_new_booking_id uuid;
  v_count integer;
  v_distinct integer;
  v_pay_text text;
begin
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

  if p_expected_total is not null and p_expected_total <> p_total then
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

  v_pay_text := case
    when p_total = 0 then '. Free consultation.'
    when p_clinic > 0 then '. Pay Rs ' || to_char(p_clinic / 100.0, 'FM99999999990.00') || ' at the clinic.'
    else '.'
  end;

  for v_item in select value from jsonb_array_elements(p_patients) loop
    v_token := (v_item->>'token_number')::integer;
    v_name := btrim(v_item->>'name');
    v_age := (v_item->>'age')::integer;
    v_reference := 'SQ-' || to_char(now(), 'YYMMDD') || '-' || lpad(v_token::text, 4, '0')
      || '-' || substr(md5(random()::text), 1, 4);

    insert into bookings (
      patient_id, doctor_clinic_id, session_id, booking_mode,
      token_number, patient_name, patient_age, status, booking_reference,
      consultation_fee_paise, platform_fee_paise, total_paise, fee_locked_at,
      amount_online_paise, amount_at_clinic_paise,
      payment_status, payment_order_id, hold_expires_at
    )
    values (
      p_user, v_session.doctor_clinic_id, p_session_id, 'TOKEN',
      v_token, v_name, v_age, p_status, v_reference,
      p_consult, p_platform, p_total, now(),
      p_online, p_clinic,
      case when p_status = 'PENDING' then 'PENDING' else 'NOT_REQUIRED' end, p_order, p_hold
    )
    returning id into v_new_booking_id;

    if p_status = 'CONFIRMED' then
      insert into notifications (recipient_profile_id, booking_id, type, title, body)
      values (
        p_user, v_new_booking_id, 'BOOKING_CONFIRMED', 'Token Booked',
        'Token #' || v_token || ' for ' || v_name || ' is confirmed. Reference: ' || v_reference || v_pay_text
      );
    end if;

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

revoke all on function internal_create_token_bookings(
  uuid, uuid, jsonb, booking_status, uuid, timestamptz, integer, integer, integer, integer, integer, integer
) from public, anon, authenticated;

create or replace function internal_create_slot_booking(
  p_user uuid, p_session_id uuid, p_start_time timestamptz, p_duration_minutes integer,
  p_status booking_status, p_order uuid, p_hold timestamptz,
  p_consult integer, p_platform integer, p_total integer, p_online integer, p_clinic integer,
  p_expected_total integer
)
returns table (booking_id uuid, appointment_start timestamptz, appointment_end timestamptz, booking_reference text)
language plpgsql security definer set search_path = public
as $$
declare
  v_session clinic_sessions%rowtype;
  v_end_time timestamptz := p_start_time + make_interval(mins => p_duration_minutes);
  v_session_start timestamptz;
  v_session_end timestamptz;
  v_booking_id uuid;
  v_reference text;
  v_pay_text text;
begin
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

  if p_expected_total is not null and p_expected_total <> p_total then
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
      and b.patient_id = p_user
      and b.status not in ('CANCELLED', 'EXPIRED')
  ) then
    raise exception 'You already have a booking for this session.';
  end if;

  v_reference := 'SQ-' || to_char(now(), 'YYMMDD') || '-' || substr(md5(random()::text), 1, 4);

  insert into bookings (
    patient_id, doctor_clinic_id, session_id, booking_mode,
    appointment_start, appointment_end, status, booking_reference,
    consultation_fee_paise, platform_fee_paise, total_paise, fee_locked_at,
    amount_online_paise, amount_at_clinic_paise,
    payment_status, payment_order_id, hold_expires_at
  )
  values (
    p_user, v_session.doctor_clinic_id, p_session_id, 'SLOT',
    p_start_time, v_end_time, p_status, v_reference,
    p_consult, p_platform, p_total, now(),
    p_online, p_clinic,
    case when p_status = 'PENDING' then 'PENDING' else 'NOT_REQUIRED' end, p_order, p_hold
  )
  returning id into v_booking_id;

  if p_status = 'CONFIRMED' then
    v_pay_text := case
      when p_total = 0 then '. Free consultation.'
      when p_clinic > 0 then '. Pay Rs ' || to_char(p_clinic / 100.0, 'FM99999999990.00') || ' at the clinic.'
      else '.'
    end;
    insert into notifications (recipient_profile_id, booking_id, type, title, body)
    values (
      p_user, v_booking_id, 'BOOKING_CONFIRMED', 'Appointment Booked',
      'Your appointment is confirmed. Reference: ' || v_reference || v_pay_text
    );
  end if;

  return query select v_booking_id, p_start_time, v_end_time, v_reference;
end;
$$;

revoke all on function internal_create_slot_booking(
  uuid, uuid, timestamptz, integer, booking_status, uuid, timestamptz, integer, integer, integer, integer, integer, integer
) from public, anon, authenticated;

-- ===== 8. Direct booking: refused whenever the booking must be paid online =====
create or replace function book_tokens(
  p_session_id uuid, p_patients jsonb, p_expected_total_paise integer default null
)
returns table (booking_id uuid, token_number integer, booking_reference text)
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_doctor uuid;
  s record;
begin
  if v_user is null then
    raise exception 'You must be logged in to book.';
  end if;
  if (select pr.role from profiles pr where pr.id = v_user) <> 'PATIENT' then
    raise exception 'Only patient accounts can book a token.';
  end if;

  perform release_expired_holds();

  select dc.doctor_id into v_doctor
  from clinic_sessions cs join doctor_clinics dc on dc.id = cs.doctor_clinic_id
  where cs.id = p_session_id;
  if v_doctor is null then
    raise exception 'This session does not exist.';
  end if;

  select * into s from internal_payment_split(v_doctor);
  if s.fee_online > 0 then
    raise exception 'This booking needs online payment. Please use the pay-now option.';
  end if;

  return query
  select * from internal_create_token_bookings(
    v_user, p_session_id, p_patients, 'CONFIRMED', null, null,
    s.fee_consult, s.fee_platform, s.fee_total, s.fee_online, s.fee_clinic, p_expected_total_paise);
end;
$$;

revoke all on function book_tokens(uuid, jsonb, integer) from public, anon;
grant execute on function book_tokens(uuid, jsonb, integer) to authenticated;

create or replace function book_slot(
  p_session_id uuid, p_start_time timestamptz, p_duration_minutes integer default 15,
  p_expected_total_paise integer default null
)
returns table (booking_id uuid, appointment_start timestamptz, appointment_end timestamptz, booking_reference text)
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_doctor uuid;
  s record;
begin
  if v_user is null then
    raise exception 'You must be logged in to book.';
  end if;
  if (select pr.role from profiles pr where pr.id = v_user) <> 'PATIENT' then
    raise exception 'Only patient accounts can book an appointment.';
  end if;

  perform release_expired_holds();

  select dc.doctor_id into v_doctor
  from clinic_sessions cs join doctor_clinics dc on dc.id = cs.doctor_clinic_id
  where cs.id = p_session_id;
  if v_doctor is null then
    raise exception 'This session does not exist.';
  end if;

  select * into s from internal_payment_split(v_doctor);
  if s.fee_online > 0 then
    raise exception 'This booking needs online payment. Please use the pay-now option.';
  end if;

  return query
  select * from internal_create_slot_booking(
    v_user, p_session_id, p_start_time, p_duration_minutes, 'CONFIRMED', null, null,
    s.fee_consult, s.fee_platform, s.fee_total, s.fee_online, s.fee_clinic, p_expected_total_paise);
end;
$$;

revoke all on function book_slot(uuid, timestamptz, integer, integer) from public, anon;
grant execute on function book_slot(uuid, timestamptz, integer, integer) to authenticated;

-- ===== 9. Pay-first checkout: reserves the booking as PENDING and opens an order =====
create or replace function internal_open_payment_order(p_user uuid, p_doctor_id uuid, p_count integer)
returns table (r_order_id uuid, r_amount integer, r_doctor_share integer, r_platform_share integer,
               r_hold timestamptz, r_mode text, r_consult integer, r_platform integer,
               r_total integer, r_online integer, r_clinic integer)
language plpgsql security definer set search_path = public
as $$
declare
  s record;
  v_mins integer;
  v_hold timestamptz;
  v_amount integer;
  v_doc integer;
  v_plat integer;
  v_order uuid;
begin
  select * into s from internal_payment_split(p_doctor_id);

  if s.fee_online <= 0 then
    raise exception 'No online payment is needed for this booking.';
  end if;
  if s.fee_online::bigint * p_count > 2000000000 then
    raise exception 'This amount is too large to pay online.';
  end if;

  select ps.payment_hold_minutes into v_mins from platform_settings ps where ps.id;
  v_hold := now() + make_interval(mins => v_mins);
  v_amount := s.fee_online * p_count;

  if s.fee_mode = 'FULL' then
    v_doc := s.fee_consult * p_count;
    v_plat := s.fee_platform * p_count;
  else
    v_doc := 0;
    v_plat := v_amount;
  end if;

  insert into payment_orders (patient_id, mode, amount_paise, doctor_share_paise,
                              platform_share_paise, hold_expires_at)
  values (p_user, s.fee_mode, v_amount, v_doc, v_plat, v_hold)
  returning id into v_order;

  return query
  select v_order, v_amount, v_doc, v_plat, v_hold, s.fee_mode,
         s.fee_consult, s.fee_platform, s.fee_total, s.fee_online, s.fee_clinic;
end;
$$;

revoke all on function internal_open_payment_order(uuid, uuid, integer) from public, anon, authenticated;

create or replace function start_token_checkout(
  p_session_id uuid, p_patients jsonb, p_expected_total_paise integer default null
)
returns table (out_order_id uuid, out_amount_paise integer, out_doctor_share_paise integer,
               out_platform_share_paise integer, out_hold_expires_at timestamptz,
               out_pay_mode text, out_doctor_id uuid)
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_doctor uuid;
  v_count integer;
  o record;
begin
  if v_user is null then
    raise exception 'You must be logged in to book.';
  end if;
  if (select pr.role from profiles pr where pr.id = v_user) <> 'PATIENT' then
    raise exception 'Only patient accounts can book a token.';
  end if;

  if p_patients is null or jsonb_typeof(p_patients) <> 'array' then
    raise exception 'Select at least one token.';
  end if;
  v_count := jsonb_array_length(p_patients);
  if v_count < 1 or v_count > 5 then
    raise exception 'Select between 1 and 5 tokens.';
  end if;

  perform release_expired_holds();

  select dc.doctor_id into v_doctor
  from clinic_sessions cs join doctor_clinics dc on dc.id = cs.doctor_clinic_id
  where cs.id = p_session_id;
  if v_doctor is null then
    raise exception 'This session does not exist.';
  end if;

  select * into o from internal_open_payment_order(v_user, v_doctor, v_count);

  perform 1 from internal_create_token_bookings(
    v_user, p_session_id, p_patients, 'PENDING', o.r_order_id, o.r_hold,
    o.r_consult, o.r_platform, o.r_total, o.r_online, o.r_clinic, p_expected_total_paise);

  return query
  select o.r_order_id, o.r_amount, o.r_doctor_share, o.r_platform_share, o.r_hold, o.r_mode, v_doctor;
end;
$$;

revoke all on function start_token_checkout(uuid, jsonb, integer) from public, anon;
grant execute on function start_token_checkout(uuid, jsonb, integer) to authenticated;

create or replace function start_slot_checkout(
  p_session_id uuid, p_start_time timestamptz, p_duration_minutes integer default 15,
  p_expected_total_paise integer default null
)
returns table (out_order_id uuid, out_amount_paise integer, out_doctor_share_paise integer,
               out_platform_share_paise integer, out_hold_expires_at timestamptz,
               out_pay_mode text, out_doctor_id uuid)
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_doctor uuid;
  o record;
begin
  if v_user is null then
    raise exception 'You must be logged in to book.';
  end if;
  if (select pr.role from profiles pr where pr.id = v_user) <> 'PATIENT' then
    raise exception 'Only patient accounts can book an appointment.';
  end if;

  perform release_expired_holds();

  select dc.doctor_id into v_doctor
  from clinic_sessions cs join doctor_clinics dc on dc.id = cs.doctor_clinic_id
  where cs.id = p_session_id;
  if v_doctor is null then
    raise exception 'This session does not exist.';
  end if;

  select * into o from internal_open_payment_order(v_user, v_doctor, 1);

  perform 1 from internal_create_slot_booking(
    v_user, p_session_id, p_start_time, p_duration_minutes, 'PENDING', o.r_order_id, o.r_hold,
    o.r_consult, o.r_platform, o.r_total, o.r_online, o.r_clinic, p_expected_total_paise);

  return query
  select o.r_order_id, o.r_amount, o.r_doctor_share, o.r_platform_share, o.r_hold, o.r_mode, v_doctor;
end;
$$;

revoke all on function start_slot_checkout(uuid, timestamptz, integer, integer) from public, anon;
grant execute on function start_slot_checkout(uuid, timestamptz, integer, integer) to authenticated;

-- ===== 10. Payment confirmed (server only; called by the webhook, never by the app) =====
create or replace function confirm_payment(
  p_razorpay_order_id text, p_razorpay_payment_id text, p_amount_paise integer
)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  o payment_orders%rowtype;
  v_total integer;
  v_pending integer;
begin
  select * into o from payment_orders where razorpay_order_id = p_razorpay_order_id for update;

  if o.id is null then
    raise exception 'Unknown order.';
  end if;
  if o.status = 'PAID' then
    return 'ALREADY_PAID';
  end if;
  if o.status in ('REFUND_DUE', 'REFUNDED') then
    return o.status;
  end if;
  if p_amount_paise <> o.amount_paise then
    raise exception 'The paid amount does not match the order.';
  end if;

  select count(*) into v_total from bookings where payment_order_id = o.id;
  select count(*) into v_pending from bookings where payment_order_id = o.id and status = 'PENDING';

  if v_total = 0 or v_pending <> v_total then
    -- A hold was already released, so the spot may be gone. Refund everything.
    update bookings
    set status = case when status = 'PENDING' then 'EXPIRED'::booking_status else status end,
        payment_status = 'REFUND_PENDING'
    where payment_order_id = o.id;

    update payment_orders
    set status = 'REFUND_DUE', razorpay_payment_id = p_razorpay_payment_id, paid_at = now()
    where id = o.id;
    return 'REFUND_DUE';
  end if;

  update bookings
  set status = 'CONFIRMED', payment_status = 'PAID', hold_expires_at = null
  where payment_order_id = o.id;

  update payment_orders
  set status = 'PAID', razorpay_payment_id = p_razorpay_payment_id, paid_at = now()
  where id = o.id;

  insert into notifications (recipient_profile_id, booking_id, type, title, body)
  select b.patient_id, b.id, 'BOOKING_CONFIRMED'::notification_type,
         case when b.booking_mode = 'TOKEN' then 'Token Booked' else 'Appointment Booked' end,
         'Payment received. '
           || case when b.booking_mode = 'TOKEN' then 'Token #' || b.token_number else 'Your appointment' end
           || ' is confirmed. Reference: ' || b.booking_reference
           || case when coalesce(b.amount_at_clinic_paise, 0) > 0
                then '. Pay Rs ' || to_char(b.amount_at_clinic_paise / 100.0, 'FM99999999990.00') || ' at the clinic.'
                else '.' end
  from bookings b
  where b.payment_order_id = o.id and b.patient_id is not null;

  return 'PAID';
end;
$$;

revoke all on function confirm_payment(text, text, integer) from public, anon, authenticated;
grant execute on function confirm_payment(text, text, integer) to service_role;

-- ===== 11. Keep existing flows safe =====
create or replace function get_session_token_status(p_session_id uuid)
returns table (token_number integer, is_booked boolean, estimated_time timestamptz)
language plpgsql security definer set search_path = public
as $$
declare
  v_session clinic_sessions%rowtype;
  v_session_start timestamptz;
begin
  perform release_expired_holds();

  select * into v_session from clinic_sessions where id = p_session_id;

  if v_session.id is null then
    raise exception 'Session not found.';
  end if;

  v_session_start := (v_session.session_date + v_session.start_time) at time zone 'Asia/Kolkata';

  return query
  select
    gs.n,
    exists (
      select 1 from bookings b
      where b.session_id = p_session_id
        and b.token_number = gs.n
        and b.status not in ('CANCELLED', 'EXPIRED')
    ),
    v_session_start + ((gs.n - 1) * v_session.avg_consultation_minutes) * interval '1 minute'
  from generate_series(1, v_session.capacity) as gs(n)
  order by gs.n;
end;
$$;

revoke all on function get_session_token_status(uuid) from public, anon;
grant execute on function get_session_token_status(uuid) to authenticated;

-- Paid bookings cannot be cancelled until the refund flow exists.
create or replace function cancel_booking(p_booking_id uuid, p_reason text default null)
returns void
language plpgsql security definer set search_path = public
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
  if v_booking.payment_status in ('PAID', 'REFUND_PENDING')
     and v_booking.status in ('CONFIRMED', 'ON_HOLD') then
    raise exception 'This booking was paid online. Paid bookings are cancelled through the refund flow, which is not available yet.';
  end if;

  update bookings
  set status = 'CANCELLED', cancellation_reason = p_reason
  where id = p_booking_id;

  insert into notifications (recipient_profile_id, booking_id, type, title, body)
  values (v_patient_id, p_booking_id, 'BOOKING_CANCELLED', 'Booking Cancelled', 'Your booking has been cancelled.');
end;
$$;

revoke all on function cancel_booking(uuid, text) from public, anon;
grant execute on function cancel_booking(uuid, text) to authenticated;

-- Account deletion must not strand a payment.
create or replace function delete_my_account()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
begin
  if v_uid is null then
    raise exception 'You must be logged in.';
  end if;

  select role::text into v_role from profiles where id = v_uid;

  if v_role is null then
    raise exception 'Account not found.';
  end if;
  if v_role not in ('PATIENT', 'RECEPTIONIST') then
    raise exception 'This type of account cannot be deleted in the app. Please use the deletion request page.';
  end if;

  if exists (
    select 1 from bookings b
    where b.patient_id = v_uid
      and (b.payment_status in ('PENDING', 'REFUND_PENDING')
           or (b.payment_status = 'PAID' and b.status in ('CONFIRMED', 'ON_HOLD')))
  ) then
    raise exception 'You have bookings with a payment in progress or paid. Cancel them first so any refund can be handled, then delete your account.';
  end if;

  perform write_audit_log('ACCOUNT_DELETED', 'profile', v_uid, jsonb_build_object('role', v_role));

  delete from auth.users where id = v_uid;
end;
$$;

revoke all on function delete_my_account() from public, anon;
grant execute on function delete_my_account() to authenticated;   