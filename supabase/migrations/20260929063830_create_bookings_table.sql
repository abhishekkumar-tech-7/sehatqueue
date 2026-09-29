create type booking_status as enum
  ('PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW', 'SKIPPED', 'EXPIRED');

create table bookings (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references profiles(id) on delete cascade,
  doctor_clinic_id uuid not null references doctor_clinics(id),
  session_id uuid not null references clinic_sessions(id),
  booking_mode booking_mode not null,
  token_number integer,
  appointment_start timestamptz,
  appointment_end timestamptz,
  status booking_status not null default 'CONFIRMED',
  booking_reference text not null unique,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A TOKEN booking must have a token number and no appointment time, and vice versa.
  check (
    (booking_mode = 'TOKEN' and token_number is not null and appointment_start is null)
    or
    (booking_mode = 'SLOT' and appointment_start is not null and token_number is null)
  )
);

-- A token number can never repeat within the same session.
create unique index idx_bookings_session_token
  on bookings(session_id, token_number)
  where token_number is not null;

-- One patient can only hold one active (not cancelled) booking per session.
create unique index idx_bookings_one_active_per_patient
  on bookings(patient_id, session_id)
  where status not in ('CANCELLED', 'EXPIRED');

create index idx_bookings_patient on bookings(patient_id);
create index idx_bookings_session on bookings(session_id);
create index idx_bookings_appointment_time on bookings(appointment_start);

create trigger set_updated_at
  before update on bookings
  for each row execute function update_updated_at_column();

alter table bookings enable row level security;

create policy "Patients can view their own bookings"
  on bookings for select
  using (patient_id = auth.uid());

create policy "Doctors can view bookings for their own sessions"
  on bookings for select
  using (
    doctor_clinic_id in (
      select dc.id from doctor_clinics dc
      join doctors d on d.id = dc.doctor_id
      where d.profile_id = auth.uid()
    )
  );

-- No direct writes. Only the functions below (which run with elevated
-- privilege) are allowed to create or change bookings.
revoke insert, update, delete on bookings from authenticated, anon; 