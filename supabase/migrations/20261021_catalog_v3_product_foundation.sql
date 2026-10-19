-- Product-line foundation for the clean NexAuto catalogue V3.
--
-- This migration is additive. It preserves customer, order and payment data,
-- keeps generated products non-purchasable, and records supplier identifiers
-- and fitment evidence without treating cross-reference numbers as products.

alter table public.vehicle_fitment_applications
  add column if not exists source_application_key text;

create unique index if not exists vehicle_fitment_applications_source_key_uidx
  on public.vehicle_fitment_applications(source_application_key);

create table if not exists public.product_identifiers (
  id uuid primary key default gen_random_uuid(),
  product_variant_id uuid not null references public.product_variants(id) on delete cascade,
  identifier_type text not null,
  identifier_value text not null,
  normalized_value text not null,
  data_source_id uuid not null references public.catalog_data_sources(id) on delete restrict,
  is_primary boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint product_identifiers_type_check check (
    identifier_type in ('supplier_sku', 'cross_reference', 'oe', 'alternate')
  ),
  constraint product_identifiers_value_check check (btrim(identifier_value) <> ''),
  constraint product_identifiers_normalized_check check (btrim(normalized_value) <> ''),
  constraint product_identifiers_metadata_object_check check (jsonb_typeof(metadata) = 'object'),
  unique (product_variant_id, identifier_type, normalized_value, data_source_id)
);

create unique index if not exists product_identifiers_primary_uidx
  on public.product_identifiers(product_variant_id, data_source_id)
  where is_primary = true;

create index if not exists product_identifiers_lookup_idx
  on public.product_identifiers(identifier_type, normalized_value);

create table if not exists public.filter_variant_specs (
  product_variant_id uuid primary key references public.product_variants(id) on delete cascade,
  supplier_brand text,
  supplier_part_number text not null,
  filter_type text not null default 'unknown',
  verification_status text not null default 'generated',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint filter_variant_specs_type_check check (
    filter_type in ('oil', 'air', 'fuel', 'cabin', 'transmission', 'hydraulic', 'other', 'unknown')
  ),
  constraint filter_variant_specs_verification_check check (
    verification_status in ('generated', 'review', 'verified', 'rejected')
  ),
  constraint filter_variant_specs_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.battery_variant_specs (
  product_variant_id uuid primary key references public.product_variants(id) on delete cascade,
  battery_code text not null,
  technology text not null default 'unknown',
  code_format text not null default 'unknown',
  voltage numeric(5, 2),
  capacity_ah numeric(7, 2),
  cca integer,
  length_mm integer,
  width_mm integer,
  height_mm integer,
  terminal_layout text,
  verification_status text not null default 'generated',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint battery_variant_specs_technology_check check (
    technology in ('AGM', 'EFB', 'MF', 'flooded', 'gel', 'lithium', 'other', 'unknown')
  ),
  constraint battery_variant_specs_code_format_check check (
    code_format in ('DIN', 'JIS_or_supplier_code', 'supplier_code', 'other', 'unknown')
  ),
  constraint battery_variant_specs_verification_check check (
    verification_status in ('generated', 'review', 'verified', 'rejected')
  ),
  constraint battery_variant_specs_voltage_check check (voltage is null or voltage > 0),
  constraint battery_variant_specs_capacity_check check (capacity_ah is null or capacity_ah > 0),
  constraint battery_variant_specs_cca_check check (cca is null or cca > 0),
  constraint battery_variant_specs_length_check check (length_mm is null or length_mm > 0),
  constraint battery_variant_specs_width_check check (width_mm is null or width_mm > 0),
  constraint battery_variant_specs_height_check check (height_mm is null or height_mm > 0),
  constraint battery_variant_specs_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.vehicle_product_fitment_evidence (
  id uuid primary key default gen_random_uuid(),
  vehicle_product_fitment_id uuid not null references public.vehicle_product_fitments(id) on delete cascade,
  import_batch_id uuid not null references public.catalog_import_batches(id) on delete cascade,
  source_record_id uuid references public.catalog_source_records(id) on delete set null,
  source_row_number integer not null check (source_row_number > 0),
  evidence_kind text not null default 'provided_mapping',
  confidence numeric(5, 4) check (confidence is null or confidence between 0 and 1),
  raw_values jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint vehicle_product_fitment_evidence_kind_check check (
    evidence_kind in ('provided_mapping', 'supplier_catalogue', 'cross_reference', 'manual', 'inferred')
  ),
  constraint vehicle_product_fitment_evidence_raw_object_check check (jsonb_typeof(raw_values) = 'object'),
  unique (vehicle_product_fitment_id, import_batch_id, source_row_number)
);

create index if not exists vehicle_product_fitment_evidence_fitment_idx
  on public.vehicle_product_fitment_evidence(vehicle_product_fitment_id, created_at desc);

-- Generated catalogue rows may be visible as previews, but these tables do not
-- create a checkout path. Public access is read-only and requires a visible,
-- active parent product. Administrative writes continue through service_role.
alter table public.product_identifiers enable row level security;
alter table public.filter_variant_specs enable row level security;
alter table public.battery_variant_specs enable row level security;
alter table public.vehicle_product_fitment_evidence enable row level security;

drop policy if exists "Public can read identifiers for visible products" on public.product_identifiers;
create policy "Public can read identifiers for visible products"
  on public.product_identifiers for select
  using (
    exists (
      select 1
      from public.product_variants variants
      join public.products products on products.id = variants.product_id
      where variants.id = product_identifiers.product_variant_id
        and variants.active = true
        and products.active = true
        and products.visibility_status = 'public'
    )
  );

drop policy if exists "Public can read visible filter specifications" on public.filter_variant_specs;
create policy "Public can read visible filter specifications"
  on public.filter_variant_specs for select
  using (
    exists (
      select 1
      from public.product_variants variants
      join public.products products on products.id = variants.product_id
      where variants.id = filter_variant_specs.product_variant_id
        and variants.active = true
        and products.active = true
        and products.visibility_status = 'public'
    )
  );

drop policy if exists "Public can read visible battery specifications" on public.battery_variant_specs;
create policy "Public can read visible battery specifications"
  on public.battery_variant_specs for select
  using (
    exists (
      select 1
      from public.product_variants variants
      join public.products products on products.id = variants.product_id
      where variants.id = battery_variant_specs.product_variant_id
        and variants.active = true
        and products.active = true
        and products.visibility_status = 'public'
    )
  );

-- Fitment evidence is internal provenance. Public callers use the curated
-- vehicle_product_fitments relationship, not raw evidence rows.
revoke all on public.vehicle_product_fitment_evidence from anon, authenticated;

grant select on public.product_identifiers to anon, authenticated, service_role;
grant select on public.filter_variant_specs to anon, authenticated, service_role;
grant select on public.battery_variant_specs to anon, authenticated, service_role;
grant all on public.vehicle_product_fitment_evidence to service_role;
