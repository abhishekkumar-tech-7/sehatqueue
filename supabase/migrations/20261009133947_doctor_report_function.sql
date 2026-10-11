create or replace function doctor_report(p_days integer default 7)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_doctor_id uuid;
  v_days integer := least(greatest(coalesce(p_days, 7), 1), 90);
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_since date;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'You must be logged in.';
  end if;

  select d.id into v_doctor_id from doctors d where d.profile_id = v_uid;
  if v_doctor_id is null then
    raise exception 'Doctors only.';
  end if;

  v_since := v_today - (v_days - 1);

  v_result := (
    with scoped as (
      select b.status::text as status,
             b.booking_mode::text as mode,
             b.patient_age,
             cs.session_date,
             b.patient_id::text || ':' || coalesce(lower(btrim(b.patient_name)), '') as person_key
      from bookings b
      join clinic_sessions cs on cs.id = b.session_id
      join doctor_clinics dc on dc.id = b.doctor_clinic_id
      where dc.doctor_id = v_doctor_id
    ),
    in_period as (
      select * from scoped where session_date between v_since and v_today
    ),
    active as (
      select * from in_period where status not in ('CANCELLED', 'EXPIRED')
    ),
    first_seen as (
      select s.person_key, min(s.session_date) as first_date
      from scoped s
      where s.status not in ('CANCELLED', 'EXPIRED')
      group by s.person_key
    )
    select jsonb_build_object(
      'days', v_days,
      'since', v_since,
      'total', (select count(*) from in_period),

      'by_status', (
        select coalesce(jsonb_object_agg(x.status, x.n), '{}'::jsonb)
        from (select status, count(*) as n from in_period group by status) x
      ),

      'by_mode', (
        select coalesce(jsonb_object_agg(x.mode, x.n), '{}'::jsonb)
        from (select mode, count(*) as n from in_period group by mode) x
      ),

      'per_day', (
        select coalesce(jsonb_agg(
                 jsonb_build_object('date', to_char(v_since + g.i, 'YYYY-MM-DD'), 'count', coalesce(c.n, 0))
                 order by g.i), '[]'::jsonb)
        from generate_series(0, v_days - 1) as g(i)
        left join (select session_date, count(*) as n from in_period group by session_date) c
          on c.session_date = v_since + g.i
      ),

      'patients', jsonb_build_object(
        'unique', (select count(distinct person_key) from active),
        'seen', (select count(distinct person_key) from in_period where status = 'COMPLETED'),
        'new', (select count(distinct a.person_key) from active a
                join first_seen f on f.person_key = a.person_key
                where f.first_date >= v_since),
        'returning', (select count(distinct a.person_key) from active a
                      join first_seen f on f.person_key = a.person_key
                      where f.first_date < v_since)
      ),

      'age_groups', (
        select coalesce(jsonb_object_agg(g.grp, g.n), '{}'::jsonb)
        from (
          select case
                   when patient_age is null then 'unknown'
                   when patient_age < 18 then '0-17'
                   when patient_age < 40 then '18-39'
                   when patient_age < 60 then '40-59'
                   else '60+'
                 end as grp,
                 count(*) as n
          from active
          group by 1
        ) g
      )
    )
  );

  return v_result;
end;
$$;

revoke all on function doctor_report(integer) from public;
grant execute on function doctor_report(integer) to authenticated;  