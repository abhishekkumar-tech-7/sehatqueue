-- ===== 1. Doctor refund policy =====
create table if not exists doctor_refund_policies (
  doctor_id uuid primary key references doctors(id) on delete cascade,
  cutoff_hours integer not null check (cutoff_hours between 0 and 168),
  deduction_percent integer not null check (deduction_percent between 0 and 100),
  updated_at timestamptz not null default now()
);
alter table doctor_refund_policies enable row level security;
revoke all on doctor_refund_policies from anon, authenticated;

-- A doctor with no row uses the platform cut-off and a 0% deduction.
create or replace function internal_refund_policy(p_doctor_id uuid)
returns table (cutoff_hours integer, deduction_percent integer)
language sql stable security definer set search_path = public
as $$
  select coalesce(p.cutoff_hours, s.refund_cutoff_hours) as cutoff_hours,
         coalesce(p.deduction_percent, 0) as deduction_percent
  from platform_settings s
  left join doctor_refund_policies p on p.doctor_id = p_doctor_id
  where s.id;
$$;
revoke all on function internal_refund_policy(uuid) from public, anon, authenticated;

create or replace function get_my_refund_policy()
returns table (cutoff_hours integer, deduction_percent integer, is_custom boolean)
language plpgsql security definer set search_path = public
as $$
declare
  v_doc uuid;
begin
  select d.id into v_doc from doctors d where d.profile_id = auth.uid();
  if v_doc is null then
    raise exception 'Only doctors can view this.';
  end if;
  return query
  select ip.cutoff_hours, ip.deduction_percent,
         exists (select 1 from doctor_refund_policies p where p.doctor_id = v_doc)
  from internal_refund_policy(v_doc) ip;
end;
$$;
revoke all on function get_my_refund_policy() from public, anon;
grant execute on function get_my_refund_policy() to authenticated;

create or replace function set_my_refund_policy(p_cutoff_hours integer, p_deduction_percent integer)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_doc uuid;
begin
  select d.id into v_doc from doctors d where d.profile_id = auth.uid();
  if v_doc is null then
    raise exception 'Only doctors can change this.';
  end if;
  if p_cutoff_hours is null or p_cutoff_hours < 0 or p_cutoff_hours > 168 then
    raise exception 'The refund window must be 0 to 168 hours.';
  end if;
  if p_deduction_percent is null or p_deduction_percent < 0 or p_deduction_percent > 100 then
    raise exception 'The deduction must be 0 to 100 percent.';
  end if;

  insert into doctor_refund_policies (doctor_id, cutoff_hours, deduction_percent)
  values (v_doc, p_cutoff_hours, p_deduction_percent)
  on conflict (doctor_id) do update
    set cutoff_hours = excluded.cutoff_hours,
        deduction_percent = excluded.deduction_percent,
        updated_at = now();

  perform write_audit_log('REFUND_POLICY_CHANGED', 'doctor', v_doc,
    jsonb_build_object('cutoff_hours', p_cutoff_hours, 'deduction_percent', p_deduction_percent));
end;
$$;
revoke all on function set_my_refund_policy(integer, integer) from public, anon;
grant execute on function set_my_refund_policy(integer, integer) to authenticated;

-- What a patient sees before paying.
create or replace function get_session_refund_policy(p_session_id uuid)
returns table (cutoff_hours integer, deduction_percent integer)
language plpgsql security definer set search_path = public
as $$
declare
  v_doc uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be logged in.';
  end if;
  select dc.doctor_id into v_doc
  from clinic_sessions cs
  join doctor_clinics dc on dc.id = cs.doctor_clinic_id
  join doctors d on d.id = dc.doctor_id
  where cs.id = p_session_id and d.verification_status = 'APPROVED';
  if v_doc is null then
    raise exception 'Session not found.';
  end if;
  return query select ip.cutoff_hours, ip.deduction_percent from internal_refund_policy(v_doc) ip;
end;
$$;
revoke all on function get_session_refund_policy(uuid) from public, anon;
grant execute on function get_session_refund_policy(uuid) to authenticated;

-- ===== 2. Refund records =====
create table if not exists payment_refunds (
  id uuid primary key default gen_random_uuid(),
  payment_order_id uuid not null references payment_orders(id),
  booking_id uuid references bookings(id) on delete set null,
  amount_paise integer not null check (amount_paise > 0),
  deduction_paise integer not null default 0 check (deduction_paise >= 0),
  reason text not null check (reason in ('PATIENT_CANCEL', 'CLINIC_CANCEL', 'PAYMENT_UNCONFIRMED', 'ADMIN')),
  status text not null default 'REQUESTED' check (status in ('REQUESTED', 'PROCESSING', 'SUCCESS', 'FAILED')),
  gateway_refund_id text,
  failure_reason text,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A booking can only ever be refunded once (a failed refund can be retried, not duplicated).
create unique index if not exists payment_refunds_one_per_booking
  on payment_refunds (booking_id) where booking_id is not null and status <> 'FAILED';
create unique index if not exists payment_refunds_one_per_order
  on payment_refunds (payment_order_id) where booking_id is null and status <> 'FAILED';

alter table payment_refunds enable row level security;
revoke all on payment_refunds from anon, authenticated;
grant select (id, booking_id, amount_paise, deduction_paise, reason, status, created_at)
  on payment_refunds to authenticated;
create policy "Patients can view their own refunds"
  on payment_refunds for select
  using (exists (select 1 from payment_orders o where o.id = payment_order_id and o.patient_id = auth.uid()));

-- ===== 3. What a patient cancellation would refund =====
create or replace function internal_cancel_quote(p_booking_id uuid)
returns table (refund_paise integer, deduction_paise integer, on_time boolean)
language plpgsql security definer set search_path = public
as $$
declare
  b bookings%rowtype;
  v_doc uuid;
  v_cut integer;
  v_pct integer;
  v_start timestamptz;
  v_ded integer;
begin
  select * into b from bookings where id = p_booking_id;
  if b.id is null or b.payment_status <> 'PAID' or coalesce(b.amount_online_paise, 0) <= 0 then
    return query select 0, 0, true;
    return;
  end if;

  select dc.doctor_id into v_doc from doctor_clinics dc where dc.id = b.doctor_clinic_id;
  select ip.cutoff_hours, ip.deduction_percent into v_cut, v_pct from internal_refund_policy(v_doc) ip;

  select coalesce(b.appointment_start, (cs.session_date + cs.start_time) at time zone 'Asia/Kolkata')
  into v_start from clinic_sessions cs where cs.id = b.session_id;

  if now() <= v_start - make_interval(hours => v_cut) then
    v_ded := floor(b.amount_online_paise::numeric * v_pct / 100)::integer;
    return query select b.amount_online_paise - v_ded, v_ded, true;
  else
    return query select 0, b.amount_online_paise, false;
  end if;
end;
$$;
revoke all on function internal_cancel_quote(uuid) from public, anon, authenticated;

create or replace function preview_cancel_refund(p_booking_id uuid)
returns table (is_paid boolean, paid_paise integer, refund_paise integer, deduction_paise integer,
               on_time boolean, cutoff_hours integer)
language plpgsql security definer set search_path = public
as $$
declare
  b bookings%rowtype;
  v_doc uuid;
  q record;
  v_cut integer;
begin
  select * into b from bookings where id = p_booking_id and patient_id = auth.uid();
  if b.id is null then
    raise exception 'Booking not found.';
  end if;
  select dc.doctor_id into v_doc from doctor_clinics dc where dc.id = b.doctor_clinic_id;
  select ip.cutoff_hours into v_cut from internal_refund_policy(v_doc) ip;
  select * into q from internal_cancel_quote(p_booking_id);
  return query select (b.payment_status = 'PAID' and coalesce(b.amount_online_paise, 0) > 0),
                      coalesce(b.amount_online_paise, 0), q.refund_paise, q.deduction_paise, q.on_time, v_cut;
end;
$$;
revoke all on function preview_cancel_refund(uuid) from public, anon;
grant execute on function preview_cancel_refund(uuid) to authenticated;

-- ===== 4. Recording a refund =====
create or replace function internal_enqueue_refund(p_booking_id uuid, p_reason text, p_amount integer, p_deduction integer)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_amount is null or p_amount <= 0 then
    return;
  end if;
  insert into payment_refunds (payment_order_id, booking_id, amount_paise, deduction_paise, reason)
  select b.payment_order_id, b.id, p_amount, coalesce(p_deduction, 0), p_reason
  from bookings b
  where b.id = p_booking_id and b.payment_order_id is not null
  on conflict do nothing;

  update bookings set payment_status = 'REFUND_PENDING' where id = p_booking_id;
end;
$$;
revoke all on function internal_enqueue_refund(uuid, text, integer, integer) from public, anon, authenticated;

-- Patient cancellation, now with refunds.
create or replace function cancel_booking(p_booking_id uuid, p_reason text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_patient_id uuid := auth.uid();
  v_booking bookings%rowtype;
  q record;
  v_body text := 'Your booking has been cancelled.';
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
  if v_booking.payment_status = 'REFUND_PENDING' then
    raise exception 'A refund for this booking is already in progress.';
  end if;

  if v_booking.payment_status = 'PAID' and coalesce(v_booking.amount_online_paise, 0) > 0 then
    select * into q from internal_cancel_quote(p_booking_id);

    update bookings set status = 'CANCELLED', cancellation_reason = p_reason where id = p_booking_id;

    if q.refund_paise > 0 then
      perform internal_enqueue_refund(p_booking_id, 'PATIENT_CANCEL', q.refund_paise, q.deduction_paise);
      v_body := 'Your booking has been cancelled. A refund of Rs '
        || to_char(q.refund_paise / 100.0, 'FM99999999990.00') || ' is on its way.';
    else
      v_body := 'Your booking has been cancelled. It was too close to the session for a refund.';
    end if;
  else
    update bookings set status = 'CANCELLED', cancellation_reason = p_reason where id = p_booking_id;
  end if;

  insert into notifications (recipient_profile_id, booking_id, type, title, body)
  values (v_patient_id, p_booking_id, 'BOOKING_CANCELLED', 'Booking Cancelled', v_body);
end;
$$;
revoke all on function cancel_booking(uuid, text) from public, anon;
grant execute on function cancel_booking(uuid, text) to authenticated;

-- ===== 5. Clinic closes or cancels a session before patients are seen: full refund =====
create or replace function refund_on_session_end() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  r record;
begin
  for r in
    select b.id, b.patient_id, b.amount_online_paise
    from bookings b
    where b.session_id = new.id
      and b.payment_status = 'PAID'
      and b.status in ('CONFIRMED', 'ON_HOLD')
      and coalesce(b.amount_online_paise, 0) > 0
  loop
    update bookings set status = 'CANCELLED', cancellation_reason = 'Session closed by the clinic'
    where id = r.id;
    perform internal_enqueue_refund(r.id, 'CLINIC_CANCEL', r.amount_online_paise, 0);
    if r.patient_id is not null then
      insert into notifications (recipient_profile_id, booking_id, type, title, body)
      values (r.patient_id, r.id, 'BOOKING_CANCELLED', 'Booking Cancelled',
        'The clinic closed this session before you were seen. Your payment of Rs '
        || to_char(r.amount_online_paise / 100.0, 'FM99999999990.00') || ' will be refunded in full.');
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists refund_on_session_end on clinic_sessions;
create trigger refund_on_session_end
  after update of status on clinic_sessions
  for each row
  when (new.status in ('CLOSED', 'CANCELLED') and old.status is distinct from new.status)
  execute function refund_on_session_end();

-- ===== 6. Payment succeeded but the booking could not be confirmed: full refund =====
drop function if exists confirm_payment(text, text, integer);
create or replace function confirm_payment(
  p_gateway_order_id text, p_gateway_payment_id text, p_amount_paise integer
)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  o payment_orders%rowtype;
  v_total integer;
  v_pending integer;
begin
  select * into o from payment_orders where gateway_order_id = p_gateway_order_id for update;

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
    update bookings
    set status = case when status = 'PENDING' then 'EXPIRED'::booking_status else status end,
        payment_status = 'REFUND_PENDING'
    where payment_order_id = o.id;

    update payment_orders
    set status = 'REFUND_DUE', gateway_payment_id = p_gateway_payment_id, paid_at = now()
    where id = o.id;

    -- Automatic full refund of the whole order.
    insert into payment_refunds (payment_order_id, booking_id, amount_paise, reason)
    values (o.id, null, o.amount_paise, 'PAYMENT_UNCONFIRMED')
    on conflict do nothing;

    return 'REFUND_DUE';
  end if;

  update bookings
  set status = 'CONFIRMED', payment_status = 'PAID', hold_expires_at = null
  where payment_order_id = o.id;

  update payment_orders
  set status = 'PAID', gateway_payment_id = p_gateway_payment_id, paid_at = now()
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

-- ===== 7. Server-side refund processing (used only by the edge functions) =====
create or replace function claim_refunds(p_limit integer default 20)
returns table (refund_id uuid, gateway_order_id text, amount_paise integer, reason text)
language plpgsql security definer set search_path = public
as $$
#variable_conflict use_column
begin
  return query
  with c as (
    select r.id from payment_refunds r
    where r.status = 'REQUESTED'
    order by r.created_at
    limit p_limit
    for update skip locked
  )
  update payment_refunds r
  set status = 'PROCESSING', attempts = r.attempts + 1, updated_at = now()
  from c, payment_orders o
  where r.id = c.id and o.id = r.payment_order_id
  returning r.id, o.gateway_order_id, r.amount_paise, r.reason;
end;
$$;
revoke all on function claim_refunds(integer) from public, anon, authenticated;
grant execute on function claim_refunds(integer) to service_role;

create or replace function list_processing_refunds(p_limit integer default 20)
returns table (refund_id uuid, gateway_order_id text, age_seconds integer)
language sql security definer set search_path = public
as $$
  select r.id, o.gateway_order_id, extract(epoch from (now() - r.updated_at))::integer
  from payment_refunds r join payment_orders o on o.id = r.payment_order_id
  where r.status = 'PROCESSING'
  order by r.updated_at
  limit p_limit;
$$;
revoke all on function list_processing_refunds(integer) from public, anon, authenticated;
grant execute on function list_processing_refunds(integer) to service_role;

create or replace function internal_mark_refund(
  p_refund_id uuid, p_status text, p_gateway_refund_id text default null, p_failure text default null
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r payment_refunds%rowtype;
  v_status text := p_status;
  v_failure text := p_failure;
begin
  select * into r from payment_refunds where id = p_refund_id for update;
  if r.id is null or r.status = 'SUCCESS' then
    return;
  end if;
  if v_status not in ('REQUESTED', 'PROCESSING', 'SUCCESS', 'FAILED') then
    raise exception 'Invalid refund status.';
  end if;
  if v_status = 'REQUESTED' and r.attempts >= 5 then
    v_status := 'FAILED';
    v_failure := coalesce(v_failure, 'Too many attempts');
  end if;

  update payment_refunds
  set status = v_status,
      gateway_refund_id = coalesce(p_gateway_refund_id, gateway_refund_id),
      failure_reason = case when v_status = 'FAILED' then v_failure else null end,
      updated_at = now()
  where id = r.id;

  if v_status = 'SUCCESS' then
    if r.booking_id is not null then
      update bookings set payment_status = 'REFUNDED' where id = r.booking_id;
    else
      update bookings set payment_status = 'REFUNDED'
      where payment_order_id = r.payment_order_id and payment_status = 'REFUND_PENDING';
      update payment_orders set status = 'REFUNDED' where id = r.payment_order_id;
    end if;
  end if;
end;
$$;
revoke all on function internal_mark_refund(uuid, text, text, text) from public, anon, authenticated;
grant execute on function internal_mark_refund(uuid, text, text, text) to service_role;

-- ===== 8. Admin view =====
create or replace function admin_list_refunds()
returns table (refund_id uuid, booking_reference text, amount_paise integer, deduction_paise integer,
               reason text, status text, failure_reason text, attempts integer, created_at timestamptz)
language plpgsql security definer set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Admins only.';
  end if;
  return query
  select r.id, b.booking_reference, r.amount_paise, r.deduction_paise, r.reason, r.status,
         r.failure_reason, r.attempts, r.created_at
  from payment_refunds r
  left join bookings b on b.id = r.booking_id
  order by r.created_at desc
  limit 100;
end;
$$;
revoke all on function admin_list_refunds() from public, anon;
grant execute on function admin_list_refunds() to authenticated;

create or replace function admin_retry_refund(p_refund_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Admins only.';
  end if;
  update payment_refunds
  set status = 'REQUESTED', attempts = 0, failure_reason = null, updated_at = now()
  where id = p_refund_id and status = 'FAILED';
  if not found then
    raise exception 'Only a failed refund can be retried.';
  end if;
  perform write_audit_log('REFUND_RETRIED', 'payment_refund', p_refund_id, '{}'::jsonb);
end;
$$;
revoke all on function admin_retry_refund(uuid) from public, anon;
grant execute on function admin_retry_refund(uuid) to authenticated;   