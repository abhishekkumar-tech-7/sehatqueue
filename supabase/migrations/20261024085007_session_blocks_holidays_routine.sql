-- ===== 1. Session name (Morning / Evening / Night / custom) =====
alter table clinic_sessions add column if not exists block_label text;
alter table clinic_sessions drop constraint if exists clinic_sessions_block_label_len;
alter table clinic_sessions add constraint clinic_sessions_block_label_len
  check (block_label is null or char_length(block_label) between 1 and 30);

-- ===== 2. Holidays and weekly routine =====
create table if not exists doctor_holidays (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references doctors(id) on delete cascade,
  holiday_date date not null,
  reason text check (reason is null or char_length(reason) <= 100),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  unique (doctor_id, holiday_date)
);
alter table doctor_holidays enable row level security;
revoke all on doctor_holidays from anon, authenticated;

create table if not exists weekly_routine_blocks (
  id uuid primary key default gen_random_uuid(),
  doctor_clinic_id uuid not null references doctor_clinics(id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),  -- 1 = Monday ... 7 = Sunday
  start_time time not null,
  end_time time not null,
  block_label text check (block_label is null or char_length(block_label) between 1 and 30),
  booking_mode booking_mode not null,
  capacity integer not null check (capacity >= 1),
  avg_consultation_minutes integer not null default 5 check (avg_consultation_minutes between 1 and 120),
  check (end_time > start_time),
  unique (doctor_clinic_id, weekday, start_time)
);
alter table weekly_routine_blocks enable row level security;
revoke all on weekly_routine_blocks from anon, authenticated;

-- ===== 3. Helpers =====
-- Same rule as before: the doctor who owns the link, or active staff of that clinic.
create or replace function internal_can_manage(p_dc uuid, p_uid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
           select 1 from doctor_clinics dc join doctors d on d.id = dc.doctor_id
           where dc.id = p_dc and d.profile_id = p_uid)
      or exists (
           select 1 from doctor_clinics dc join clinic_staff cs on cs.clinic_id = dc.clinic_id
           where dc.id = p_dc and cs.profile_id = p_uid and cs.is_active);
$$;
revoke all on function internal_can_manage(uuid, uuid) from public, anon, authenticated;

-- Tries to add one session. Never raises for "normal" refusals; returns the reason instead.
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

  -- One at a time per doctor, so two people cannot create overlapping sessions together.
  perform pg_advisory_xact_lock(hashtext('sessions:' || v_doctor::text));

  if exists (select 1 from doctor_holidays h where h.doctor_id = v_doctor and h.holiday_date = p_date) then
    return 'HOLIDAY';
  end if;

  if exists (
    select 1
    from clinic_sessions cs join doctor_clinics d2 on d2.id = cs.doctor_clinic_id
    where d2.doctor_id = v_doctor
      and cs.session_date = p_date
      and cs.status <> 'CANCELLED'
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

-- ===== 4. Create sessions: one day, several days, several blocks per day =====
-- The old single-session function skipped the new checks, so it is removed.
drop function public.create_clinic_session(uuid, date, time, time, booking_mode, integer, integer);

create or replace function create_sessions_bulk(
  p_doctor_clinic_id uuid, p_from date, p_days integer, p_skip_weekdays integer[], p_blocks jsonb)
returns table (created_count integer, holiday_count integer, overlap_count integer, past_count integer)
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_n integer;
  i integer; j integer; d integer;
  v_date date;
  b jsonb; b2 jsonb;
  v_start time; v_end time; v_mode booking_mode; v_cap integer; v_avg integer; v_label text;
  v_res text;
  c integer := 0; h integer := 0; o integer := 0; p integer := 0;
begin
  if v_uid is null then raise exception 'You must be logged in.'; end if;
  if not internal_can_manage(p_doctor_clinic_id, v_uid) then
    raise exception 'You do not manage this clinic link.';
  end if;
  if p_days is null or p_days < 1 or p_days > 30 then
    raise exception 'Choose between 1 and 30 days.';
  end if;
  if p_blocks is null or jsonb_typeof(p_blocks) <> 'array'
     or jsonb_array_length(p_blocks) < 1 or jsonb_array_length(p_blocks) > 8 then
    raise exception 'Add between 1 and 8 sessions.';
  end if;

  v_n := jsonb_array_length(p_blocks);

  for i in 0 .. v_n - 1 loop
    b := p_blocks -> i;
    v_start := (b ->> 'start')::time;
    v_end := (b ->> 'end')::time;
    if v_end <= v_start then
      raise exception 'End time must be after start time.';
    end if;
    if coalesce((b ->> 'capacity')::integer, 0) < 1 then
      raise exception 'Capacity must be at least 1.';
    end if;
    if coalesce(b ->> 'mode', '') not in ('TOKEN', 'SLOT') then
      raise exception 'Choose Token Queue or Time Slots.';
    end if;
    for j in i + 1 .. v_n - 1 loop
      b2 := p_blocks -> j;
      if v_start < (b2 ->> 'end')::time and v_end > (b2 ->> 'start')::time then
        raise exception 'Two of your sessions overlap in time.';
      end if;
    end loop;
  end loop;

  for d in 0 .. p_days - 1 loop
    v_date := p_from + d;
    if extract(isodow from v_date)::integer = any (coalesce(p_skip_weekdays, '{}'::integer[])) then
      continue;
    end if;

    for i in 0 .. v_n - 1 loop
      b := p_blocks -> i;
      v_start := (b ->> 'start')::time;
      v_end := (b ->> 'end')::time;
      v_mode := (b ->> 'mode')::booking_mode;
      v_cap := (b ->> 'capacity')::integer;
      v_avg := case when v_mode = 'TOKEN'
                 then least(greatest(coalesce((b ->> 'avg')::integer, 5), 1), 120) else 5 end;
      v_label := left(nullif(trim(coalesce(b ->> 'label', '')), ''), 30);

      v_res := internal_try_add_session(p_doctor_clinic_id, v_date, v_start, v_end, v_mode, v_cap, v_avg, v_label);
      if v_res = 'CREATED' then c := c + 1;
      elsif v_res = 'HOLIDAY' then h := h + 1;
      elsif v_res = 'OVERLAP' then o := o + 1;
      elsif v_res = 'PAST' then p := p + 1;
      end if;
    end loop;
  end loop;

  return query select c, h, o, p;
end;
$$;
revoke all on function create_sessions_bulk(uuid, date, integer, integer[], jsonb) from public, anon;
grant execute on function create_sessions_bulk(uuid, date, integer, integer[], jsonb) to authenticated;

-- ===== 5. Weekly routine =====
create or replace function get_routine(p_doctor_clinic_id uuid)
returns setof weekly_routine_blocks
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null or not internal_can_manage(p_doctor_clinic_id, auth.uid()) then
    raise exception 'You do not manage this clinic link.';
  end if;
  return query
    select * from weekly_routine_blocks w
    where w.doctor_clinic_id = p_doctor_clinic_id
    order by w.weekday, w.start_time;
end;
$$;
revoke all on function get_routine(uuid) from public, anon;
grant execute on function get_routine(uuid) to authenticated;

-- Replaces the whole routine. Each block: {weekday 1-7, label, start, end, mode, capacity, avg}
create or replace function save_routine(p_doctor_clinic_id uuid, p_blocks jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_n integer;
  i integer; j integer;
  b jsonb; b2 jsonb;
  v_start time; v_end time; v_mode booking_mode;
begin
  if v_uid is null then raise exception 'You must be logged in.'; end if;
  if not internal_can_manage(p_doctor_clinic_id, v_uid) then
    raise exception 'You do not manage this clinic link.';
  end if;
  if p_blocks is null or jsonb_typeof(p_blocks) <> 'array' or jsonb_array_length(p_blocks) > 56 then
    raise exception 'The routine is not valid.';
  end if;

  v_n := jsonb_array_length(p_blocks);

  for i in 0 .. v_n - 1 loop
    b := p_blocks -> i;
    v_start := (b ->> 'start')::time;
    v_end := (b ->> 'end')::time;
    if v_end <= v_start then raise exception 'End time must be after start time.'; end if;
    if (b ->> 'weekday')::integer not between 1 and 7 then raise exception 'Invalid weekday.'; end if;
    if coalesce((b ->> 'capacity')::integer, 0) < 1 then raise exception 'Capacity must be at least 1.'; end if;
    if coalesce(b ->> 'mode', '') not in ('TOKEN', 'SLOT') then raise exception 'Choose Token Queue or Time Slots.'; end if;
    for j in i + 1 .. v_n - 1 loop
      b2 := p_blocks -> j;
      if (b ->> 'weekday') = (b2 ->> 'weekday')
         and v_start < (b2 ->> 'end')::time and v_end > (b2 ->> 'start')::time then
        raise exception 'Two sessions on the same weekday overlap.';
      end if;
    end loop;
  end loop;

  delete from weekly_routine_blocks where doctor_clinic_id = p_doctor_clinic_id;

  for i in 0 .. v_n - 1 loop
    b := p_blocks -> i;
    v_mode := (b ->> 'mode')::booking_mode;
    insert into weekly_routine_blocks
      (doctor_clinic_id, weekday, start_time, end_time, block_label, booking_mode, capacity, avg_consultation_minutes)
    values
      (p_doctor_clinic_id, (b ->> 'weekday')::smallint, (b ->> 'start')::time, (b ->> 'end')::time,
       left(nullif(trim(coalesce(b ->> 'label', '')), ''), 30), v_mode, (b ->> 'capacity')::integer,
       case when v_mode = 'TOKEN'
         then least(greatest(coalesce((b ->> 'avg')::integer, 5), 1), 120) else 5 end);
  end loop;
end;
$$;
revoke all on function save_routine(uuid, jsonb) from public, anon;
grant execute on function save_routine(uuid, jsonb) to authenticated;

-- Applies the saved routine to the next p_days days.
create or replace function generate_sessions_from_routine(
  p_doctor_clinic_id uuid, p_from date, p_days integer)
returns table (created_count integer, holiday_count integer, overlap_count integer, past_count integer)
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  d integer;
  v_date date;
  r record;
  v_res text;
  c integer := 0; h integer := 0; o integer := 0; p integer := 0;
begin
  if v_uid is null then raise exception 'You must be logged in.'; end if;
  if not internal_can_manage(p_doctor_clinic_id, v_uid) then
    raise exception 'You do not manage this clinic link.';
  end if;
  if p_days is null or p_days < 1 or p_days > 30 then
    raise exception 'Choose between 1 and 30 days.';
  end if;
  if not exists (select 1 from weekly_routine_blocks w where w.doctor_clinic_id = p_doctor_clinic_id) then
    raise exception 'Set up your weekly routine first.';
  end if;

  for d in 0 .. p_days - 1 loop
    v_date := p_from + d;
    for r in
      select * from weekly_routine_blocks w
      where w.doctor_clinic_id = p_doctor_clinic_id
        and w.weekday = extract(isodow from v_date)::integer
      order by w.start_time
    loop
      v_res := internal_try_add_session(p_doctor_clinic_id, v_date, r.start_time, r.end_time,
                 r.booking_mode, r.capacity, r.avg_consultation_minutes, r.block_label);
      if v_res = 'CREATED' then c := c + 1;
      elsif v_res = 'HOLIDAY' then h := h + 1;
      elsif v_res = 'OVERLAP' then o := o + 1;
      elsif v_res = 'PAST' then p := p + 1;
      end if;
    end loop;
  end loop;

  return query select c, h, o, p;
end;
$$;
revoke all on function generate_sessions_from_routine(uuid, date, integer) from public, anon;
grant execute on function generate_sessions_from_routine(uuid, date, integer) to authenticated;

-- ===== 6. Holidays =====
create or replace function list_holidays(p_doctor_clinic_id uuid)
returns table (h_date date, h_reason text)
language plpgsql security definer set search_path = public
as $$
declare
  v_doctor uuid;
begin
  if auth.uid() is null or not internal_can_manage(p_doctor_clinic_id, auth.uid()) then
    raise exception 'You do not manage this clinic link.';
  end if;
  select dc.doctor_id into v_doctor from doctor_clinics dc where dc.id = p_doctor_clinic_id;
  return query
    select h.holiday_date, h.reason from doctor_holidays h
    where h.doctor_id = v_doctor and h.holiday_date >= (now() at time zone 'Asia/Kolkata')::date
    order by h.holiday_date;
end;
$$;
revoke all on function list_holidays(uuid) from public, anon;
grant execute on function list_holidays(uuid) to authenticated;

-- What would be cancelled if this date became a holiday.
create or replace function preview_holiday(p_date date)
returns table (session_count integer, booking_count integer, paid_count integer)
language plpgsql security definer set search_path = public
as $$
declare
  v_doc uuid;
begin
  select d.id into v_doc from doctors d where d.profile_id = auth.uid();
  if v_doc is null then raise exception 'Only doctors can mark holidays.'; end if;
  return query
  select count(distinct cs.id)::integer,
         count(b.id)::integer,
         (count(b.id) filter (where b.payment_status = 'PAID' and coalesce(b.amount_online_paise, 0) > 0))::integer
  from clinic_sessions cs
  join doctor_clinics dc on dc.id = cs.doctor_clinic_id
  left join bookings b on b.session_id = cs.id and b.status in ('PENDING', 'CONFIRMED', 'ON_HOLD')
  where dc.doctor_id = v_doc and cs.session_date = p_date and cs.status in ('DRAFT', 'OPEN', 'PAUSED');
end;
$$;
revoke all on function preview_holiday(date) from public, anon;
grant execute on function preview_holiday(date) to authenticated;

-- Marks the day as a holiday, cancels that day's sessions and bookings, tells every patient,
-- and (through the existing clinic-cancellation trigger) refunds paid bookings in full.
create or replace function mark_holiday(p_date date, p_reason text default null)
returns table (sessions_cancelled integer, bookings_cancelled integer, refunds_started integer)
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_doc uuid;
  v_sessions integer;
  v_unpaid integer;
  v_paid integer;
  v_text text;
begin
  select d.id into v_doc from doctors d where d.profile_id = v_uid;
  if v_doc is null then raise exception 'Only doctors can mark holidays.'; end if;
  if p_date < (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'You cannot mark a date in the past.';
  end if;

  perform pg_advisory_xact_lock(hashtext('sessions:' || v_doc::text));

  insert into doctor_holidays (doctor_id, holiday_date, reason, created_by)
  values (v_doc, p_date, left(nullif(trim(coalesce(p_reason, '')), ''), 100), v_uid)
  on conflict (doctor_id, holiday_date) do update set reason = excluded.reason;

  -- Bookings still waiting for payment: expire them. If a payment lands late,
  -- it is refunded automatically (the "paid but not confirmed" rule).
  update bookings b set status = 'EXPIRED'
  from clinic_sessions cs, doctor_clinics dc
  where b.session_id = cs.id and dc.id = cs.doctor_clinic_id and dc.doctor_id = v_doc
    and cs.session_date = p_date and cs.status in ('DRAFT', 'OPEN', 'PAUSED')
    and b.status = 'PENDING';

  select count(*) into v_paid
  from bookings b
  join clinic_sessions cs on cs.id = b.session_id
  join doctor_clinics dc on dc.id = cs.doctor_clinic_id
  where dc.doctor_id = v_doc and cs.session_date = p_date and cs.status in ('DRAFT', 'OPEN', 'PAUSED')
    and b.payment_status = 'PAID' and b.status in ('CONFIRMED', 'ON_HOLD')
    and coalesce(b.amount_online_paise, 0) > 0;

  select count(*) into v_unpaid
  from bookings b
  join clinic_sessions cs on cs.id = b.session_id
  join doctor_clinics dc on dc.id = cs.doctor_clinic_id
  where dc.doctor_id = v_doc and cs.session_date = p_date and cs.status in ('DRAFT', 'OPEN', 'PAUSED')
    and b.status in ('CONFIRMED', 'ON_HOLD') and b.payment_status in ('NOT_REQUIRED', 'PENDING', 'FAILED');

  v_text := 'The doctor will not be available on ' || to_char(p_date, 'DD Mon YYYY')
            || '. Your booking has been cancelled.';

  -- Bookings with nothing paid online: cancel and notify.
  with u as (
    update bookings b set status = 'CANCELLED', cancellation_reason = 'Doctor is not available on this date'
    from clinic_sessions cs, doctor_clinics dc
    where b.session_id = cs.id and dc.id = cs.doctor_clinic_id and dc.doctor_id = v_doc
      and cs.session_date = p_date and cs.status in ('DRAFT', 'OPEN', 'PAUSED')
      and b.status in ('CONFIRMED', 'ON_HOLD') and b.payment_status in ('NOT_REQUIRED', 'PENDING', 'FAILED')
    returning b.id, b.patient_id
  )
  insert into notifications (recipient_profile_id, booking_id, type, title, body)
  select u.patient_id, u.id, 'BOOKING_CANCELLED'::notification_type, 'Booking Cancelled', v_text
  from u where u.patient_id is not null;

  -- Cancel the sessions. The existing trigger cancels paid bookings, queues full refunds
  -- and notifies those patients.
  update clinic_sessions cs set status = 'CANCELLED'
  from doctor_clinics dc
  where dc.id = cs.doctor_clinic_id and dc.doctor_id = v_doc
    and cs.session_date = p_date and cs.status in ('DRAFT', 'OPEN', 'PAUSED');
  get diagnostics v_sessions = row_count;

  perform write_audit_log('HOLIDAY_MARKED', 'doctor', v_doc,
    jsonb_build_object('date', p_date, 'sessions', v_sessions, 'unpaid_cancelled', v_unpaid, 'refunds', v_paid));

  return query select v_sessions, v_unpaid + v_paid, v_paid;
end;
$$;
revoke all on function mark_holiday(date, text) from public, anon;
grant execute on function mark_holiday(date, text) to authenticated;

create or replace function unmark_holiday(p_date date)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_doc uuid;
begin
  select d.id into v_doc from doctors d where d.profile_id = auth.uid();
  if v_doc is null then raise exception 'Only doctors can change holidays.'; end if;
  delete from doctor_holidays where doctor_id = v_doc and holiday_date = p_date;
  perform write_audit_log('HOLIDAY_REMOVED', 'doctor', v_doc, jsonb_build_object('date', p_date));
end;
$$;
revoke all on function unmark_holiday(date) from public, anon;
grant execute on function unmark_holiday(date) to authenticated;  