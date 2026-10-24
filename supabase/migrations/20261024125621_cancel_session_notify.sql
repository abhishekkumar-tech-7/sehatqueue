create or replace function cancel_session_notify(p_session_id uuid)
returns table (bookings_cancelled integer, refunds_started integer)
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_s clinic_sessions%rowtype;
  v_unpaid integer;
  v_paid integer;
  v_text text;
begin
  if v_uid is null then
    raise exception 'You must be logged in.';
  end if;

  select * into v_s from clinic_sessions where id = p_session_id for update;
  if v_s.id is null then
    raise exception 'This session does not exist.';
  end if;
  if not internal_can_manage(v_s.doctor_clinic_id, v_uid) then
    raise exception 'You do not manage this session.';
  end if;
  if v_s.status not in ('DRAFT', 'OPEN', 'PAUSED') then
    raise exception 'This session has already ended.';
  end if;

  -- Bookings still waiting for payment: expire them (a late payment is refunded automatically).
  update bookings set status = 'EXPIRED' where session_id = p_session_id and status = 'PENDING';

  select count(*) into v_paid from bookings b
  where b.session_id = p_session_id and b.payment_status = 'PAID'
    and b.status in ('CONFIRMED', 'ON_HOLD') and coalesce(b.amount_online_paise, 0) > 0;

  select count(*) into v_unpaid from bookings b
  where b.session_id = p_session_id and b.status in ('CONFIRMED', 'ON_HOLD')
    and b.payment_status in ('NOT_REQUIRED', 'PENDING', 'FAILED');

  v_text := 'Your session on ' || to_char(v_s.session_date, 'DD Mon YYYY')
            || ' has been cancelled by the clinic. Your booking has been cancelled.';

  with u as (
    update bookings set status = 'CANCELLED', cancellation_reason = 'Session cancelled by the clinic'
    where session_id = p_session_id and status in ('CONFIRMED', 'ON_HOLD')
      and payment_status in ('NOT_REQUIRED', 'PENDING', 'FAILED')
    returning id, patient_id
  )
  insert into notifications (recipient_profile_id, booking_id, type, title, body)
  select u.patient_id, u.id, 'BOOKING_CANCELLED'::notification_type, 'Booking Cancelled', v_text
  from u where u.patient_id is not null;

  -- The existing trigger cancels paid bookings, queues full refunds and notifies those patients.
  update clinic_sessions set status = 'CANCELLED' where id = p_session_id;

  perform write_audit_log('SESSION_CANCELLED', 'clinic_session', p_session_id,
    jsonb_build_object('unpaid_cancelled', v_unpaid, 'refunds', v_paid));

  return query select v_unpaid + v_paid, v_paid;
end;
$$;
revoke all on function cancel_session_notify(uuid) from public, anon;
grant execute on function cancel_session_notify(uuid) to authenticated;   