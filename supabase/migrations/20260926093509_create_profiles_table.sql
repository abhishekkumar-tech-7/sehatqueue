-- Create an enum type for user roles.
-- Using an enum (instead of plain text) means the database itself
-- rejects any invalid role value — nobody can accidentally insert "SUPERADMIN".
create type user_role as enum ('PATIENT', 'DOCTOR', 'RECEPTIONIST', 'ADMIN');

-- The profiles table extends Supabase's built-in auth.users table.
-- We reuse the same UUID as the primary key, so every authenticated
-- user has exactly one matching profile row.
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone text,
  email text,
  role user_role not null default 'PATIENT',
  preferred_language text not null default 'en',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Index on role, since we'll frequently query "all doctors" or "all admins".
create index idx_profiles_role on profiles(role);

-- Enable Row Level Security. Without this, RLS policies are ignored
-- and the table would behave as if fully open — we never want that.
alter table profiles enable row level security;

-- Policy: a user can read their own profile.
create policy "Users can view their own profile"
  on profiles for select
  using (auth.uid() = id);

-- Policy: a user can update their own profile,
-- but we'll restrict which columns via the app layer later
-- (e.g. they shouldn't be able to change their own role to ADMIN).
create policy "Users can update their own profile"
  on profiles for update
  using (auth.uid() = id);

-- Policy: a user can insert their own profile row
-- (this happens right after they sign up).
create policy "Users can insert their own profile"
  on profiles for insert
  with check (auth.uid() = id);

-- Automatically keep updated_at current whenever a row changes.
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_updated_at
  before update on profiles
  for each row
  execute function update_updated_at_column();