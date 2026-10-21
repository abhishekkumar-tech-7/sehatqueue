-- Online payments below Rs 1 are not possible (Razorpay's minimum), so treat them as pay-at-clinic.
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
    if v_t < 100 then
      return query select v_c, v_p, v_t, 0, v_t, 'OFF'::text;
    else
      return query select v_c, v_p, v_t, v_t, 0, v_mode;
    end if;
  else
    if v_p < 100 then
      return query select v_c, v_p, v_t, 0, v_t, 'OFF'::text;
    else
      return query select v_c, v_p, v_t, v_p, v_c, v_mode;
    end if;
  end if;
end;
$$;

revoke all on function internal_payment_split(uuid) from public, anon, authenticated;

-- What the patient will pay for one session's booking (used by the booking screens).
create or replace function get_session_fee_quote(p_session_id uuid)
returns table (consultation_paise integer, platform_paise integer, total_paise integer,
               online_paise integer, clinic_paise integer, pay_mode text)
language plpgsql security definer set search_path = public
as $$
declare
  v_doctor uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be logged in.';
  end if;

  select dc.doctor_id into v_doctor
  from clinic_sessions cs
  join doctor_clinics dc on dc.id = cs.doctor_clinic_id
  join doctors d on d.id = dc.doctor_id
  where cs.id = p_session_id and d.verification_status = 'APPROVED';

  if v_doctor is null then
    raise exception 'Session not found.';
  end if;

  return query
  select s.fee_consult, s.fee_platform, s.fee_total, s.fee_online, s.fee_clinic, s.fee_mode
  from internal_payment_split(v_doctor) s;
end;
$$;

revoke all on function get_session_fee_quote(uuid) from public, anon;
grant execute on function get_session_fee_quote(uuid) to authenticated;

-- Server only: remember the Razorpay order and how the split is handled.
create or replace function attach_razorpay_order(
  p_order_id uuid, p_razorpay_order_id text, p_split_method text
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update payment_orders
  set razorpay_order_id = p_razorpay_order_id, split_method = p_split_method
  where id = p_order_id and razorpay_order_id is null and status = 'CREATED';

  if not found then
    raise exception 'Order not found or already attached.';
  end if;
end;
$$;

revoke all on function attach_razorpay_order(uuid, text, text) from public, anon, authenticated;
grant execute on function attach_razorpay_order(uuid, text, text) to service_role;

-- Server only: the payment could not be started, so free the held spots.
create or replace function abort_checkout(p_order_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update bookings
  set status = 'CANCELLED', payment_status = 'FAILED',
      cancellation_reason = 'Payment could not be started'
  where payment_order_id = p_order_id and status = 'PENDING';

  update payment_orders set status = 'FAILED' where id = p_order_id and status = 'CREATED';
end;
$$;

revoke all on function abort_checkout(uuid) from public, anon, authenticated;
grant execute on function abort_checkout(uuid) to service_role;

-- The patient gives up on an unpaid checkout.
create or replace function cancel_pending_order(p_order_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  o payment_orders%rowtype;
begin
  if v_uid is null then
    raise exception 'You must be logged in.';
  end if;

  select * into o from payment_orders where id = p_order_id for update;

  if o.id is null or o.patient_id is distinct from v_uid then
    raise exception 'Order not found.';
  end if;
  if o.status <> 'CREATED' then
    raise exception 'This order can no longer be cancelled here.';
  end if;

  update bookings
  set status = 'CANCELLED', payment_status = 'FAILED', cancellation_reason = 'Payment not completed'
  where payment_order_id = o.id and status = 'PENDING';

  update payment_orders set status = 'FAILED' where id = o.id;
end;
$$;

revoke all on function cancel_pending_order(uuid) from public, anon;
grant execute on function cancel_pending_order(uuid) to authenticated;   