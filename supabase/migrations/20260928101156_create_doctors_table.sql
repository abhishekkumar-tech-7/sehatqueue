create type verification_status as enum ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED');

create table doctors (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references profiles(id) on delete cascade,
  display_name text not null,
  bio text,
  qualifications text,
  verification_status verification_status not null default 'PENDING',
  consultation_fee numeric(10,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_doctors_verification on doctors(verification_status);

create trigger set_updated_at
  before update on doctors
  for each row execute function update_updated_at_column();

alter table doctors enable row level security;

-- A doctor can always see their own record, even while pending.
create policy "Doctors can view their own record"
  on doctors for select
  using (profile_id = auth.uid());

-- Everyone (including logged-out visitors) can see APPROVED doctors only.
create policy "Public can view approved doctors"
  on doctors for select
  using (verification_status = 'APPROVED');

-- A doctor can edit only their own record...
create policy "Doctors can update their own record"
  on doctors for update
  using (profile_id = auth.uid());

-- ...and only these columns. Never verification_status or fee.
revoke insert, update, delete on doctors from authenticated, anon;
grant update (display_name, bio, qualifications) on doctors to authenticated;

-- Extend the signup trigger: DOCTOR signups also get a PENDING doctors row.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_role text := new.raw_user_meta_data ->> 'role';
  full_name_value text := coalesce(new.raw_user_meta_data ->> 'full_name', '');
begin
  insert into public.profiles (id, full_name, phone, email, role)
  values (
    new.id,
    full_name_value,
    new.raw_user_meta_data ->> 'phone',
    new.email,
    case when requested_role = 'DOCTOR'
      then 'DOCTOR'::user_role
      else 'PATIENT'::user_role
    end
  );

  if requested_role = 'DOCTOR' then
    insert into public.doctors (profile_id, display_name, qualifications)
    values (
      new.id,
      full_name_value,
      new.raw_user_meta_data ->> 'qualifications'
    );
  end if;

  return new;
end;
$$;  