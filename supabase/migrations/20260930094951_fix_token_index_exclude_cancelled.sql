drop index if exists idx_bookings_session_token;

-- A token number can only be "taken" by a booking that's still active.
-- A cancelled or expired booking frees the number for someone else.
create unique index idx_bookings_session_token
  on bookings(session_id, token_number)
  where token_number is not null and status not in ('CANCELLED', 'EXPIRED');  