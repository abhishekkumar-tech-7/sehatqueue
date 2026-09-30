alter table clinic_sessions
  add column if not exists avg_consultation_minutes integer not null default 5
  check (avg_consultation_minutes > 0);  