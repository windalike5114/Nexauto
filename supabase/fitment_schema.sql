create extension if not exists pgcrypto;

create table if not exists fitment_import_batches (
  id uuid primary key default gen_random_uuid(),
  source_name text not null,
  source_file text,
  category_slug text references categories(slug),
  imported_by text,
  row_count integer not null default 0,
  parsed_count integer not null default 0,
  skipped_count integer not null default 0,
  error_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists fitment_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references fitment_import_batches(id) on delete cascade,
  row_number integer not null,
  raw_values jsonb not null default '{}'::jsonb,
  detected_row_type text not null,
  parse_status text not null default 'pending',
  parse_notes text[] not null default '{}',
  parsed_values jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (batch_id, row_number),
  constraint fitment_import_rows_status_check check (parse_status in ('ok', 'skipped', 'warning', 'error'))
);

create table if not exists vehicle_makes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  normalized_name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists vehicle_models (
  id uuid primary key default gen_random_uuid(),
  make_id uuid not null references vehicle_makes(id) on delete cascade,
  name text not null,
  normalized_name text not null,
  created_at timestamptz not null default now(),
  unique (make_id, normalized_name)
);

create table if not exists vehicle_applications (
  id uuid primary key default gen_random_uuid(),
  make_id uuid not null references vehicle_makes(id) on delete cascade,
  model_id uuid not null references vehicle_models(id) on delete cascade,
  market text not null default 'NZ',
  year_start integer,
  month_start integer check (month_start between 1 and 12),
  year_end integer,
  month_end integer check (month_end between 1 and 12),
  start_raw text,
  end_raw text,
  source_name text not null default 'unknown',
  source_row_id uuid references fitment_import_rows(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (make_id, model_id, market, year_start, month_start, year_end, month_end, source_name)
);

create table if not exists wiper_length_fitments (
  id uuid primary key default gen_random_uuid(),
  vehicle_application_id uuid not null references vehicle_applications(id) on delete cascade,
  driver_length_in numeric(4, 1),
  passenger_length_in numeric(4, 1),
  rear_length_in numeric(4, 1),
  driver_length_source text,
  passenger_length_source text,
  rear_length_source text,
  source_name text not null default 'unknown',
  source_row_id uuid references fitment_import_rows(id) on delete set null,
  notes text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (vehicle_application_id, source_name)
);

create table if not exists wiper_connector_fitments (
  id uuid primary key default gen_random_uuid(),
  vehicle_application_id uuid not null references vehicle_applications(id) on delete cascade,
  position text not null check (position in ('driver', 'passenger', 'rear')),
  connector_type text not null,
  source_name text not null default 'unknown',
  source_row_id uuid references fitment_import_rows(id) on delete set null,
  notes text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (vehicle_application_id, position, connector_type, source_name)
);

create index if not exists fitment_import_rows_batch_status_idx
  on fitment_import_rows(batch_id, parse_status);
create index if not exists vehicle_applications_lookup_idx
  on vehicle_applications(market, make_id, model_id, year_start, year_end);
create index if not exists wiper_length_fitments_application_idx
  on wiper_length_fitments(vehicle_application_id);
create index if not exists wiper_connector_fitments_application_idx
  on wiper_connector_fitments(vehicle_application_id);

alter table fitment_import_batches enable row level security;
alter table fitment_import_rows enable row level security;
alter table vehicle_makes enable row level security;
alter table vehicle_models enable row level security;
alter table vehicle_applications enable row level security;
alter table wiper_length_fitments enable row level security;
alter table wiper_connector_fitments enable row level security;

drop policy if exists "Public can read vehicle makes" on vehicle_makes;
create policy "Public can read vehicle makes"
  on vehicle_makes for select
  using (true);

drop policy if exists "Public can read vehicle models" on vehicle_models;
create policy "Public can read vehicle models"
  on vehicle_models for select
  using (true);

drop policy if exists "Public can read active vehicle applications" on vehicle_applications;
create policy "Public can read active vehicle applications"
  on vehicle_applications for select
  using (active = true);

drop policy if exists "Public can read wiper length fitments" on wiper_length_fitments;
create policy "Public can read wiper length fitments"
  on wiper_length_fitments for select
  using (
    exists (
      select 1 from vehicle_applications
      where vehicle_applications.id = wiper_length_fitments.vehicle_application_id
      and vehicle_applications.active = true
    )
  );

drop policy if exists "Public can read wiper connector fitments" on wiper_connector_fitments;
create policy "Public can read wiper connector fitments"
  on wiper_connector_fitments for select
  using (
    exists (
      select 1 from vehicle_applications
      where vehicle_applications.id = wiper_connector_fitments.vehicle_application_id
      and vehicle_applications.active = true
    )
  );
