create or replace function update_my_clinic(
  p_clinic_id uuid,
  p_name text,
  p_address text,
  p_locality text,
  p_city text,
  p_state text,
  p_postal_code text,
  p_phone text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_old clinics%rowtype;
  v_name text := btrim(coalesce(p_name, ''));
  v_address text := btrim(coalesce(p_address, ''));
  v_locality text := nullif(btrim(coalesce(p_locality, '')), '');
  v_city text := btrim(coalesce(p_city, ''));
  v_state text := btrim(coalesce(p_state, ''));
  v_postal text := nullif(btrim(coalesce(p_postal_code, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_address_changed boolean;
begin
  if v_uid is null then
    raise exception 'You must be logged in.';
  end if;

  if not exists (
    select 1 from doctor_clinics dc
    join doctors d on d.id = dc.doctor_id
    where dc.clinic_id = p_clinic_id and d.profile_id = v_uid
  ) then
    raise exception 'You do not manage this clinic.';
  end if;

  if char_length(v_name) < 2 or char_length(v_name) > 80 then
    raise exception 'Clinic name must be 2 to 80 characters.';
  end if;
  if char_length(v_address) < 5 or char_length(v_address) > 200 then
    raise exception 'Address must be 5 to 200 characters.';
  end if;
  if v_locality is not null and char_length(v_locality) > 80 then
    raise exception 'Locality is too long.';
  end if;
  if char_length(v_city) < 2 or char_length(v_city) > 60 then
    raise exception 'City must be 2 to 60 characters.';
  end if;
  if char_length(v_state) < 2 or char_length(v_state) > 60 then
    raise exception 'State must be 2 to 60 characters.';
  end if;
  if v_postal is not null and v_postal !~ '^\d{6}$' then
    raise exception 'Postal code must be 6 digits.';
  end if;
  if v_phone is not null and v_phone !~ '^[0-9+ -]{5,15}$' then
    raise exception 'Enter a valid clinic phone number.';
  end if;

  select * into v_old from clinics where id = p_clinic_id for update;
  if v_old.id is null then
    raise exception 'Clinic not found.';
  end if;

  v_address_changed :=
    (v_old.address, v_old.locality, v_old.city, v_old.state, v_old.postal_code)
    is distinct from
    (v_address, v_locality, v_city, v_state, v_postal);

  update clinics
  set name = v_name,
      address = v_address,
      locality = v_locality,
      city = v_city,
      state = v_state,
      postal_code = v_postal,
      phone = v_phone,
      -- A changed address makes the old map coordinates wrong, so clear them.
      latitude = case when v_address_changed then null else latitude end,
      longitude = case when v_address_changed then null else longitude end
  where id = p_clinic_id;
end;
$$;

revoke all on function update_my_clinic(uuid, text, text, text, text, text, text, text) from public;
grant execute on function update_my_clinic(uuid, text, text, text, text, text, text, text) to authenticated;

-- Record clinic edits in the audit log (details only, no coordinates).
create or replace function audit_clinic_update_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform write_audit_log('CLINIC_UPDATED', 'clinic', new.id,
    jsonb_build_object(
      'name', new.name,
      'address_changed',
        (old.address, old.locality, old.city, old.state, old.postal_code)
        is distinct from
        (new.address, new.locality, new.city, new.state, new.postal_code)));
  return new;
end;
$$;

create trigger audit_clinics_update
  after update on clinics
  for each row
  when ((old.name, old.address, old.locality, old.city, old.state, old.postal_code, old.phone)
        is distinct from
        (new.name, new.address, new.locality, new.city, new.state, new.postal_code, new.phone))
  execute function audit_clinic_update_trg();   