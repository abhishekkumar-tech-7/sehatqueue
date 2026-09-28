-- 1. Clients can no longer insert profiles directly; the trigger below does it.
drop policy if exists "Users can insert their own profile" on profiles;
revoke insert on profiles from authenticated, anon;

-- 2. Clients can only update safe columns (never role or is_active).
revoke update on profiles from authenticated, anon;
grant update (full_name, phone, email, preferred_language)
  on profiles to authenticated;

-- 3. Create the profile automatically on signup.
-- Only PATIENT or DOCTOR can be requested. ADMIN and RECEPTIONIST can never
-- be created from the public signup flow.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_role text := new.raw_user_meta_data ->> 'role';
begin
  insert into public.profiles (id, full_name, phone, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.raw_user_meta_data ->> 'phone',
    new.email,
    case when requested_role = 'DOCTOR'
      then 'DOCTOR'::user_role
      else 'PATIENT'::user_role
    end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user(); 