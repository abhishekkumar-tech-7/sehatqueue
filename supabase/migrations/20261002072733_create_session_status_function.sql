create or replace function update_session_status(p_session_id uuid, p_new_status session_status)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid := auth.uid();
  v_session clinic_sessions%rowtype;
  v_is_owner boolean;
begin
  if v_caller_id is null then
    raise exception 'You must be logged in.';
  end if;

  if p_new_status not in ('OPEN', 'PAUSED', 'CLOSED', 'CANCELLED') then
    raise exception 'Doctors cannot set this status directly.';
  end if;

  select * into v_session from clinic_sessions where id = p_session_id for update;

  if v_session.id is null then
    raise exception 'Session not found.';
  end if;

  select exists (
    select 1 from doctor_clinics dc
    join doctors d on d.id = dc.doctor_id
    where dc.id = v_session.doctor_clinic_id and d.profile_id = v_caller_id
  ) into v_is_owner;

  if not v_is_owner then
    raise exception 'You do not manage this session.';
  end if;

  if v_session.status in ('CLOSED', 'CANCELLED') then
    raise exception 'This session has already ended and cannot be changed.';
  end if;

  update clinic_sessions set status = p_new_status where id = p_session_id;
end;
$$;

revoke all on function update_session_status(uuid, session_status) from public;
grant execute on function update_session_status(uuid, session_status) to authenticated;  