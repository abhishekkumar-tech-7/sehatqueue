-- Per-doctor payment mode. A doctor with no row here uses the platform default.
create table if not exists doctor_payment_modes (
  doctor_id uuid primary key references doctors(id) on delete cascade,
  mode text not null check (mode in ('OFF', 'PLATFORM_FEE_ONLY', 'FULL')),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table doctor_payment_modes enable row level security;
revoke all on doctor_payment_modes from anon, authenticated;

create or replace function internal_payment_split(p_doctor_id uuid)
returns table (fee_consult integer, fee_platform integer, fee_total integer,
               fee_online integer, fee_clinic integer, fee_mode text)
language plpgsql security definer set search_path = public
as $$
declare
  v_c integer;
  v_p integer;
  v_t integer;
  v_mode text;
begin
  select q.consultation_paise, q.platform_paise, q.total_paise into v_c, v_p, v_t
  from internal_fee_quote(p_doctor_id) q;

  -- The doctor's own setting wins; otherwise the platform default.
  select coalesce(m.mode, s.online_payment_mode) into v_mode
  from platform_settings s
  left join doctor_payment_modes m on m.doctor_id = p_doctor_id
  where s.id;

  if v_t = 0 or v_mode = 'OFF' then
    return query select v_c, v_p, v_t, 0, v_t, 'OFF'::text;
  elsif v_mode = 'FULL' then
    if v_t < 100 then
      return query select v_c, v_p, v_t, 0, v_t, 'OFF'::text;
    else
      return query select v_c, v_p, v_t, v_t, 0, v_mode;
    end if;
  else
    if v_p < 100 then
      return query select v_c, v_p, v_t, 0, v_t, 'OFF'::text;
    else
      return query select v_c, v_p, v_t, v_p, v_c, v_mode;
    end if;
  end if;
end;
$$;

revoke all on function internal_payment_split(uuid) from public, anon, authenticated;
grant execute on function internal_payment_split(uuid) to service_role;

drop function if exists admin_list_doctor_payouts();
create or replace function admin_list_doctor_payouts()
returns table (doctor_id uuid, doctor_name text, fee_paise integer, vendor_id text, mode_override text)
language plpgsql security definer set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Admins only.';
  end if;
  return query
  select d.id, d.display_name, d.consultation_fee_paise, a.vendor_id, m.mode
  from doctors d
  left join doctor_payout_accounts a on a.doctor_id = d.id
  left join doctor_payment_modes m on m.doctor_id = d.id
  where d.verification_status = 'APPROVED'
  order by d.display_name
  limit 500;
end;
$$;

revoke all on function admin_list_doctor_payouts() from public, anon;
grant execute on function admin_list_doctor_payouts() to authenticated;

create or replace function admin_set_doctor_payment_mode(p_doctor_id uuid, p_mode text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_mode text := nullif(btrim(coalesce(p_mode, '')), '');
begin
  if not is_admin() then
    raise exception 'Admins only.';
  end if;
  if not exists (select 1 from doctors d where d.id = p_doctor_id) then
    raise exception 'Doctor not found.';
  end if;

  if v_mode is null or v_mode = 'DEFAULT' then
    delete from doctor_payment_modes where doctor_id = p_doctor_id;
    perform write_audit_log('DOCTOR_PAYMENT_MODE_CHANGED', 'doctor', p_doctor_id,
      jsonb_build_object('mode', 'DEFAULT'));
  else
    if v_mode not in ('OFF', 'PLATFORM_FEE_ONLY', 'FULL') then
      raise exception 'Invalid payment mode.';
    end if;
    insert into doctor_payment_modes (doctor_id, mode, updated_by)
    values (p_doctor_id, v_mode, auth.uid())
    on conflict (doctor_id) do update
      set mode = excluded.mode, updated_at = now(), updated_by = auth.uid();
    perform write_audit_log('DOCTOR_PAYMENT_MODE_CHANGED', 'doctor', p_doctor_id,
      jsonb_build_object('mode', v_mode));
  end if;
end;
$$;

revoke all on function admin_set_doctor_payment_mode(uuid, text) from public, anon;
grant execute on function admin_set_doctor_payment_mode(uuid, text) to authenticated;   