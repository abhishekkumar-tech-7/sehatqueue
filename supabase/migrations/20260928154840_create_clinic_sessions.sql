create type booking_mode as enum ('TOKEN', 'SLOT');
create type session_status as enum ('DRAFT', 'OPEN', 'PAUSED', 'CLOSED', 'CANCELLED');

create table clinic_sessions (
  id uuid primary key default gen_random_uuid(),
  doctor_clinic_id uuid not null references doctor_clinics(id) on delete cascade,
  -- Date and times are in the clinic's local time (India, IST).
  session_date date not null,
  start_time time not null,
  end_time time not null,
  booking_mode booking_mode not null,
  capacity integer not null check (capacity > 0),
  status session_status not null default 'DRAFT',
  current_token integer not null default 0 check (current_token >= 0),
  last_token_issued integer not null default 0 check (last_token_issued >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time > start_time),
  unique (doctor_clinic_id, session_date, start_time)
);

create index idx_sessions_date_status on clinic_sessions(session_date, status);
create index idx_sessions_doctor_clinic on clinic_sessions(doctor_clinic_id);

create trigger set_updated_at
  before update on clinic_sessions
  for each row execute function update_updated_at_column();

alter table clinic_sessions enable row level security;

-- Anyone can see OPEN sessions of approved doctors at active links.
create policy "Public can view open sessions"
  on clinic_sessions for select
  using (
    status = 'OPEN'
    and exists (
      select 1
      from doctor_clinics dc
      join doctors d on d.id = dc.doctor_id
      where dc.id = clinic_sessions.doctor_clinic_id
        and dc.relationship_status = 'ACTIVE'
        and d.verification_status = 'APPROVED'
    )
  );

-- Doctors can see all of their own sessions, whatever the status.
create policy "Doctors can view their own sessions"
  on clinic_sessions for select
  using (
    doctor_clinic_id in (
      select dc.id from doctor_clinics dc
      join doctors d on d.id = dc.doctor_id
      where d.profile_id = auth.uid()
    )
  );

-- No direct writes. Session management comes with the clinic dashboard.
revoke insert, update, delete on clinic_sessions from authenticated, anon;  