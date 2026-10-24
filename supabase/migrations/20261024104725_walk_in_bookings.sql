-- ===== Walk-in patients have no app account =====
alter table bookings alter column patient_id drop not null;

alter table bookings add column if not exists source text not null default 'ONLINE';
alter table bookings drop constraint if exists bookings_source_check;
alter table bookings add constraint bookings_source_check check (source in ('ONLINE', 'WALK_IN'));

alter table bookings add column if not exists created_by uuid references profiles(id);
alter table bookings add column if not exists fee_collected_at timestamptz;

alter table bookings drop constraint if exists bookings_patient_or_walkin;
alter table bookings add constraint bookings_patient_or_walkin
  check (source = 'WALK_IN' or patient_id is not null);

grant select (source, fee_collected_at) on bookings to authenticated;

-- Live updates on the dashboards.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bookings'
  ) then
    alter publication supabase_realtime add table bookings;
  end if;
end $$;

-- ===== The fee the receptionist should collect =====
create or replace function get_walk_in_fee(p_session_id uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_dc uuid;
  v_doctor uuid;
  s record;
begin
  select cs.doctor_clinic_id into v_dc from clinic_sessions cs where cs.id = p_session_id;
  if v_dc is null or auth.uid() is null or not internal_can_manage(v_dc, auth.uid()) then
    raise exception 'You do not manage this session.';
  end if;
  select dc.doctor_id into v_doctor from doctor_clinics dc where dc.id = v_dc;
  select * into s from internal_payment_split(v_doctor);
  return coalesce(s.fee_consult, 0);
end;
$$;
revoke all on function get_walk_in_fee(uuid) from public, anon;
grant execute on function get_walk_in_fee(uuid) to authenticated;

-- ===== Add a walk-in patient =====
create or replace function add_walk_in(p_session_id uuid, p_name text, p_age integer)
returns table (out_booking_id uuid, out_token integer, out_reference text, out_fee_paise integer)
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_session clinic_sessions%rowtype;
  v_doctor uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_token integer;
  v_ref text;
  v_id uuid;
  v_fee integer;
  s record;
begin
  if v_uid is null then
    raise exception 'You must be logged in.';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 60 then
    raise exception 'Enter the patient''s name (2 to 60 characters).';
  end if;
  if p_age is null or p_age < 0 or p_age > 120 then
    raise exception 'Enter a valid age (0 to 120).';
  end if;

  perform release_expired_holds();

  select * into v_session from clinic_sessions where id = p_session_id for update;
  if v_session.id is null then
    raise exception 'This session does not exist.';
  end if;
  if not internal_can_manage(v_session.doctor_clinic_id, v_uid) then
    raise exception 'You do not manage this session.';
  end if;
  if v_session.status not in ('OPEN', 'PAUSED') then
    raise exception 'This session is not running.';
  end if;
  if v_session.session_date <> (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'Walk-ins can only be added to today''s sessions.';
  end if;
  if v_session.booking_mode <> 'TOKEN' then
    raise exception 'Walk-ins are for token-queue sessions.';
  end if;

  -- Lowest free token above the one currently being called.
  select g.n into v_token
  from generate_series(v_session.current_token + 1, v_session.capacity) as g(n)
  where not exists (
    select 1 from bookings b
    where b.session_id = p_session_id and b.token_number = g.n
      and b.status not in ('CANCELLED', 'EXPIRED')
  )
  order by g.n
  limit 1;

  if v_token is null then
    raise exception 'All remaining tokens in this session are taken.';
  end if;

  select dc.doctor_id into v_doctor from doctor_clinics dc where dc.id = v_session.doctor_clinic_id;
  select * into s from internal_payment_split(v_doctor);
  v_fee := coalesce(s.fee_consult, 0);

  v_ref := 'WI-' || to_char(now() at time zone 'Asia/Kolkata', 'YYMMDD') || '-'
           || lpad(v_token::text, 4, '0') || '-' || substr(md5(random()::text), 1, 4);

  insert into bookings (
    patient_id, doctor_clinic_id, session_id, booking_mode,
    token_number, patient_name, patient_age, status, booking_reference,
    consultation_fee_paise, platform_fee_paise, total_paise, fee_locked_at,
    amount_online_paise, amount_at_clinic_paise,
    payment_status, source, created_by, fee_collected_at
  ) values (
    null, v_session.doctor_clinic_id, p_session_id, 'TOKEN',
    v_token, v_name, p_age, 'CONFIRMED', v_ref,
    v_fee, 0, v_fee, now(),
    0, v_fee,
    'NOT_REQUIRED', 'WALK_IN', v_uid, now()
  )
  returning id into v_id;

  update clinic_sessions
  set last_token_issued = greatest(last_token_issued, v_token)
  where id = p_session_id;

  perform write_audit_log('WALK_IN_ADDED', 'booking', v_id,
    jsonb_build_object('token', v_token, 'fee_paise', v_fee));

  return query select v_id, v_token, v_ref, v_fee;
end;
$$;
revoke all on function add_walk_in(uuid, text, integer) from public, anon;
grant execute on function add_walk_in(uuid, text, integer) to authenticated;   