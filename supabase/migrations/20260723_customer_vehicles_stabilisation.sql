alter table public.customer_vehicles
  add column if not exists label text,
  add column if not exists is_default boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists customer_vehicles_profile_default_idx
  on public.customer_vehicles(customer_profile_id, is_default);

create unique index if not exists customer_vehicles_one_default_uidx
  on public.customer_vehicles(customer_profile_id)
  where is_default = true;

create unique index if not exists customer_vehicles_profile_application_year_uidx
  on public.customer_vehicles(customer_profile_id, vehicle_application_id, year)
  where customer_profile_id is not null and vehicle_application_id is not null;

drop trigger if exists customer_vehicles_set_updated_at on public.customer_vehicles;
create trigger customer_vehicles_set_updated_at
before update on public.customer_vehicles
for each row
execute function public.set_updated_at();

with ranked as (
  select
    id,
    row_number() over (
      partition by customer_profile_id
      order by last_used_at desc, created_at desc, id desc
    ) as position
  from public.customer_vehicles
  where customer_profile_id is not null
)
update public.customer_vehicles vehicle
set is_default = ranked.position = 1
from ranked
where vehicle.id = ranked.id
  and vehicle.is_default is distinct from (ranked.position = 1);

create or replace function public.save_customer_vehicle(
  p_auth_user_id uuid,
  p_vehicle_application_id uuid,
  p_year integer,
  p_label text default null,
  p_source text default 'fitment_lookup',
  p_is_default boolean default false
)
returns public.customer_vehicles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.customer_profiles%rowtype;
  v_application record;
  v_should_default boolean;
  v_vehicle public.customer_vehicles%rowtype;
begin
  select * into v_profile
  from public.customer_profiles
  where auth_user_id = p_auth_user_id;

  if v_profile.id is null then
    raise exception 'customer_profile_not_found';
  end if;

  select
    applications.id,
    makes.name as make_name,
    models.name as model_name,
    applications.year_start,
    applications.year_end
  into v_application
  from public.vehicle_applications applications
  join public.vehicle_makes makes on makes.id = applications.make_id
  join public.vehicle_models models on models.id = applications.model_id
  where applications.id = p_vehicle_application_id
    and applications.active = true
    and (applications.year_start is null or applications.year_start <= p_year)
    and (applications.year_end is null or applications.year_end >= p_year);

  if v_application.id is null then
    raise exception 'vehicle_application_not_found';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_profile.id::text));

  select (p_is_default or not exists (
    select 1 from public.customer_vehicles
    where customer_profile_id = v_profile.id
  )) into v_should_default;

  if v_should_default then
    update public.customer_vehicles
    set is_default = false
    where customer_profile_id = v_profile.id
      and is_default = true;
  end if;

  insert into public.customer_vehicles (
    customer_profile_id,
    auth_user_id,
    email,
    vehicle_application_id,
    make_snapshot,
    model_snapshot,
    year,
    label,
    source,
    is_default,
    last_used_at
  )
  values (
    v_profile.id,
    p_auth_user_id,
    lower(v_profile.email),
    p_vehicle_application_id,
    v_application.make_name,
    v_application.model_name,
    p_year,
    nullif(trim(p_label), ''),
    coalesce(nullif(trim(p_source), ''), 'fitment_lookup'),
    v_should_default,
    now()
  )
  on conflict (email, vehicle_application_id, year)
  do update set
    customer_profile_id = excluded.customer_profile_id,
    auth_user_id = excluded.auth_user_id,
    make_snapshot = excluded.make_snapshot,
    model_snapshot = excluded.model_snapshot,
    label = coalesce(excluded.label, public.customer_vehicles.label),
    source = excluded.source,
    is_default = case
      when excluded.is_default then true
      else public.customer_vehicles.is_default
    end,
    last_used_at = excluded.last_used_at,
    updated_at = now()
  returning * into v_vehicle;

  return v_vehicle;
end;
$$;

create or replace function public.set_default_customer_vehicle(
  p_auth_user_id uuid,
  p_vehicle_id uuid
)
returns public.customer_vehicles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_vehicle public.customer_vehicles%rowtype;
begin
  select id into v_profile_id
  from public.customer_profiles
  where auth_user_id = p_auth_user_id;

  if v_profile_id is null then
    raise exception 'customer_profile_not_found';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_profile_id::text));

  select * into v_vehicle
  from public.customer_vehicles
  where id = p_vehicle_id
    and customer_profile_id = v_profile_id;

  if v_vehicle.id is null then
    raise exception 'vehicle_not_found';
  end if;

  update public.customer_vehicles
  set is_default = false
  where customer_profile_id = v_profile_id
    and is_default = true
    and id <> p_vehicle_id;

  update public.customer_vehicles
  set is_default = true,
      last_used_at = now()
  where id = p_vehicle_id
  returning * into v_vehicle;

  return v_vehicle;
end;
$$;

create or replace function public.update_customer_vehicle(
  p_auth_user_id uuid,
  p_vehicle_id uuid,
  p_label text default null
)
returns public.customer_vehicles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_vehicle public.customer_vehicles%rowtype;
begin
  select id into v_profile_id
  from public.customer_profiles
  where auth_user_id = p_auth_user_id;

  if v_profile_id is null then
    raise exception 'customer_profile_not_found';
  end if;

  update public.customer_vehicles
  set label = nullif(trim(p_label), ''),
      updated_at = now()
  where id = p_vehicle_id
    and customer_profile_id = v_profile_id
  returning * into v_vehicle;

  if v_vehicle.id is null then
    raise exception 'vehicle_not_found';
  end if;

  return v_vehicle;
end;
$$;

create or replace function public.delete_customer_vehicle(
  p_auth_user_id uuid,
  p_vehicle_id uuid
)
returns table (
  deleted_vehicle_id uuid,
  replacement_default_vehicle_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_was_default boolean;
  v_replacement_id uuid;
begin
  select id into v_profile_id
  from public.customer_profiles
  where auth_user_id = p_auth_user_id;

  if v_profile_id is null then
    raise exception 'customer_profile_not_found';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_profile_id::text));

  select is_default into v_was_default
  from public.customer_vehicles
  where id = p_vehicle_id
    and customer_profile_id = v_profile_id;

  if v_was_default is null then
    raise exception 'vehicle_not_found';
  end if;

  delete from public.customer_vehicles
  where id = p_vehicle_id
    and customer_profile_id = v_profile_id;

  if v_was_default then
    select id into v_replacement_id
    from public.customer_vehicles
    where customer_profile_id = v_profile_id
    order by last_used_at desc, created_at desc, id desc
    limit 1;

    if v_replacement_id is not null then
      update public.customer_vehicles
      set is_default = true
      where id = v_replacement_id;
    end if;
  end if;

  return query select p_vehicle_id, v_replacement_id;
end;
$$;

drop policy if exists "Customers can read own vehicles" on public.customer_vehicles;
create policy "Customers can read own vehicles"
  on public.customer_vehicles for select
  to authenticated
  using (
    public.customer_profile_belongs_to_auth_user(customer_profile_id, auth.uid())
  );

drop policy if exists "Customers can insert own vehicles" on public.customer_vehicles;
create policy "Customers can insert own vehicles"
  on public.customer_vehicles for insert
  to authenticated
  with check (
    public.customer_profile_belongs_to_auth_user(customer_profile_id, auth.uid())
  );

drop policy if exists "Customers can update own vehicles" on public.customer_vehicles;
create policy "Customers can update own vehicles"
  on public.customer_vehicles for update
  to authenticated
  using (
    public.customer_profile_belongs_to_auth_user(customer_profile_id, auth.uid())
  )
  with check (
    public.customer_profile_belongs_to_auth_user(customer_profile_id, auth.uid())
  );

drop policy if exists "Customers can delete own vehicles" on public.customer_vehicles;
create policy "Customers can delete own vehicles"
  on public.customer_vehicles for delete
  to authenticated
  using (
    public.customer_profile_belongs_to_auth_user(customer_profile_id, auth.uid())
  );

revoke all on function public.save_customer_vehicle(uuid, uuid, integer, text, text, boolean) from public;
revoke all on function public.save_customer_vehicle(uuid, uuid, integer, text, text, boolean) from anon;
revoke all on function public.save_customer_vehicle(uuid, uuid, integer, text, text, boolean) from authenticated;
grant execute on function public.save_customer_vehicle(uuid, uuid, integer, text, text, boolean) to service_role;

revoke all on function public.set_default_customer_vehicle(uuid, uuid) from public;
revoke all on function public.set_default_customer_vehicle(uuid, uuid) from anon;
revoke all on function public.set_default_customer_vehicle(uuid, uuid) from authenticated;
grant execute on function public.set_default_customer_vehicle(uuid, uuid) to service_role;

revoke all on function public.update_customer_vehicle(uuid, uuid, text) from public;
revoke all on function public.update_customer_vehicle(uuid, uuid, text) from anon;
revoke all on function public.update_customer_vehicle(uuid, uuid, text) from authenticated;
grant execute on function public.update_customer_vehicle(uuid, uuid, text) to service_role;

revoke all on function public.delete_customer_vehicle(uuid, uuid) from public;
revoke all on function public.delete_customer_vehicle(uuid, uuid) from anon;
revoke all on function public.delete_customer_vehicle(uuid, uuid) from authenticated;
grant execute on function public.delete_customer_vehicle(uuid, uuid) to service_role;
