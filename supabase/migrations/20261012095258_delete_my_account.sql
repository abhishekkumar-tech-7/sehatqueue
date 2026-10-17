create or replace function delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
begin
  if v_uid is null then
    raise exception 'You must be logged in.';
  end if;

  select role::text into v_role from profiles where id = v_uid;

  if v_role is null then
    raise exception 'Account not found.';
  end if;

  if v_role not in ('PATIENT', 'RECEPTIONIST') then
    raise exception 'This type of account cannot be deleted in the app. Please use the deletion request page.';
  end if;

  -- One minimal record: anonymous id, role, time. No names or contact details.
  perform write_audit_log('ACCOUNT_DELETED', 'profile', v_uid, jsonb_build_object('role', v_role));

  -- Deleting the login removes the profile, bookings, notifications and staff
  -- links through the foreign keys set up earlier.
  delete from auth.users where id = v_uid;
end;
$$;

revoke all on function delete_my_account() from public, anon;
grant execute on function delete_my_account() to authenticated;   