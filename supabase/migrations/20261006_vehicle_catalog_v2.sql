-- Vehicle catalogue V2
--
-- Additive migration: the current vehicle_applications and wiper_length_fitments
-- tables remain available while callers are moved to the canonical catalogue.

create extension if not exists pgcrypto;

create table if not exists public.catalog_data_sources (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  source_kind text not null default 'catalogue',
  vehicle_identity_priority smallint not null default 100,
  product_fitment_priority smallint not null default 100,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_data_sources_kind_check check (
    source_kind in ('vehicle_catalogue', 'product_catalogue', 'market_reference', 'manual', 'legacy')
  ),
  constraint catalog_data_sources_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);

insert into public.catalog_data_sources (
  code,
  name,
  source_kind,
  vehicle_identity_priority,
  product_fitment_priority,
  metadata
)
values
  ('MACHTER_VEHICLE_CATALOG', 'Machter vehicle catalogue', 'vehicle_catalogue', 20, 100, '{"role":"vehicle_backbone"}'::jsonb),
  ('TOYOTA_NZ_MODEL_YEARS', 'Toyota NZ model years reference', 'market_reference', 10, 20, '{"market":"NZ"}'::jsonb),
  ('WIPER_MASTER', 'Wiper master catalogue', 'product_catalogue', 60, 30, '{"product_line":"wiper"}'::jsonb),
  ('CAT078', 'CAT078 wiper catalogue', 'product_catalogue', 80, 40, '{"product_line":"wiper"}'::jsonb),
  ('JP_KR_WIPER_TABLE', 'Japanese and Korean wiper table', 'product_catalogue', 60, 35, '{"product_line":"wiper"}'::jsonb)
on conflict (code) do update set
  name = excluded.name,
  source_kind = excluded.source_kind,
  vehicle_identity_priority = excluded.vehicle_identity_priority,
  product_fitment_priority = excluded.product_fitment_priority,
  metadata = excluded.metadata,
  updated_at = now();

create table if not exists public.catalog_import_batches (
  id uuid primary key default gen_random_uuid(),
  data_source_id uuid not null references public.catalog_data_sources(id) on delete restrict,
  source_file text not null,
  source_file_hash text,
  sheet_name text,
  import_status text not null default 'staged',
  row_count integer not null default 0 check (row_count >= 0),
  accepted_count integer not null default 0 check (accepted_count >= 0),
  review_count integer not null default 0 check (review_count >= 0),
  rejected_count integer not null default 0 check (rejected_count >= 0),
  imported_by text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint catalog_import_batches_status_check check (
    import_status in ('staged', 'parsed', 'review', 'published', 'failed', 'superseded')
  ),
  constraint catalog_import_batches_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);

create unique index if not exists catalog_import_batches_source_hash_uidx
  on public.catalog_import_batches(data_source_id, source_file_hash)
  where source_file_hash is not null;

create table if not exists public.catalog_source_records (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.catalog_import_batches(id) on delete cascade,
  sheet_name text not null default '',
  row_number integer not null check (row_number > 0),
  raw_values jsonb not null default '{}'::jsonb,
  normalized_values jsonb not null default '{}'::jsonb,
  parse_status text not null default 'pending',
  parse_notes text[] not null default '{}',
  source_record_hash text,
  created_at timestamptz not null default now(),
  constraint catalog_source_records_status_check check (
    parse_status in ('pending', 'accepted', 'review', 'rejected', 'skipped')
  ),
  constraint catalog_source_records_raw_object_check check (jsonb_typeof(raw_values) = 'object'),
  constraint catalog_source_records_normalized_object_check check (jsonb_typeof(normalized_values) = 'object'),
  unique (batch_id, sheet_name, row_number)
);

alter table public.fitment_import_batches
  add column if not exists data_source_id uuid references public.catalog_data_sources(id) on delete set null;

create table if not exists public.vehicle_generations (
  id uuid primary key default gen_random_uuid(),
  model_id uuid not null references public.vehicle_models(id) on delete cascade,
  name text not null,
  normalized_name text not null,
  year_start integer,
  year_end integer,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vehicle_generations_year_start_check check (year_start is null or year_start between 1886 and 2100),
  constraint vehicle_generations_year_end_check check (year_end is null or year_end between 1886 and 2100),
  constraint vehicle_generations_year_range_check check (year_start is null or year_end is null or year_end >= year_start),
  constraint vehicle_generations_metadata_object_check check (jsonb_typeof(metadata) = 'object'),
  unique (model_id, normalized_name)
);

create table if not exists public.vehicle_variants (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null references public.vehicle_generations(id) on delete cascade,
  name text not null,
  normalized_name text not null,
  body_style text not null default 'unknown',
  door_count smallint,
  engine_code text,
  drivetrain text,
  trim_name text,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vehicle_variants_body_style_check check (
    body_style in (
      'sedan', 'hatchback', 'wagon', 'suv', 'coupe', 'convertible',
      'ute', 'pickup', 'van', 'minivan', 'cab_chassis', 'bus', 'other', 'unknown'
    )
  ),
  constraint vehicle_variants_door_count_check check (door_count is null or door_count between 2 and 6),
  constraint vehicle_variants_metadata_object_check check (jsonb_typeof(metadata) = 'object'),
  unique (generation_id, normalized_name),
  unique (id, generation_id)
);

create table if not exists public.vehicle_chassis_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  normalized_code text not null unique,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vehicle_chassis_assignments (
  id uuid primary key default gen_random_uuid(),
  chassis_code_id uuid not null references public.vehicle_chassis_codes(id) on delete cascade,
  generation_id uuid not null references public.vehicle_generations(id) on delete cascade,
  variant_id uuid,
  is_primary boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  constraint vehicle_chassis_assignments_variant_generation_fkey
    foreign key (variant_id, generation_id)
    references public.vehicle_variants(id, generation_id)
    on delete cascade
);

create unique index if not exists vehicle_chassis_generation_uidx
  on public.vehicle_chassis_assignments(chassis_code_id, generation_id)
  where variant_id is null;

create unique index if not exists vehicle_chassis_variant_uidx
  on public.vehicle_chassis_assignments(chassis_code_id, generation_id, variant_id)
  where variant_id is not null;

create table if not exists public.vehicle_entity_aliases (
  id uuid primary key default gen_random_uuid(),
  data_source_id uuid not null references public.catalog_data_sources(id) on delete cascade,
  entity_type text not null,
  alias_kind text not null default 'name',
  alias_index smallint not null default 0,
  alias_scope_key text not null default '*',
  alias text not null,
  normalized_alias text not null,
  market text not null default '*',
  make_id uuid references public.vehicle_makes(id) on delete cascade,
  model_id uuid references public.vehicle_models(id) on delete cascade,
  generation_id uuid references public.vehicle_generations(id) on delete cascade,
  variant_id uuid references public.vehicle_variants(id) on delete cascade,
  chassis_code_id uuid references public.vehicle_chassis_codes(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint vehicle_entity_aliases_target_check check (
    num_nonnulls(make_id, model_id, generation_id, variant_id, chassis_code_id) = 1
    and (
      (entity_type = 'make' and make_id is not null)
      or (entity_type = 'model' and model_id is not null)
      or (entity_type = 'generation' and generation_id is not null)
      or (entity_type = 'variant' and variant_id is not null)
      or (entity_type = 'chassis' and chassis_code_id is not null)
    )
  ),
  constraint vehicle_entity_aliases_kind_check check (
    alias_kind in ('name', 'source_id', 'descriptor', 'chassis', 'other')
  ),
  unique (
    data_source_id,
    entity_type,
    alias_kind,
    alias_scope_key,
    normalized_alias,
    market,
    alias_index
  )
);

create table if not exists public.vehicle_fitment_applications (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null references public.vehicle_generations(id) on delete cascade,
  variant_id uuid,
  market text not null default 'NZ',
  steering_side text not null default 'RHD',
  year_start integer,
  month_start smallint,
  year_end integer,
  month_end smallint,
  fitment_status text not null default 'draft',
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vehicle_fitment_applications_variant_generation_fkey
    foreign key (variant_id, generation_id)
    references public.vehicle_variants(id, generation_id)
    on delete cascade,
  constraint vehicle_fitment_applications_steering_check check (
    steering_side in ('RHD', 'LHD', 'both', 'unknown')
  ),
  constraint vehicle_fitment_applications_status_check check (
    fitment_status in ('draft', 'review', 'published', 'rejected', 'superseded')
  ),
  constraint vehicle_fitment_applications_start_year_check check (
    year_start is null or year_start between 1886 and 2100
  ),
  constraint vehicle_fitment_applications_end_year_check check (
    year_end is null or year_end between 1886 and 2100
  ),
  constraint vehicle_fitment_applications_month_start_check check (
    month_start is null or month_start between 1 and 12
  ),
  constraint vehicle_fitment_applications_month_end_check check (
    month_end is null or month_end between 1 and 12
  ),
  constraint vehicle_fitment_applications_year_range_check check (
    year_start is null or year_end is null or year_end >= year_start
  ),
  constraint vehicle_fitment_applications_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);

create unique index if not exists vehicle_fitment_applications_identity_uidx
  on public.vehicle_fitment_applications (
    generation_id,
    coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid),
    market,
    steering_side,
    coalesce(year_start, -1),
    coalesce(month_start, -1),
    coalesce(year_end, -1),
    coalesce(month_end, -1)
  );

create table if not exists public.source_entity_mappings (
  id uuid primary key default gen_random_uuid(),
  source_record_id uuid not null references public.catalog_source_records(id) on delete cascade,
  entity_type text not null,
  mapping_index smallint not null default 0,
  mapping_status text not null default 'candidate',
  confidence numeric(5, 4) check (confidence is null or confidence between 0 and 1),
  make_id uuid references public.vehicle_makes(id) on delete cascade,
  model_id uuid references public.vehicle_models(id) on delete cascade,
  generation_id uuid references public.vehicle_generations(id) on delete cascade,
  variant_id uuid references public.vehicle_variants(id) on delete cascade,
  chassis_code_id uuid references public.vehicle_chassis_codes(id) on delete cascade,
  vehicle_application_id uuid references public.vehicle_fitment_applications(id) on delete cascade,
  match_reasons jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text,
  constraint source_entity_mappings_status_check check (
    mapping_status in ('candidate', 'approved', 'rejected', 'superseded')
  ),
  constraint source_entity_mappings_target_check check (
    num_nonnulls(make_id, model_id, generation_id, variant_id, chassis_code_id, vehicle_application_id) = 1
    and (
      (entity_type = 'make' and make_id is not null)
      or (entity_type = 'model' and model_id is not null)
      or (entity_type = 'generation' and generation_id is not null)
      or (entity_type = 'variant' and variant_id is not null)
      or (entity_type = 'chassis' and chassis_code_id is not null)
      or (entity_type = 'application' and vehicle_application_id is not null)
    )
  ),
  constraint source_entity_mappings_reasons_array_check check (jsonb_typeof(match_reasons) = 'array'),
  unique (source_record_id, entity_type, mapping_index)
);

create table if not exists public.wiper_sizes (
  position_scope text not null,
  length_in smallint not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (position_scope, length_in),
  constraint wiper_sizes_scope_check check (position_scope in ('front', 'rear')),
  constraint wiper_sizes_approved_lengths_check check (
    (position_scope = 'front' and length_in in (14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 26, 28, 30))
    or
    (position_scope = 'rear' and length_in in (8, 10, 11, 12, 13, 14, 15, 16))
  )
);

insert into public.wiper_sizes (position_scope, length_in)
select 'front', length_in
from unnest(array[14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 26, 28, 30]::smallint[]) as lengths(length_in)
on conflict (position_scope, length_in) do update set active = true;

insert into public.wiper_sizes (position_scope, length_in)
select 'rear', length_in
from unnest(array[8, 10, 11, 12, 13, 14, 15, 16]::smallint[]) as lengths(length_in)
on conflict (position_scope, length_in) do update set active = true;

-- NOT VALID preserves any historical anomalies for review while preventing
-- new legacy writes from introducing unsupported product sizes.
alter table public.wiper_length_fitments
  drop constraint if exists wiper_length_fitments_driver_approved_check,
  add constraint wiper_length_fitments_driver_approved_check
    check (driver_length_in is null or driver_length_in in (14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 26, 28, 30)) not valid,
  drop constraint if exists wiper_length_fitments_passenger_approved_check,
  add constraint wiper_length_fitments_passenger_approved_check
    check (passenger_length_in is null or passenger_length_in in (14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 26, 28, 30)) not valid,
  drop constraint if exists wiper_length_fitments_rear_approved_check,
  add constraint wiper_length_fitments_rear_approved_check
    check (rear_length_in is null or rear_length_in in (8, 10, 11, 12, 13, 14, 15, 16)) not valid;

alter table public.wiper_sets
  drop constraint if exists wiper_sets_driver_approved_check,
  add constraint wiper_sets_driver_approved_check
    check (driver_length_in in (14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 26, 28, 30)) not valid,
  drop constraint if exists wiper_sets_passenger_approved_check,
  add constraint wiper_sets_passenger_approved_check
    check (passenger_length_in in (14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 26, 28, 30)) not valid,
  drop constraint if exists wiper_sets_rear_approved_check,
  add constraint wiper_sets_rear_approved_check
    check (rear_length_in is null or rear_length_in in (8, 10, 11, 12, 13, 14, 15, 16)) not valid;

alter table public.wiper_rear_addons
  drop constraint if exists wiper_rear_addons_approved_check,
  add constraint wiper_rear_addons_approved_check
    check (rear_length_in in (8, 10, 11, 12, 13, 14, 15, 16)) not valid;

create table if not exists public.wiper_configurations (
  id uuid primary key default gen_random_uuid(),
  configuration_key text not null unique,
  name text,
  rear_status text not null default 'unknown',
  configuration_status text not null default 'draft',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wiper_configurations_rear_status_check check (
    rear_status in ('fitted', 'not_applicable', 'unknown', 'conflicting')
  ),
  constraint wiper_configurations_status_check check (
    configuration_status in ('draft', 'review', 'published', 'rejected', 'superseded')
  )
);

create table if not exists public.wiper_configuration_blades (
  id uuid primary key default gen_random_uuid(),
  wiper_configuration_id uuid not null references public.wiper_configurations(id) on delete cascade,
  position text not null,
  size_scope text generated always as (
    case when position = 'rear' then 'rear' else 'front' end
  ) stored,
  length_in smallint not null,
  connector_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wiper_configuration_blades_position_check check (
    position in ('driver', 'passenger', 'rear')
  ),
  constraint wiper_configuration_blades_size_fkey
    foreign key (size_scope, length_in)
    references public.wiper_sizes(position_scope, length_in)
    on delete restrict,
  unique (wiper_configuration_id, position)
);

create or replace function public.validate_wiper_configuration_rear()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_configuration_id uuid;
  v_rear_status text;
  v_rear_count integer;
begin
  if tg_table_name = 'wiper_configuration_blades' then
    v_configuration_id := coalesce(new.wiper_configuration_id, old.wiper_configuration_id);
  else
    v_configuration_id := coalesce(new.id, old.id);
  end if;

  select configuration.rear_status
  into v_rear_status
  from public.wiper_configurations configuration
  where configuration.id = v_configuration_id;

  if v_rear_status is null then
    return null;
  end if;

  select count(*)
  into v_rear_count
  from public.wiper_configuration_blades blade
  where blade.wiper_configuration_id = v_configuration_id
    and blade.position = 'rear';

  if v_rear_status = 'fitted' and v_rear_count <> 1 then
    raise exception 'A fitted rear wiper configuration must contain exactly one rear blade';
  end if;

  if v_rear_status <> 'fitted' and v_rear_count <> 0 then
    raise exception 'Rear blade must be absent unless rear_status is fitted';
  end if;

  return null;
end;
$$;

drop trigger if exists wiper_configuration_blades_validate_rear on public.wiper_configuration_blades;
create constraint trigger wiper_configuration_blades_validate_rear
after insert or update or delete on public.wiper_configuration_blades
deferrable initially deferred
for each row execute function public.validate_wiper_configuration_rear();

drop trigger if exists wiper_configurations_validate_rear on public.wiper_configurations;
create constraint trigger wiper_configurations_validate_rear
after insert or update on public.wiper_configurations
deferrable initially deferred
for each row execute function public.validate_wiper_configuration_rear();

create or replace function public.upsert_wiper_configuration(
  p_driver_length_in smallint,
  p_passenger_length_in smallint,
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
  v_configuration_key := concat(
    p_driver_length_in,
    '/',
    p_passenger_length_in,
    '/',
    coalesce(p_rear_length_in::text, '-')
  );

  insert into public.wiper_configurations (
    configuration_key,
    name,
    rear_status,
    configuration_status
  )
  values (
    v_configuration_key,
    'Wiper ' || v_configuration_key,
    case when p_rear_length_in is null then 'unknown' else 'fitted' end,
    'review'
  )
  on conflict (configuration_key) do update set
    updated_at = now()
  returning id into v_configuration_id;

  insert into public.wiper_configuration_blades (
    wiper_configuration_id,
    position,
    length_in
  )
  values
    (v_configuration_id, 'driver', p_driver_length_in),
    (v_configuration_id, 'passenger', p_passenger_length_in)
  on conflict (wiper_configuration_id, position) do update set
    length_in = excluded.length_in,
    updated_at = now();

  if p_rear_length_in is not null then
    insert into public.wiper_configuration_blades (
      wiper_configuration_id,
      position,
      length_in
    )
    values (v_configuration_id, 'rear', p_rear_length_in)
    on conflict (wiper_configuration_id, position) do update set
      length_in = excluded.length_in,
      updated_at = now();
  end if;

  return v_configuration_id;
end;
$$;

revoke all on function public.upsert_wiper_configuration(smallint, smallint, smallint) from public;
grant execute on function public.upsert_wiper_configuration(smallint, smallint, smallint) to service_role;

create table if not exists public.wiper_fitment_observations (
  id uuid primary key default gen_random_uuid(),
  source_record_id uuid not null references public.catalog_source_records(id) on delete cascade,
  observation_index smallint not null default 0 check (observation_index >= 0),
  vehicle_application_id uuid references public.vehicle_fitment_applications(id) on delete set null,
  wiper_configuration_id uuid references public.wiper_configurations(id) on delete set null,
  driver_length_in smallint,
  passenger_length_in smallint,
  rear_length_in smallint,
  rear_observation_status text not null default 'missing',
  observation_status text not null default 'parsed',
  raw_driver_value text,
  raw_passenger_value text,
  raw_rear_value text,
  notes text[] not null default '{}',
  created_at timestamptz not null default now(),
  constraint wiper_fitment_observations_driver_check check (
    driver_length_in is null or driver_length_in in (14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 26, 28, 30)
  ),
  constraint wiper_fitment_observations_passenger_check check (
    passenger_length_in is null or passenger_length_in in (14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 26, 28, 30)
  ),
  constraint wiper_fitment_observations_rear_check check (
    rear_length_in is null or rear_length_in in (8, 10, 11, 12, 13, 14, 15, 16)
  ),
  constraint wiper_fitment_observations_rear_status_check check (
    rear_observation_status in ('provided', 'missing', 'not_applicable', 'invalid')
  ),
  constraint wiper_fitment_observations_rear_consistency_check check (
    (rear_observation_status = 'provided' and rear_length_in is not null)
    or (rear_observation_status <> 'provided' and rear_length_in is null)
  ),
  constraint wiper_fitment_observations_status_check check (
    observation_status in ('parsed', 'review', 'accepted', 'rejected', 'superseded')
  ),
  unique (source_record_id, observation_index)
);

create table if not exists public.vehicle_wiper_fitments (
  id uuid primary key default gen_random_uuid(),
  vehicle_application_id uuid not null references public.vehicle_fitment_applications(id) on delete cascade,
  wiper_configuration_id uuid not null references public.wiper_configurations(id) on delete restrict,
  fitment_status text not null default 'draft',
  confidence numeric(5, 4) check (confidence is null or confidence between 0 and 1),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vehicle_wiper_fitments_status_check check (
    fitment_status in ('draft', 'review', 'published', 'rejected', 'superseded')
  ),
  unique (vehicle_application_id, wiper_configuration_id)
);

create unique index if not exists vehicle_wiper_fitments_one_published_uidx
  on public.vehicle_wiper_fitments(vehicle_application_id)
  where fitment_status = 'published';

create table if not exists public.vehicle_product_fitments (
  id uuid primary key default gen_random_uuid(),
  vehicle_application_id uuid not null references public.vehicle_fitment_applications(id) on delete cascade,
  product_variant_id uuid not null references public.product_variants(id) on delete cascade,
  position text not null default 'vehicle',
  fitment_status text not null default 'draft',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vehicle_product_fitments_status_check check (
    fitment_status in ('draft', 'review', 'published', 'rejected', 'superseded')
  ),
  unique (vehicle_application_id, product_variant_id, position)
);

create table if not exists public.fitment_review_queue (
  id uuid primary key default gen_random_uuid(),
  source_record_id uuid references public.catalog_source_records(id) on delete cascade,
  issue_type text not null,
  severity text not null default 'warning',
  review_status text not null default 'open',
  summary text not null,
  payload jsonb not null default '{}'::jsonb,
  resolution_notes text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fitment_review_queue_severity_check check (severity in ('info', 'warning', 'error')),
  constraint fitment_review_queue_status_check check (
    review_status in ('open', 'in_progress', 'resolved', 'dismissed')
  ),
  constraint fitment_review_queue_payload_object_check check (jsonb_typeof(payload) = 'object')
);

create table if not exists public.legacy_vehicle_application_map (
  legacy_vehicle_application_id uuid primary key references public.vehicle_applications(id) on delete cascade,
  vehicle_fitment_application_id uuid not null references public.vehicle_fitment_applications(id) on delete restrict,
  mapping_status text not null default 'review',
  confidence numeric(5, 4) check (confidence is null or confidence between 0 and 1),
  notes text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  constraint legacy_vehicle_application_map_status_check check (
    mapping_status in ('candidate', 'review', 'approved', 'rejected')
  )
);

alter table public.customer_vehicles
  add column if not exists vehicle_fitment_application_id uuid
    references public.vehicle_fitment_applications(id) on delete set null;

alter table public.order_items
  add column if not exists vehicle_fitment_application_id uuid
    references public.vehicle_fitment_applications(id) on delete set null;

alter table public.order_vehicle_snapshots
  add column if not exists vehicle_fitment_application_id uuid
    references public.vehicle_fitment_applications(id) on delete set null;

alter table public.order_wiper_fulfillment
  add column if not exists vehicle_fitment_application_id uuid
    references public.vehicle_fitment_applications(id) on delete set null;

create index if not exists vehicle_generations_model_idx
  on public.vehicle_generations(model_id, active);
create index if not exists vehicle_variants_generation_idx
  on public.vehicle_variants(generation_id, body_style, active);
create index if not exists vehicle_chassis_assignments_generation_idx
  on public.vehicle_chassis_assignments(generation_id, variant_id);
create index if not exists vehicle_entity_aliases_lookup_idx
  on public.vehicle_entity_aliases(entity_type, alias_scope_key, normalized_alias, market);
create index if not exists vehicle_fitment_applications_lookup_idx
  on public.vehicle_fitment_applications(market, generation_id, variant_id, year_start, year_end)
  where active = true;
create index if not exists source_entity_mappings_record_idx
  on public.source_entity_mappings(source_record_id, mapping_status);
create index if not exists wiper_fitment_observations_application_idx
  on public.wiper_fitment_observations(vehicle_application_id, observation_status);
create index if not exists vehicle_wiper_fitments_application_idx
  on public.vehicle_wiper_fitments(vehicle_application_id, fitment_status);
create index if not exists vehicle_product_fitments_application_idx
  on public.vehicle_product_fitments(vehicle_application_id, fitment_status);
create index if not exists fitment_review_queue_open_idx
  on public.fitment_review_queue(review_status, severity, created_at);
create index if not exists customer_vehicles_v2_application_idx
  on public.customer_vehicles(vehicle_fitment_application_id);
create index if not exists order_items_v2_application_idx
  on public.order_items(vehicle_fitment_application_id);

drop trigger if exists catalog_data_sources_set_updated_at on public.catalog_data_sources;
create trigger catalog_data_sources_set_updated_at
before update on public.catalog_data_sources
for each row execute function public.set_updated_at();

drop trigger if exists vehicle_generations_set_updated_at on public.vehicle_generations;
create trigger vehicle_generations_set_updated_at
before update on public.vehicle_generations
for each row execute function public.set_updated_at();

drop trigger if exists vehicle_variants_set_updated_at on public.vehicle_variants;
create trigger vehicle_variants_set_updated_at
before update on public.vehicle_variants
for each row execute function public.set_updated_at();

drop trigger if exists vehicle_chassis_codes_set_updated_at on public.vehicle_chassis_codes;
create trigger vehicle_chassis_codes_set_updated_at
before update on public.vehicle_chassis_codes
for each row execute function public.set_updated_at();

drop trigger if exists vehicle_fitment_applications_set_updated_at on public.vehicle_fitment_applications;
create trigger vehicle_fitment_applications_set_updated_at
before update on public.vehicle_fitment_applications
for each row execute function public.set_updated_at();

drop trigger if exists wiper_configurations_set_updated_at on public.wiper_configurations;
create trigger wiper_configurations_set_updated_at
before update on public.wiper_configurations
for each row execute function public.set_updated_at();

drop trigger if exists wiper_configuration_blades_set_updated_at on public.wiper_configuration_blades;
create trigger wiper_configuration_blades_set_updated_at
before update on public.wiper_configuration_blades
for each row execute function public.set_updated_at();

drop trigger if exists vehicle_wiper_fitments_set_updated_at on public.vehicle_wiper_fitments;
create trigger vehicle_wiper_fitments_set_updated_at
before update on public.vehicle_wiper_fitments
for each row execute function public.set_updated_at();

drop trigger if exists vehicle_product_fitments_set_updated_at on public.vehicle_product_fitments;
create trigger vehicle_product_fitments_set_updated_at
before update on public.vehicle_product_fitments
for each row execute function public.set_updated_at();

drop trigger if exists fitment_review_queue_set_updated_at on public.fitment_review_queue;
create trigger fitment_review_queue_set_updated_at
before update on public.fitment_review_queue
for each row execute function public.set_updated_at();

alter table public.catalog_data_sources enable row level security;
alter table public.catalog_import_batches enable row level security;
alter table public.catalog_source_records enable row level security;
alter table public.vehicle_generations enable row level security;
alter table public.vehicle_variants enable row level security;
alter table public.vehicle_chassis_codes enable row level security;
alter table public.vehicle_chassis_assignments enable row level security;
alter table public.vehicle_entity_aliases enable row level security;
alter table public.vehicle_fitment_applications enable row level security;
alter table public.source_entity_mappings enable row level security;
alter table public.wiper_sizes enable row level security;
alter table public.wiper_configurations enable row level security;
alter table public.wiper_configuration_blades enable row level security;
alter table public.wiper_fitment_observations enable row level security;
alter table public.vehicle_wiper_fitments enable row level security;
alter table public.vehicle_product_fitments enable row level security;
alter table public.fitment_review_queue enable row level security;
alter table public.legacy_vehicle_application_map enable row level security;

drop policy if exists "Public can read active vehicle generations" on public.vehicle_generations;
create policy "Public can read active vehicle generations"
  on public.vehicle_generations for select using (active = true);

drop policy if exists "Public can read active vehicle variants" on public.vehicle_variants;
create policy "Public can read active vehicle variants"
  on public.vehicle_variants for select using (active = true);

drop policy if exists "Public can read vehicle chassis codes" on public.vehicle_chassis_codes;
create policy "Public can read vehicle chassis codes"
  on public.vehicle_chassis_codes for select using (true);

drop policy if exists "Public can read vehicle chassis assignments" on public.vehicle_chassis_assignments;
create policy "Public can read vehicle chassis assignments"
  on public.vehicle_chassis_assignments for select using (true);

drop policy if exists "Public can read published vehicle applications" on public.vehicle_fitment_applications;
create policy "Public can read published vehicle applications"
  on public.vehicle_fitment_applications for select
  using (active = true and fitment_status = 'published');

drop policy if exists "Public can read active wiper sizes" on public.wiper_sizes;
create policy "Public can read active wiper sizes"
  on public.wiper_sizes for select using (active = true);

drop policy if exists "Public can read published wiper configurations" on public.wiper_configurations;
create policy "Public can read published wiper configurations"
  on public.wiper_configurations for select using (configuration_status = 'published');

drop policy if exists "Public can read published wiper blades" on public.wiper_configuration_blades;
create policy "Public can read published wiper blades"
  on public.wiper_configuration_blades for select
  using (
    exists (
      select 1
      from public.wiper_configurations configuration
      where configuration.id = wiper_configuration_blades.wiper_configuration_id
        and configuration.configuration_status = 'published'
    )
  );

drop policy if exists "Public can read published vehicle wiper fitments" on public.vehicle_wiper_fitments;
create policy "Public can read published vehicle wiper fitments"
  on public.vehicle_wiper_fitments for select using (fitment_status = 'published');

drop policy if exists "Public can read published vehicle product fitments" on public.vehicle_product_fitments;
create policy "Public can read published vehicle product fitments"
  on public.vehicle_product_fitments for select using (fitment_status = 'published');

comment on table public.vehicle_generations is
  'Canonical vehicle generations. Product catalogues must map to these records instead of creating alternate model identities.';
comment on table public.vehicle_variants is
  'Canonical body/trim variants. Sedan and hatchback remain separate because wiper fitment can differ.';
comment on table public.catalog_source_records is
  'Immutable source rows containing both raw input and normalized candidates for audit and reprocessing.';
comment on table public.wiper_fitment_observations is
  'Per-source wiper evidence. Only reviewed observations are promoted into published vehicle_wiper_fitments.';
comment on table public.legacy_vehicle_application_map is
  'Bridge used during dual-read/dual-write migration from source-specific vehicle_applications.';
