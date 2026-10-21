-- Final V5 cutover: remove the empty pre-V5 vehicle schema and its UUID bridge columns.
-- Full JSON backups were taken before this migration was applied.

begin;

drop function if exists public.save_customer_vehicle(uuid, uuid, integer, text, text, boolean);
drop function if exists public.save_customer_vehicle_v2(uuid, uuid, integer, text, text, boolean);

drop table if exists public.legacy_vehicle_application_map cascade;
drop table if exists public.vehicle_product_fitment_evidence cascade;
drop table if exists public.source_entity_mappings cascade;
drop table if exists public.wiper_fitment_observations cascade;
drop table if exists public.vehicle_wiper_fitments cascade;
drop table if exists public.vehicle_product_fitments cascade;
drop table if exists public.vehicle_fitment_applications cascade;
drop table if exists public.vehicle_entity_aliases cascade;
drop table if exists public.vehicle_chassis_assignments cascade;
drop table if exists public.vehicle_variants cascade;
drop table if exists public.vehicle_generations cascade;
drop table if exists public.vehicle_chassis_codes cascade;
drop table if exists public.wiper_connector_fitments cascade;
drop table if exists public.wiper_length_fitments cascade;
drop table if exists public.vehicle_applications cascade;
drop table if exists public.vehicle_models cascade;
drop table if exists public.vehicle_makes cascade;

alter table public.customer_vehicles
  drop column if exists vehicle_application_id,
  drop column if exists vehicle_fitment_application_id;

alter table public.order_items
  drop column if exists vehicle_application_id,
  drop column if exists vehicle_fitment_application_id;

alter table public.order_vehicle_snapshots
  drop column if exists vehicle_application_id,
  drop column if exists vehicle_fitment_application_id;

alter table public.order_wiper_fulfillment
  drop column if exists vehicle_application_id,
  drop column if exists vehicle_fitment_application_id;

create or replace function public.save_customer_vehicle_v5(
  p_auth_user_id uuid,
  p_vehicle_catalog_application_id text,
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
    applications.application_id,
    makes.name as make_name,
    models.name as model_name
  into v_application
  from public.vehicle_catalog_applications applications
  join public.vehicle_catalog_models models on models.model_id = applications.model_id
  join public.vehicle_catalog_makes makes on makes.make_id = models.make_id
  where applications.application_id = p_vehicle_catalog_application_id
    and exists (
      select 1
      from public.vehicle_catalog_application_years years
      where years.application_id = applications.application_id
        and years.model_year = p_year
    );

  if v_application.application_id is null then
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
    and vehicle_catalog_application_id = p_vehicle_catalog_application_id
    and year = p_year
  for update;

  if v_vehicle.id is null then
    insert into public.customer_vehicles (
      customer_profile_id,
      auth_user_id,
      email,
      vehicle_catalog_application_id,
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
      p_vehicle_catalog_application_id,
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

revoke all on function public.save_customer_vehicle_v5(uuid, text, integer, text, text, boolean) from public;
grant execute on function public.save_customer_vehicle_v5(uuid, text, integer, text, text, boolean) to service_role;

notify pgrst, 'reload schema';

commit;
