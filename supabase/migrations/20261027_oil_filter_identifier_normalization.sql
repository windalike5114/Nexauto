-- Normalize filter dimensions and external part-number namespaces.
-- Existing metadata remains the compatibility source for rows written before
-- this migration is deployed.

alter table public.product_identifiers
  add column if not exists identifier_brand text,
  add column if not exists verification_status text not null default 'supplier_only';

update public.product_identifiers
set identifier_brand = nullif(btrim(metadata ->> 'brand'), '')
where identifier_brand is null
  and jsonb_typeof(metadata) = 'object';

alter table public.product_identifiers
  drop constraint if exists product_identifiers_verification_status_check,
  drop constraint if exists product_identifiers_identifier_brand_check,
  add constraint product_identifiers_verification_status_check check (
    verification_status in ('verified', 'supplier_only', 'conflict', 'rejected')
  ),
  add constraint product_identifiers_identifier_brand_check check (
    identifier_brand is null or btrim(identifier_brand) <> ''
  );

create index if not exists product_identifiers_brand_lookup_idx
  on public.product_identifiers(identifier_brand, identifier_type, normalized_value);

alter table public.filter_variant_specs
  add column if not exists outside_diameter_top_mm numeric(8, 2),
  add column if not exists outside_diameter_bottom_mm numeric(8, 2);

alter table public.filter_variant_specs
  drop constraint if exists filter_variant_specs_outside_top_check,
  add constraint filter_variant_specs_outside_top_check check (
    outside_diameter_top_mm is null or outside_diameter_top_mm > 0
  ),
  drop constraint if exists filter_variant_specs_outside_bottom_check,
  add constraint filter_variant_specs_outside_bottom_check check (
    outside_diameter_bottom_mm is null or outside_diameter_bottom_mm > 0
  );

comment on column public.product_identifiers.identifier_brand is
  'Identifier namespace or brand, for example TopStar, Ryco, or an OE manufacturer.';
comment on column public.product_identifiers.is_primary is
  'Preferred external identifier only. The canonical NexAuto SKU is product_variants.sku and must not be duplicated here.';
comment on column public.product_identifiers.verification_status is
  'Verification state of this external identifier mapping; conflicts remain queryable but must not be auto-published.';
comment on column public.filter_variant_specs.outside_diameter_top_mm is
  'Top outside diameter when the source provides two outside diameters.';
comment on column public.filter_variant_specs.outside_diameter_bottom_mm is
  'Bottom outside diameter when the source provides two outside diameters.';
