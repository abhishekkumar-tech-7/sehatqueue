-- Make the payment tables gateway-neutral (Cashfree Easy Split).
-- Run as a new migration:  supabase migration new cashfree_gateway

-- 1. payment_orders
alter table payment_orders rename column razorpay_order_id to gateway_order_id;
alter table payment_orders rename column razorpay_payment_id to gateway_payment_id;
alter table payment_orders add column if not exists gateway text not null default 'CASHFREE';

alter table payment_orders drop constraint if exists payment_orders_split_method_check;
update payment_orders set split_method = 'SPLIT' where split_method = 'ROUTE';
alter table payment_orders
  add constraint payment_orders_split_method_check check (split_method in ('NONE', 'SPLIT', 'LEDGER'));

-- 2. payment_events
alter table payment_events rename column razorpay_event_id to gateway_event_id;

-- 3. doctor payout accounts: Cashfree "vendor id" instead of Razorpay "acc_..."
alter table doctor_payout_accounts rename column razorpay_account_id to vendor_id;
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'doctor_payout_accounts'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%acc_%'
  loop
    execute format('alter table doctor_payout_accounts drop constraint %I', c.conname);
  end loop;
end $$;
alter table doctor_payout_accounts
  add constraint doctor_payout_vendor_id_check check (vendor_id ~ '^[A-Za-z0-9_-]{3,50}$');

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
    if v_id !~ '^[A-Za-z0-9_-]{3,50}$' then
      raise exception 'A Cashfree vendor ID uses only letters, numbers, - and _ (3 to 50 characters).';
    end if;
    insert into doctor_payout_accounts (doctor_id, vendor_id, updated_by)
    values (p_doctor_id, v_id, auth.uid())
    on conflict (doctor_id) do update
      set vendor_id = excluded.vendor_id, updated_at = now(), updated_by = auth.uid();
    perform write_audit_log('PAYOUT_ACCOUNT_CHANGED', 'doctor', p_doctor_id,
      jsonb_build_object('action', 'set', 'last4', right(v_id, 4)));
  end if;
end;
$$;

create or replace function admin_list_doctor_payouts()
returns table (doctor_id uuid, doctor_name text, fee_paise integer, account_last4 text)
language plpgsql security definer set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Admins only.';
  end if;
  return query
  select d.id, d.display_name, d.consultation_fee_paise, right(a.vendor_id, 4)
  from doctors d
  left join doctor_payout_accounts a on a.doctor_id = d.id
  where d.verification_status = 'APPROVED'
  order by d.display_name
  limit 200;
end;
$$;

-- 4. server-only helpers (parameter names changed, so drop first)
drop function if exists attach_razorpay_order(uuid, text, text);
create or replace function attach_gateway_order(
  p_order_id uuid, p_gateway_order_id text, p_split_method text
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update payment_orders
  set gateway_order_id = p_gateway_order_id, split_method = p_split_method
  where id = p_order_id and gateway_order_id is null and status = 'CREATED';

  if not found then
    raise exception 'Order not found or already attached.';
  end if;
end;
$$;
revoke all on function attach_gateway_order(uuid, text, text) from public, anon, authenticated;
grant execute on function attach_gateway_order(uuid, text, text) to service_role;

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

-- NOTE: platform_settings.route_enabled is reused as the "Easy Split on" switch. Leave it FALSE
-- until Cashfree has enabled Easy Split and doctors have vendor IDs.
   