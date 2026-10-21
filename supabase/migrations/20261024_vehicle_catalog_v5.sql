-- Clean V5 vehicle catalogue. Source package IDs remain stable text keys.
create table if not exists public.vehicle_catalog_releases (
  release_id text primary key,
  package_sha256 text not null unique,
  source_name text not null,
  imported_at timestamptz not null default now(),
  counts jsonb not null default '{}'::jsonb,
  active boolean not null default false
);
create unique index if not exists vehicle_catalog_one_active_release_idx on public.vehicle_catalog_releases (active) where active;

create table if not exists public.vehicle_catalog_makes (
  make_id text primary key check (make_id ~ '^mk_[0-9a-f]{20}$'), name text not null,
  normalized_name text not null unique, status text not null default 'active'
);
create table if not exists public.vehicle_catalog_models (
  model_id text primary key check (model_id ~ '^md_[0-9a-f]{20}$'),
  make_id text not null references public.vehicle_catalog_makes(make_id) on delete cascade,
  name text not null, normalized_name text not null, status text not null default 'active', unique (make_id, normalized_name)
);
create table if not exists public.vehicle_catalog_series (
  series_id text primary key check (series_id ~ '^sr_[0-9a-f]{20}$'),
  model_id text not null references public.vehicle_catalog_models(model_id) on delete cascade,
  code text not null, normalized_code text not null, display_name text not null,
  status text not null default 'active', unique (model_id, normalized_code)
);
create table if not exists public.vehicle_catalog_variants (
  variant_id text primary key check (variant_id ~ '^vr_[0-9a-f]{20}$'),
  raw_name text not null, normalized_name text not null unique, display_name text not null,
  body_style text, drive_type text, axle_configuration text, gross_weight_ton numeric,
  vehicle_class text, parse_status text not null
);
create table if not exists public.vehicle_catalog_powertrains (
  powertrain_id text primary key check (powertrain_id ~ '^pt_[0-9a-f]{20}$'),
  make_id text not null references public.vehicle_catalog_makes(make_id) on delete cascade,
  raw_name text not null, normalized_name text not null, display_name text not null, short_display_name text not null,
  powertrain_type text, displacement_cc integer, fuel_type text, induction_type text,
  cylinder_layout text, cylinder_count integer, valve_count integer, injection_type text,
  emission_standard text, parse_status text not null, unique (make_id, normalized_name)
);
create table if not exists public.vehicle_catalog_engine_codes (
  engine_code_id text primary key check (engine_code_id ~ '^ec_[0-9a-f]{20}$'),
  make_id text not null references public.vehicle_catalog_makes(make_id) on delete cascade,
  code text not null, normalized_code text not null, unique (make_id, normalized_code)
);
create table if not exists public.vehicle_catalog_powertrain_engine_codes (
  powertrain_id text not null references public.vehicle_catalog_powertrains(powertrain_id) on delete cascade,
  engine_code_id text not null references public.vehicle_catalog_engine_codes(engine_code_id) on delete cascade,
  is_primary boolean not null default false, primary key (powertrain_id, engine_code_id)
);
create table if not exists public.vehicle_catalog_applications (
  application_id text primary key check (application_id ~ '^ap_[0-9a-f]{20}$'),
  model_id text not null references public.vehicle_catalog_models(model_id) on delete cascade,
  series_id text references public.vehicle_catalog_series(series_id) on delete restrict,
  variant_id text not null references public.vehicle_catalog_variants(variant_id) on delete restrict,
  powertrain_id text not null references public.vehicle_catalog_powertrains(powertrain_id) on delete restrict,
  year_from integer not null check (year_from between 1886 and 2100),
  year_to integer not null check (year_to between year_from and 2100),
  year_status text not null default 'observed_range', canonical_key text not null unique,
  status text not null default 'active', review_status text not null default 'unreviewed'
);
create table if not exists public.vehicle_catalog_application_years (
  application_id text not null references public.vehicle_catalog_applications(application_id) on delete cascade,
  model_year integer not null check (model_year between 1886 and 2100), primary key (application_id, model_year)
);
create table if not exists public.vehicle_catalog_application_provenance (
  application_id text not null references public.vehicle_catalog_applications(application_id) on delete cascade,
  source_group text not null, source_url text not null, raw_record_count integer not null check (raw_record_count >= 0),
  first_collected_at timestamptz, last_collected_at timestamptz,
  primary key (application_id, source_group, source_url)
);
create table if not exists public.vehicle_catalog_review_issues (
  issue_id text primary key check (issue_id ~ '^is_[0-9a-f]{20}$'), entity_type text not null,
  entity_id text not null, issue_code text not null, severity text not null, details text
);
create table if not exists public.vehicle_catalog_source_failures (
  failure_id text primary key check (failure_id ~ '^fl_[0-9a-f]{20}$'), source_group text not null,
  occurred_at timestamptz, make_name text, model_name text, model_year integer, failure_kind text, message text
);

create table if not exists public.vehicle_catalog_product_fitments (
  application_id text not null references public.vehicle_catalog_applications(application_id) on delete cascade,
  product_variant_id uuid not null references public.product_variants(id) on delete cascade,
  position text not null default 'vehicle',
  fitment_status text not null default 'published' check (fitment_status in ('draft','review','published','rejected')),
  source text, notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (application_id, product_variant_id, position)
);
create table if not exists public.vehicle_catalog_wiper_fitments (
  application_id text not null references public.vehicle_catalog_applications(application_id) on delete cascade,
  wiper_configuration_id uuid not null references public.wiper_configurations(id) on delete cascade,
  fitment_status text not null default 'published' check (fitment_status in ('draft','review','published','rejected')),
  source text, notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (application_id, wiper_configuration_id)
);

create index if not exists vehicle_catalog_models_make_idx on public.vehicle_catalog_models(make_id, normalized_name);
create index if not exists vehicle_catalog_series_model_idx on public.vehicle_catalog_series(model_id, normalized_code);
create index if not exists vehicle_catalog_apps_model_idx on public.vehicle_catalog_applications(model_id, year_from, year_to);
create index if not exists vehicle_catalog_apps_series_idx on public.vehicle_catalog_applications(series_id);
create index if not exists vehicle_catalog_apps_powertrain_idx on public.vehicle_catalog_applications(powertrain_id);
create index if not exists vehicle_catalog_apps_variant_idx on public.vehicle_catalog_applications(variant_id);
create index if not exists vehicle_catalog_years_year_idx on public.vehicle_catalog_application_years(model_year, application_id);
create index if not exists vehicle_catalog_product_fits_product_idx on public.vehicle_catalog_product_fitments(product_variant_id, fitment_status);

create or replace view public.vehicle_catalog_search with (security_invoker = true) as
select ay.model_year, mk.make_id, mk.name as make_name, md.model_id, md.name as model_name,
  va.application_id, sr.series_id, coalesce(sr.display_name, '') as series_name,
  pt.powertrain_id, pt.display_name as engine_name, vr.variant_id, vr.display_name as variant_name,
  vr.body_style, vr.drive_type, vr.vehicle_class
from public.vehicle_catalog_application_years ay
join public.vehicle_catalog_applications va on va.application_id = ay.application_id and va.status = 'active'
join public.vehicle_catalog_models md on md.model_id = va.model_id and md.status = 'active'
join public.vehicle_catalog_makes mk on mk.make_id = md.make_id and mk.status = 'active'
left join public.vehicle_catalog_series sr on sr.series_id = va.series_id and sr.status = 'active'
join public.vehicle_catalog_powertrains pt on pt.powertrain_id = va.powertrain_id
join public.vehicle_catalog_variants vr on vr.variant_id = va.variant_id;

create or replace view public.vehicle_catalog_model_years with (security_invoker = true) as
select distinct mk.make_id, mk.name as make_name, md.model_id, md.name as model_name, ay.model_year
from public.vehicle_catalog_application_years ay
join public.vehicle_catalog_applications va on va.application_id = ay.application_id and va.status = 'active'
join public.vehicle_catalog_models md on md.model_id = va.model_id and md.status = 'active'
join public.vehicle_catalog_makes mk on mk.make_id = md.make_id and mk.status = 'active';

create or replace view public.vehicle_catalog_index with (security_invoker = true) as
select mk.make_id, mk.name as make_name, md.model_id, md.name as model_name,
  array_agg(distinct ay.model_year order by ay.model_year desc) as years
from public.vehicle_catalog_application_years ay
join public.vehicle_catalog_applications va on va.application_id = ay.application_id and va.status = 'active'
join public.vehicle_catalog_models md on md.model_id = va.model_id and md.status = 'active'
join public.vehicle_catalog_makes mk on mk.make_id = md.make_id and mk.status = 'active'
group by mk.make_id, mk.name, md.model_id, md.name;

do $$
declare t text;
begin
  foreach t in array array['vehicle_catalog_releases','vehicle_catalog_makes','vehicle_catalog_models','vehicle_catalog_series',
    'vehicle_catalog_variants','vehicle_catalog_powertrains','vehicle_catalog_engine_codes','vehicle_catalog_powertrain_engine_codes',
    'vehicle_catalog_applications','vehicle_catalog_application_years','vehicle_catalog_application_provenance',
    'vehicle_catalog_review_issues','vehicle_catalog_source_failures','vehicle_catalog_product_fitments','vehicle_catalog_wiper_fitments']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_public_read', t);
    execute format('create policy %I on public.%I for select to anon, authenticated using (true)', t || '_public_read', t);
  end loop;
end $$;
grant select on public.vehicle_catalog_search to anon, authenticated;
grant select on public.vehicle_catalog_model_years to anon, authenticated;
grant select on public.vehicle_catalog_index to anon, authenticated;
