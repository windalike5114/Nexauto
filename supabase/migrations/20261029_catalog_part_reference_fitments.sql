-- Product-independent catalogue references and vehicle fitments.
--
-- A Bendix DB number is an industry reference, not a NexAuto product.  These
-- tables allow us to retain authoritative fitment knowledge before a sellable
-- NBP SKU exists, without creating placeholder products or enabling checkout.

insert into public.catalog_data_sources (
  code,
  name,
  source_kind,
  vehicle_identity_priority,
  product_fitment_priority,
  active,
  metadata
)
values (
  'BENDIX_NZ_FULL_FITMENT_V1',
  'Bendix New Zealand brake pad fitment catalogue V1',
  'product_catalogue',
  100,
  10,
  true,
  '{"product_line":"brake_pad","reference_scheme":"bendix_db","market":"NZ","source_confidence":"highest"}'::jsonb
)
on conflict (code) do update set
  name = excluded.name,
  source_kind = excluded.source_kind,
  product_fitment_priority = excluded.product_fitment_priority,
  active = excluded.active,
  metadata = public.catalog_data_sources.metadata || excluded.metadata,
  updated_at = now();

create table if not exists public.catalog_product_lines (
  code text primary key,
  name text not null,
  category_slug text not null unique,
  specification_table text not null,
  reference_layer_enabled boolean not null default true,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_product_lines_code_check check (btrim(code) <> ''),
  constraint catalog_product_lines_name_check check (btrim(name) <> ''),
  constraint catalog_product_lines_category_check check (btrim(category_slug) <> ''),
  constraint catalog_product_lines_specification_table_check check (btrim(specification_table) <> ''),
  constraint catalog_product_lines_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);

insert into public.catalog_product_lines (
  code,
  name,
  category_slug,
  specification_table,
  reference_layer_enabled,
  active,
  metadata
)
values
  ('brake_pad', 'Brake pad', 'brake-pad', 'brake_pad_variant_specs', true, true, '{"source_sheet":"01刹车片"}'::jsonb),
  ('brake_disc', 'Brake disc', 'brake-disc', 'brake_disc_variant_specs', true, false, '{"source_sheet":"02刹车盘","status":"future_product_line"}'::jsonb),
  ('brake_shoe', 'Brake shoe', 'brake-shoe', 'brake_shoe_variant_specs', true, false, '{"source_sheet":"03刹车蹄","status":"future_product_line"}'::jsonb),
  ('brake_drum', 'Brake drum', 'brake-drum', 'brake_drum_variant_specs', true, false, '{"source_sheet":"04刹车鼓","status":"future_product_line"}'::jsonb),
  ('parking_brake_shoe', 'Parking brake shoe', 'parking-brake-shoe', 'parking_brake_shoe_variant_specs', true, false, '{"source_sheet":"05手刹蹄","status":"future_product_line"}'::jsonb)
on conflict (code) do update set
  name = excluded.name,
  category_slug = excluded.category_slug,
  specification_table = excluded.specification_table,
  reference_layer_enabled = excluded.reference_layer_enabled,
  metadata = public.catalog_product_lines.metadata || excluded.metadata,
  updated_at = now();

create table if not exists public.catalog_reference_schemes (
  product_type text not null references public.catalog_product_lines(code) on delete restrict,
  code text not null,
  name text not null,
  issuer text,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_reference_schemes_code_check check (btrim(code) <> ''),
  constraint catalog_reference_schemes_name_check check (btrim(name) <> ''),
  constraint catalog_reference_schemes_issuer_check check (issuer is null or btrim(issuer) <> ''),
  constraint catalog_reference_schemes_metadata_object_check check (jsonb_typeof(metadata) = 'object'),
  primary key (product_type, code)
);

insert into public.catalog_reference_schemes (
  product_type,
  code,
  name,
  issuer,
  active,
  metadata
)
values (
  'brake_pad',
  'bendix_db',
  'Bendix DB brake pad reference',
  'Bendix',
  true,
  '{"value_pattern":"^DB[0-9]+[A-Z]?$","market":"NZ"}'::jsonb
)
on conflict (product_type, code) do update set
  name = excluded.name,
  issuer = excluded.issuer,
  metadata = public.catalog_reference_schemes.metadata || excluded.metadata,
  updated_at = now();

create table if not exists public.catalog_part_references (
  id uuid primary key default gen_random_uuid(),
  product_type text not null,
  reference_scheme text not null,
  reference_value text not null,
  normalized_value text not null,
  lifecycle_status text not null default 'unknown',
  width_mm numeric(8, 2),
  height_mm numeric(8, 2),
  thickness_mm numeric(8, 2),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_part_references_scheme_check check (btrim(reference_scheme) <> ''),
  constraint catalog_part_references_value_check check (btrim(reference_value) <> ''),
  constraint catalog_part_references_normalized_check check (btrim(normalized_value) <> ''),
  constraint catalog_part_references_lifecycle_check check (
    lifecycle_status in ('active', 'to_be_discontinued', 'discontinued', 'superseded', 'unknown')
  ),
  constraint catalog_part_references_width_check check (width_mm is null or width_mm > 0),
  constraint catalog_part_references_height_check check (height_mm is null or height_mm > 0),
  constraint catalog_part_references_thickness_check check (thickness_mm is null or thickness_mm > 0),
  constraint catalog_part_references_metadata_object_check check (jsonb_typeof(metadata) = 'object'),
  constraint catalog_part_references_scheme_fkey foreign key (product_type, reference_scheme)
    references public.catalog_reference_schemes(product_type, code) on delete restrict,
  unique (product_type, reference_scheme, normalized_value)
);

create table if not exists public.catalog_part_reference_products (
  part_reference_id uuid not null references public.catalog_part_references(id) on delete cascade,
  product_variant_id uuid not null references public.product_variants(id) on delete cascade,
  relation_type text not null default 'exact_cross_reference',
  verification_status text not null default 'verified',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_part_reference_products_relation_check check (
    relation_type in ('exact_cross_reference', 'supersedes', 'superseded_by', 'equivalent')
  ),
  constraint catalog_part_reference_products_verification_check check (
    verification_status in ('generated', 'review', 'verified', 'rejected')
  ),
  constraint catalog_part_reference_products_metadata_object_check check (jsonb_typeof(metadata) = 'object'),
  primary key (part_reference_id, product_variant_id, relation_type)
);

-- Product lines remain separate even though they share the generic reference
-- registry and many-to-many junction. A DB brake-pad reference must never be
-- linked to a brake disc/shoe/drum SKU, and future product lines receive their
-- own category and specification table before any product link is accepted.
create or replace function public.validate_catalog_part_reference_product_line()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  product_category_slug text;
  expected_category_slug text;
begin
  select product_lines.category_slug
    into expected_category_slug
  from public.catalog_part_references part_refs
  join public.catalog_product_lines product_lines on product_lines.code = part_refs.product_type
  where part_refs.id = new.part_reference_id;

  select products.category_slug
    into product_category_slug
  from public.product_variants variants
  join public.products products on products.id = variants.product_id
  where variants.id = new.product_variant_id;

  if expected_category_slug is null or product_category_slug is distinct from expected_category_slug then
    raise exception 'Part reference requires product category %, received %',
      expected_category_slug,
      product_category_slug;
  end if;

  return new;
end;
$$;

drop trigger if exists catalog_part_reference_products_validate_line
  on public.catalog_part_reference_products;
create trigger catalog_part_reference_products_validate_line
before insert or update on public.catalog_part_reference_products
for each row execute function public.validate_catalog_part_reference_product_line();

create table if not exists public.vehicle_catalog_part_reference_fitments (
  application_id text not null references public.vehicle_catalog_applications(application_id) on delete cascade,
  part_reference_id uuid not null references public.catalog_part_references(id) on delete cascade,
  position text not null,
  data_source_id uuid not null references public.catalog_data_sources(id) on delete restrict,
  import_batch_id uuid references public.catalog_import_batches(id) on delete set null,
  fitment_status text not null default 'review',
  confidence text not null default 'unknown',
  source_row_numbers integer[] not null default '{}',
  match_reasons text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vehicle_catalog_part_reference_fitments_position_check check (
    position in ('front', 'rear', 'vehicle', 'unknown')
  ),
  constraint vehicle_catalog_part_reference_fitments_status_check check (
    fitment_status in ('draft', 'review', 'published', 'rejected')
  ),
  constraint vehicle_catalog_part_reference_fitments_confidence_check check (
    confidence in ('exact', 'high', 'provisional_unique', 'review', 'unknown')
  ),
  constraint vehicle_catalog_part_reference_fitments_rows_positive_check check (
    0 < all(source_row_numbers)
  ),
  constraint vehicle_catalog_part_reference_fitments_metadata_object_check check (jsonb_typeof(metadata) = 'object'),
  primary key (application_id, part_reference_id, position, data_source_id)
);

create index if not exists catalog_part_references_lookup_idx
  on public.catalog_part_references(product_type, reference_scheme, normalized_value);
create index if not exists catalog_part_reference_products_variant_idx
  on public.catalog_part_reference_products(product_variant_id, verification_status);
create index if not exists vehicle_catalog_part_reference_fitments_application_idx
  on public.vehicle_catalog_part_reference_fitments(application_id, position, fitment_status);
create index if not exists vehicle_catalog_part_reference_fitments_reference_idx
  on public.vehicle_catalog_part_reference_fitments(part_reference_id, fitment_status);

drop trigger if exists catalog_part_references_set_updated_at on public.catalog_part_references;
create trigger catalog_part_references_set_updated_at
before update on public.catalog_part_references
for each row execute function public.set_updated_at();

drop trigger if exists catalog_product_lines_set_updated_at on public.catalog_product_lines;
create trigger catalog_product_lines_set_updated_at
before update on public.catalog_product_lines
for each row execute function public.set_updated_at();

drop trigger if exists catalog_reference_schemes_set_updated_at on public.catalog_reference_schemes;
create trigger catalog_reference_schemes_set_updated_at
before update on public.catalog_reference_schemes
for each row execute function public.set_updated_at();

drop trigger if exists catalog_part_reference_products_set_updated_at on public.catalog_part_reference_products;
create trigger catalog_part_reference_products_set_updated_at
before update on public.catalog_part_reference_products
for each row execute function public.set_updated_at();

drop trigger if exists vehicle_catalog_part_reference_fitments_set_updated_at on public.vehicle_catalog_part_reference_fitments;
create trigger vehicle_catalog_part_reference_fitments_set_updated_at
before update on public.vehicle_catalog_part_reference_fitments
for each row execute function public.set_updated_at();

alter table public.catalog_product_lines enable row level security;
alter table public.catalog_reference_schemes enable row level security;
alter table public.catalog_part_references enable row level security;
alter table public.catalog_part_reference_products enable row level security;
alter table public.vehicle_catalog_part_reference_fitments enable row level security;

-- Reference-only rows are internal catalogue knowledge.  Public storefront
-- callers continue to use product-bound fitments and cannot see or purchase a
-- DB reference until it is linked to a real, published product.
revoke all on public.catalog_product_lines from anon, authenticated;
revoke all on public.catalog_reference_schemes from anon, authenticated;
revoke all on public.catalog_part_references from anon, authenticated;
revoke all on public.catalog_part_reference_products from anon, authenticated;
revoke all on public.vehicle_catalog_part_reference_fitments from anon, authenticated;

grant all on public.catalog_product_lines to service_role;
grant all on public.catalog_reference_schemes to service_role;
grant all on public.catalog_part_references to service_role;
grant all on public.catalog_part_reference_products to service_role;
grant all on public.vehicle_catalog_part_reference_fitments to service_role;

comment on table public.catalog_product_lines is
  'Registry for independently managed product lines. Each line owns its category, specifications, imports and coverage metrics while sharing the generic reference framework.';
comment on table public.catalog_reference_schemes is
  'Controlled reference namespaces within each product line. Prevents spelling variants from creating duplicate reference systems.';
comment on table public.catalog_part_references is
  'Product-independent industry reference identities. Product types remain isolated; a row does not imply a sellable NexAuto SKU.';
comment on table public.catalog_part_reference_products is
  'Explicit link from an industry reference to a real product variant. Absence means reference-only/non-sellable.';
comment on table public.vehicle_catalog_part_reference_fitments is
  'Vehicle fitment knowledge for industry references, independent of product availability.';

notify pgrst, 'reload schema';
