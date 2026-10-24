create or replace function add_session_to_confirmation()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  s record;
  v_name text;
  v_line text;
begin
  select cs.session_date, cs.start_time, cs.end_time, cs.block_label
  into s
  from bookings b
  join clinic_sessions cs on cs.id = b.session_id
  where b.id = new.booking_id;

  if not found then
    return new;
  end if;

  v_name := coalesce(
    nullif(s.block_label, ''),
    case
      when extract(hour from s.start_time) < 12 then 'Morning'
      when extract(hour from s.start_time) < 17 then 'Afternoon'
      when extract(hour from s.start_time) < 21 then 'Evening'
      else 'Night'
    end
  );

  v_line := to_char(s.session_date, 'Dy, FMDD Mon') || ' - ' || v_name
            || ' (' || to_char(date '2000-01-01' + s.start_time, 'FMHH12:MI AM')
            || ' - ' || to_char(date '2000-01-01' + s.end_time, 'FMHH12:MI AM') || ')';

  new.body := rtrim(new.body);
  if right(new.body, 1) not in ('.', '!') then
    new.body := new.body || '.';
  end if;
  new.body := new.body || ' Session: ' || v_line || '.';

  return new;
end;
$$;

drop trigger if exists add_session_to_confirmation on notifications;
create trigger add_session_to_confirmation
  before insert on notifications
  for each row
  when (new.type = 'BOOKING_CONFIRMED' and new.booking_id is not null)
  execute function add_session_to_confirmation();     