create table specialties (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  is_active boolean not null default true
);

create table clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null,
  locality text,
  city text not null,
  state text not null,
  postal_code text,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at
  before update on clinics
  for each row execute function update_updated_at_column();

create type relationship_status as enum ('PENDING', 'ACTIVE', 'INACTIVE');

create table doctor_clinics (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references doctors(id) on delete cascade,
  clinic_id uuid not null references clinics(id) on delete cascade,
  relationship_status relationship_status not null default 'PENDING',
  created_at timestamptz not null default now(),
  unique (doctor_id, clinic_id)
);

create table doctor_specialties (
  doctor_id uuid not null references doctors(id) on delete cascade,
  specialty_id uuid not null references specialties(id) on delete restrict,
  primary key (doctor_id, specialty_id)
);

create index idx_doctor_clinics_doctor on doctor_clinics(doctor_id);
create index idx_doctor_clinics_clinic on doctor_clinics(clinic_id);
create index idx_doctor_specialties_specialty on doctor_specialties(specialty_id);
create index idx_clinics_city on clinics(city);

alter table specialties enable row level security;
alter table clinics enable row level security;
alter table doctor_clinics enable row level security;
alter table doctor_specialties enable row level security;

-- Public reads: only active reference data, and only links for APPROVED doctors.
create policy "Public can view active specialties"
  on specialties for select using (is_active);

create policy "Public can view active clinics"
  on clinics for select using (is_active);

create policy "Public can view links of approved doctors (clinics)"
  on doctor_clinics for select
  using (
    relationship_status = 'ACTIVE'
    and exists (
      select 1 from doctors d
      where d.id = doctor_clinics.doctor_id and d.verification_status = 'APPROVED'
    )
  );

create policy "Doctors can view their own clinic links"
  on doctor_clinics for select
  using (doctor_id in (select id from doctors where profile_id = auth.uid()));

create policy "Public can view specialties of approved doctors"
  on doctor_specialties for select
  using (
    exists (
      select 1 from doctors d
      where d.id = doctor_specialties.doctor_id and d.verification_status = 'APPROVED'
    )
  );

create policy "Doctors can view their own specialties"
  on doctor_specialties for select
  using (doctor_id in (select id from doctors where profile_id = auth.uid()));

-- No writes from the app for now.
revoke insert, update, delete on specialties, clinics, doctor_clinics, doctor_specialties
  from authenticated, anon;

-- Reference data: the specialty list.
insert into specialties (name, slug) values
  ('General Physician', 'general-physician'),
  ('Pediatrician', 'pediatrician'),
  ('Gynecologist', 'gynecologist'),
  ('Dentist', 'dentist'),
  ('Dermatologist', 'dermatologist'),
  ('Orthopedic', 'orthopedic'),
  ('ENT Specialist', 'ent-specialist'),
  ('Eye Specialist', 'eye-specialist'),
  ('Cardiologist', 'cardiologist');  