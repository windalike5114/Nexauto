-- NexAuto application bridge for canonical vehicle fitments.
-- Keeps legacy garage records working while allowing published V2 applications.

alter table public.customer_vehicles
  alter column vehicle_application_id drop not null;

create unique index if not exists customer_vehicles_profile_v2_application_year_uidx
  on public.customer_vehicles(customer_profile_id, vehicle_fitment_application_id, year)
  where customer_profile_id is not null and vehicle_fitment_application_id is not null;

create unique index if not exists customer_vehicles_email_v2_application_year_uidx
  on public.customer_vehicles(email, vehicle_fitment_application_id, year)
  where vehicle_fitment_application_id is not null;

create or replace function public.save_customer_vehicle_v2(
  p_auth_user_id uuid,
  p_vehicle_fitment_application_id uuid,
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
  from public.vehicle_fitment_applications applications
  join public.vehicle_generations generations on generations.id = applications.generation_id
  join public.vehicle_models models on models.id = generations.model_id
  join public.vehicle_makes makes on makes.id = models.make_id
  where applications.id = p_vehicle_fitment_application_id
    and applications.active = true
    and applications.fitment_status = 'published'
    and generations.active = true
    and (applications.year_start is null or applications.year_start <= p_year)
    and (applications.year_end is null or applications.year_end >= p_year)
    and exists (
      select 1
      from public.vehicle_wiper_fitments fitments
      join public.wiper_configurations configurations
        on configurations.id = fitments.wiper_configuration_id
      where fitments.vehicle_application_id = applications.id
        and fitments.fitment_status = 'published'
        and configurations.configuration_status = 'published'
    );

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

  select * into v_vehicle
  from public.customer_vehicles
  where customer_profile_id = v_profile.id
    and vehicle_fitment_application_id = p_vehicle_fitment_application_id
    and year = p_year
  for update;

  if v_vehicle.id is null then
    insert into public.customer_vehicles (
      customer_profile_id,
      auth_user_id,
      email,
      vehicle_application_id,
      vehicle_fitment_application_id,
      make_snapshot,
      model_snapshot,
      year,
      label,
      source,
      is_default,
      last_used_at
    ) values (
      v_profile.id,
      p_auth_user_id,
      lower(v_profile.email),
      null,
      p_vehicle_fitment_application_id,
      v_application.make_name,
      v_application.model_name,
      p_year,
      nullif(trim(p_label), ''),
      coalesce(nullif(trim(p_source), ''), 'fitment_lookup'),
      v_should_default,
      now()
    ) returning * into v_vehicle;
  else
    update public.customer_vehicles
    set
      auth_user_id = p_auth_user_id,
      email = lower(v_profile.email),
      make_snapshot = v_application.make_name,
      model_snapshot = v_application.model_name,
      label = coalesce(nullif(trim(p_label), ''), label),
      source = coalesce(nullif(trim(p_source), ''), 'fitment_lookup'),
      is_default = case when v_should_default then true else is_default end,
      last_used_at = now(),
      updated_at = now()
    where id = v_vehicle.id
    returning * into v_vehicle;
  end if;

  return v_vehicle;
end;
$$;

revoke all on function public.save_customer_vehicle_v2(uuid, uuid, integer, text, text, boolean) from public;
grant execute on function public.save_customer_vehicle_v2(uuid, uuid, integer, text, text, boolean) to service_role;
