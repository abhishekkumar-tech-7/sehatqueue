create type notification_type as enum (
  'BOOKING_CONFIRMED', 'BOOKING_CANCELLED', 'APPOINTMENT_REMINDER',
  'SESSION_CANCELLED', 'QUEUE_UPDATE'
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_profile_id uuid not null references profiles(id) on delete cascade,
  booking_id uuid references bookings(id) on delete set null,
  type notification_type not null,
  title text not null,
  body text not null,
  delivery_status text not null default 'SENT',
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_notifications_recipient on notifications(recipient_profile_id, created_at desc);

alter table notifications enable row level security;

create policy "Users can view their own notifications"
  on notifications for select
  using (recipient_profile_id = auth.uid());

create policy "Users can mark their own notifications as read"
  on notifications for update
  using (recipient_profile_id = auth.uid())
  with check (recipient_profile_id = auth.uid());

revoke insert, delete on notifications from authenticated, anon;
grant update (read_at) on notifications to authenticated;    