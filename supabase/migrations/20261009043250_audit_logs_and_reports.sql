-- 1. Is the caller an active admin? Used by the admin-only functions below.
create or replace function is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'ADMIN' and is_active
  );
$$;

revoke all on function is_admin() from public;
grant execute on function is_admin() to authenticated;

-- 2. The audit log table.
-- actor_profile_id has no foreign key on purpose, so history survives account deletion.
-- clock_timestamp() gives every row its own time, which keeps paging stable.
create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_profile_id uuid,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);

create index idx_audit_logs_created on audit_logs(created_at desc);
create index idx_audit_logs_entity_type on audit_logs(entity_type, created_at desc);
create index idx_audit_logs_entity on audit_logs(entity_type, entity_id);

-- No client can read or write this table directly. Admins read it through
-- admin_get_audit_logs(); only the triggers below write to it.
alter table audit_logs enable row level security;
revoke all on audit_logs from anon, authenticated;

-- Append-only: rows can never be edited or deleted through normal queries.
create or replace function prevent_audit_changes()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Audit logs cannot be modified or deleted.';
end;
$$;

create trigger audit_logs_immutable
  before update or delete on audit_logs
  for each row execute function prevent_audit_changes();

-- 3. Internal writer. Not callable by app users, so logs cannot be forged.
create or replace function write_audit_log(
  p_action text, p_entity_type text, p_entity_id uuid, p_metadata jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into audit_logs (actor_profile_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), p_action, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb));
end;
$$;

revoke all on function write_audit_log(text, text, uuid, jsonb) from public, anon, authenticated;

-- 4. Triggers.
create or replace function audit_doctors_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform write_audit_log('DOCTOR_VERIFICATION_CHANGED', 'doctor', new.id,
    jsonb_build_object(
      'from', old.verification_status::text,
      'to', new.verification_status::text,
      'doctor_name', new.display_name));
  return new;
end;
$$;

create trigger audit_doctors
  after update of verification_status on doctors
  for each row when (old.verification_status is distinct from new.verification_status)
  execute function audit_doctors_trg();

create or replace function audit_profiles_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.role is distinct from new.role then
    perform write_audit_log('ROLE_CHANGED', 'profile', new.id,
      jsonb_build_object('from', old.role::text, 'to', new.role::text));
  end if;
  if old.is_active is distinct from new.is_active then
    perform write_audit_log('ACCOUNT_ACTIVE_CHANGED', 'profile', new.id,
      jsonb_build_object('from', old.is_active, 'to', new.is_active));
  end if;
  return new;
end;
$$;

create trigger audit_profiles
  after update of role, is_active on profiles
  for each row when (old.role is distinct from new.role or old.is_active is distinct from new.is_active)
  execute function audit_profiles_trg();

create or replace function audit_bookings_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform write_audit_log('BOOKING_STATUS_CHANGED', 'booking', new.id,
    jsonb_build_object(
      'from', old.status::text,
      'to', new.status::text,
      'session_id', new.session_id,
      'booking_mode', new.booking_mode::text,
      'token_number', new.token_number));
  return new;
end;
$$;

create trigger audit_bookings
  after update of status on bookings
  for each row when (old.status is distinct from new.status)
  execute function audit_bookings_trg();

create or replace function audit_sessions_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform write_audit_log('SESSION_CREATED', 'session', new.id,
      jsonb_build_object(
        'session_date', new.session_date,
        'booking_mode', new.booking_mode::text,
        'capacity', new.capacity,
        'doctor_clinic_id', new.doctor_clinic_id));
  else
    perform write_audit_log('SESSION_STATUS_CHANGED', 'session', new.id,
      jsonb_build_object('from', old.status::text, 'to', new.status::text));
  end if;
  return new;
end;
$$;

create trigger audit_sessions_insert
  after insert on clinic_sessions
  for each row execute function audit_sessions_trg();

create trigger audit_sessions_status
  after update of status on clinic_sessions
  for each row when (old.status is distinct from new.status)
  execute function audit_sessions_trg();

create or replace function audit_staff_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform write_audit_log('STAFF_ADDED', 'clinic_staff', new.id,
      jsonb_build_object('clinic_id', new.clinic_id, 'staff_profile_id', new.profile_id));
  else
    perform write_audit_log('STAFF_STATUS_CHANGED', 'clinic_staff', new.id,
      jsonb_build_object('clinic_id', new.clinic_id, 'staff_profile_id', new.profile_id,
                         'from', old.is_active, 'to', new.is_active));
  end if;
  return new;
end;
$$;

create trigger audit_staff_insert
  after insert on clinic_staff
  for each row execute function audit_staff_trg();

create trigger audit_staff_status
  after update of is_active on clinic_staff
  for each row when (old.is_active is distinct from new.is_active)
  execute function audit_staff_trg();

create or replace function audit_clinics_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform write_audit_log('CLINIC_CREATED', 'clinic', new.id,
    jsonb_build_object('name', new.name, 'city', new.city));
  return new;
end;
$$;

create trigger audit_clinics
  after insert on clinics
  for each row execute function audit_clinics_trg();

-- 5. Admin reads the log (newest first, paged by timestamp, optional type filter).
create or replace function admin_get_audit_logs(
  p_limit integer default 30,
  p_before timestamptz default null,
  p_entity_type text default null
)
returns table (
  log_id uuid,
  logged_at timestamptz,
  log_action text,
  log_entity_type text,
  log_entity_id uuid,
  log_metadata jsonb,
  actor_name text,
  actor_role text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Admins only.';
  end if;

  return query
  select a.id, a.created_at, a.action, a.entity_type, a.entity_id, a.metadata,
         p.full_name, p.role::text
  from audit_logs a
  left join profiles p on p.id = a.actor_profile_id
  where (p_before is null or a.created_at < p_before)
    and (p_entity_type is null or a.entity_type = p_entity_type)
  order by a.created_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$$;

revoke all on function admin_get_audit_logs(integer, timestamptz, text) from public;
grant execute on function admin_get_audit_logs(integer, timestamptz, text) to authenticated;

-- 6. Admin report. Counts only, no personal details. Dates are India time.
create or replace function admin_report(p_days integer default 7)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 7), 1), 90);
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_since date;
  v_result jsonb;
begin
  if not is_admin() then
    raise exception 'Admins only.';
  end if;

  v_since := v_today - (v_days - 1);

  select jsonb_build_object(
    'days', v_days,
    'since', v_since,

    'users_by_role', (
      select coalesce(jsonb_object_agg(r.role_name, r.n), '{}'::jsonb)
      from (select pr.role::text as role_name, count(*) as n from profiles pr group by pr.role) r
    ),

    'doctors_by_status', (
      select coalesce(jsonb_object_agg(d.status_name, d.n), '{}'::jsonb)
      from (select dr.verification_status::text as status_name, count(*) as n
            from doctors dr group by dr.verification_status) d
    ),

    'active_clinics', (select count(*) from clinics cl where cl.is_active),

    'new_patients', (
      select count(*) from profiles pr
      where pr.role = 'PATIENT'
        and (pr.created_at at time zone 'Asia/Kolkata')::date >= v_since
    ),

    'sessions_in_period', (
      select count(*) from clinic_sessions cs
      where cs.session_date between v_since and v_today
    ),

    'bookings_total', (
      select count(*) from bookings b
      where (b.created_at at time zone 'Asia/Kolkata')::date >= v_since
    ),

    'bookings_by_status', (
      select coalesce(jsonb_object_agg(s.status_name, s.n), '{}'::jsonb)
      from (select b.status::text as status_name, count(*) as n
            from bookings b
            where (b.created_at at time zone 'Asia/Kolkata')::date >= v_since
            group by b.status) s
    ),

    'bookings_by_mode', (
      select coalesce(jsonb_object_agg(m.mode_name, m.n), '{}'::jsonb)
      from (select b.booking_mode::text as mode_name, count(*) as n
            from bookings b
            where (b.created_at at time zone 'Asia/Kolkata')::date >= v_since
            group by b.booking_mode) m
    ),

    'bookings_per_day', (
      select coalesce(jsonb_agg(
               jsonb_build_object('date', to_char(v_since + g.i, 'YYYY-MM-DD'), 'count', coalesce(c.n, 0))
               order by g.i), '[]'::jsonb)
      from generate_series(0, v_days - 1) as g(i)
      left join (
        select (b.created_at at time zone 'Asia/Kolkata')::date as booking_day, count(*) as n
        from bookings b
        where (b.created_at at time zone 'Asia/Kolkata')::date >= v_since
        group by 1
      ) c on c.booking_day = v_since + g.i
    ),

    'top_doctors', (
      select coalesce(jsonb_agg(
               jsonb_build_object('name', t.display_name, 'clinic', t.clinic_name, 'count', t.n)
               order by t.n desc), '[]'::jsonb)
      from (
        select d.display_name, c.name as clinic_name, count(*) as n
        from bookings b
        join doctor_clinics dc on dc.id = b.doctor_clinic_id
        join doctors d on d.id = dc.doctor_id
        join clinics c on c.id = dc.clinic_id
        where (b.created_at at time zone 'Asia/Kolkata')::date >= v_since
          and b.status::text not in ('CANCELLED', 'EXPIRED')
        group by d.id, d.display_name, c.id, c.name
        order by count(*) desc
        limit 5
      ) t
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function admin_report(integer) from public;
grant execute on function admin_report(integer) to authenticated;  