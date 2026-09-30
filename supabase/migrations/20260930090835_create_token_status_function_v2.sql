create or replace function get_session_token_status(p_session_id uuid)
returns table (token_number integer, is_booked boolean, estimated_time timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session clinic_sessions%rowtype;
  v_session_start timestamptz;
begin
  select * into v_session from clinic_sessions where id = p_session_id;

  if v_session.id is null then
    raise exception 'Session not found.';
  end if;

  v_session_start := (v_session.session_date + v_session.start_time) at time zone 'Asia/Kolkata';

  return query
  select
    gs.n,
    exists (
      select 1 from bookings b
      where b.session_id = p_session_id
        and b.token_number = gs.n
        and b.status not in ('CANCELLED', 'EXPIRED')
    ),
    v_session_start + ((gs.n - 1) * v_session.avg_consultation_minutes) * interval '1 minute'
  from generate_series(1, v_session.capacity) as gs(n)
  order by gs.n;
end;
$$;

revoke all on function get_session_token_status(uuid) from public;
grant execute on function get_session_token_status(uuid) to authenticated;  