create or replace function admin_get_pending_doctors()
returns table (
  doctor_id uuid,
  doctor_name text,
  doctor_qualifications text,
  doctor_bio text,
  doctor_email text,
  doctor_phone text,
  registered_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Admins only.';
  end if;

  return query
  select d.id, d.display_name, d.qualifications, d.bio, p.email, p.phone, d.created_at
  from doctors d
  join profiles p on p.id = d.profile_id
  where d.verification_status = 'PENDING'
  order by d.created_at
  limit 100;
end;
$$;

revoke all on function admin_get_pending_doctors() from public;
grant execute on function admin_get_pending_doctors() to authenticated;  