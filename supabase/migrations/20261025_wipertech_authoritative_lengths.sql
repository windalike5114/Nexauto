-- Keep fitment knowledge independent from today's sellable wiper catalogue.
-- Product tables retain their own approved-size constraints; the fitment layer
-- may hold any credible WiperTech size, including partial front and rear-only data.

alter table public.wiper_sizes
  drop constraint if exists wiper_sizes_approved_lengths_check,
  drop constraint if exists wiper_sizes_source_lengths_check,
  add constraint wiper_sizes_source_lengths_check
    check (length_in between 5 and 40);

create table if not exists public.wipertech_length_observations (
  id uuid primary key default gen_random_uuid(),
  source_file text not null,
  source_file_hash text not null,
  source_row_number integer not null check (source_row_number > 1),
  make_name text,
  model_name text,
  chassis text,
  body_style text,
  year_from integer,
  year_to integer,
  driver_length_in smallint,
  passenger_length_in smallint,
  rear_length_in smallint,
  driver_blade_sku text,
  passenger_blade_sku text,
  rear_blade_sku text,
  variant_count integer,
  configuration_key text,
  wiper_configuration_id uuid references public.wiper_configurations(id) on delete set null,
  observation_status text not null default 'accepted',
  raw_values jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wipertech_length_observations_status_check check (observation_status in ('accepted', 'skipped')),
  constraint wipertech_length_observations_driver_check check (driver_length_in is null or driver_length_in between 5 and 40),
  constraint wipertech_length_observations_passenger_check check (passenger_length_in is null or passenger_length_in between 5 and 40),
  constraint wipertech_length_observations_rear_check check (rear_length_in is null or rear_length_in between 5 and 40),
  constraint wipertech_length_observations_year_check check (year_from is null or year_to is null or year_to >= year_from),
  constraint wipertech_length_observations_raw_check check (jsonb_typeof(raw_values) = 'object'),
  unique (source_file_hash, source_row_number)
);

create index if not exists wipertech_length_observations_vehicle_idx
  on public.wipertech_length_observations(make_name, model_name, year_from, year_to);

alter table public.wipertech_length_observations enable row level security;
revoke all on public.wipertech_length_observations from anon, authenticated;
grant all on public.wipertech_length_observations to service_role;

create or replace function public.upsert_partial_wiper_configuration(
  p_driver_length_in smallint default null,
  p_passenger_length_in smallint default null,
  p_rear_length_in smallint default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_configuration_id uuid;
  v_configuration_key text;
begin
  if num_nonnulls(p_driver_length_in, p_passenger_length_in, p_rear_length_in) = 0 then
    raise exception 'At least one wiper length is required';
  end if;
  if (p_driver_length_in is not null and p_driver_length_in not between 5 and 40)
    or (p_passenger_length_in is not null and p_passenger_length_in not between 5 and 40)
    or (p_rear_length_in is not null and p_rear_length_in not between 5 and 40) then
    raise exception 'Wiper lengths must be between 5 and 40 inches';
  end if;

  insert into public.wiper_sizes (position_scope, length_in, active)
  select distinct position_scope, length_in, true
  from (values
    ('front'::text, p_driver_length_in),
    ('front'::text, p_passenger_length_in),
    ('rear'::text, p_rear_length_in)
  ) as observed(position_scope, length_in)
  where length_in is not null
  on conflict (position_scope, length_in) do update set active = true;

  v_configuration_key := concat(
    coalesce(p_driver_length_in::text, '-'), '/',
    coalesce(p_passenger_length_in::text, '-'), '/',
    coalesce(p_rear_length_in::text, '-')
  );

  insert into public.wiper_configurations (
    configuration_key, name, rear_status, configuration_status, notes
  ) values (
    v_configuration_key,
    'Wiper ' || v_configuration_key,
    case when p_rear_length_in is null then 'unknown' else 'fitted' end,
    'review',
    'Supports authoritative source data with optional driver, passenger, and rear positions.'
  )
  on conflict (configuration_key) do update set updated_at = now()
  returning id into v_configuration_id;

  insert into public.wiper_configuration_blades (wiper_configuration_id, position, length_in)
  select v_configuration_id, position, length_in
  from (values
    ('driver'::text, p_driver_length_in),
    ('passenger'::text, p_passenger_length_in),
    ('rear'::text, p_rear_length_in)
  ) as blade(position, length_in)
  where length_in is not null
  on conflict (wiper_configuration_id, position) do update set
    length_in = excluded.length_in,
    updated_at = now();

  return v_configuration_id;
end;
$$;

revoke all on function public.upsert_partial_wiper_configuration(smallint, smallint, smallint) from public;
grant execute on function public.upsert_partial_wiper_configuration(smallint, smallint, smallint) to service_role;
