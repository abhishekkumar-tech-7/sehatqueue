drop index if exists idx_bookings_one_active_per_patient;

-- Keep the one-booking limit for SLOT bookings only.
-- TOKEN bookings can have several per patient (e.g. booking for family members).
create unique index idx_bookings_one_active_slot_per_patient
  on bookings(patient_id, session_id)
  where status not in ('CANCELLED', 'EXPIRED') and booking_mode = 'SLOT'; 