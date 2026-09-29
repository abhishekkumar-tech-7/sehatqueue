alter table doctors
  add column photo_url text,
  add column experience_years integer check (experience_years >= 0);

-- Doctors can update these themselves, same as bio and qualifications.
grant update (display_name, bio, qualifications, photo_url, experience_years)
  on doctors to authenticated; 