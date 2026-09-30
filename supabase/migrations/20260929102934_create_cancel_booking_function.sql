create or replace function cancel_booking(p_booking_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
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

  update bookings
  set status = 'CANCELLED',
      cancellation_reason = p_reason
  where id = p_booking_id;

  -- Token bookings free up no capacity retroactively (last_token_issued
  -- keeps counting up, so token numbers stay unique and meaningful even
  -- after a cancellation); this matches how real queues work.
end;
$$;

revoke all on function cancel_booking(uuid, text) from public;
grant execute on function cancel_booking(uuid, text) to authenticated;  