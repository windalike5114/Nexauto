-- Structured oil-filter specifications for reusable, batch-generated product pages.
-- Missing measurements stay null and must not be rendered as N/A or inferred.

alter table public.filter_variant_specs
  add column if not exists construction_type text,
  add column if not exists height_mm numeric(8, 2),
  add column if not exists outside_diameter_mm numeric(8, 2),
  add column if not exists inside_diameter_top_mm numeric(8, 2),
  add column if not exists inside_diameter_bottom_mm numeric(8, 2),
  add column if not exists thread_size text,
  add column if not exists seal_ring_dimensions text[] not null default '{}',
  add column if not exists pack_quantity integer not null default 1;

alter table public.filter_variant_specs
  drop constraint if exists filter_variant_specs_construction_type_check,
  add constraint filter_variant_specs_construction_type_check check (
    construction_type is null or construction_type in ('cartridge', 'spin_on', 'other')
  ),
  drop constraint if exists filter_variant_specs_height_check,
  add constraint filter_variant_specs_height_check check (height_mm is null or height_mm > 0),
  drop constraint if exists filter_variant_specs_outside_diameter_check,
  add constraint filter_variant_specs_outside_diameter_check check (outside_diameter_mm is null or outside_diameter_mm > 0),
  drop constraint if exists filter_variant_specs_inside_top_check,
  add constraint filter_variant_specs_inside_top_check check (inside_diameter_top_mm is null or inside_diameter_top_mm > 0),
  drop constraint if exists filter_variant_specs_inside_bottom_check,
  add constraint filter_variant_specs_inside_bottom_check check (inside_diameter_bottom_mm is null or inside_diameter_bottom_mm > 0),
  drop constraint if exists filter_variant_specs_pack_quantity_check,
  add constraint filter_variant_specs_pack_quantity_check check (pack_quantity > 0);

alter table public.product_identifiers
  add column if not exists verification_status text not null default 'supplier_only';

alter table public.product_identifiers
  drop constraint if exists product_identifiers_verification_status_check,
  add constraint product_identifiers_verification_status_check check (
    verification_status in ('verified', 'supplier_only', 'conflict', 'rejected')
  );

-- J-415 is the reviewed design sample. The dimensions come from the supplied
-- TopStar specification; the R2703P relationship remains blocked for review
-- because its published height conflicts with the supplier-listed value.
update public.filter_variant_specs specs
set
  construction_type = 'cartridge',
  height_mm = 154,
  outside_diameter_mm = 46,
  inside_diameter_top_mm = 21,
  inside_diameter_bottom_mm = 21,
  seal_ring_dimensions = array['52 × 3.5 mm', '14 × 3.5 mm', '7.5 × 3.5 mm'],
  pack_quantity = 1,
  verification_status = 'review',
  updated_at = now()
from public.product_variants variants
where specs.product_variant_id = variants.id
  and variants.sku = 'TOPSTAR-J415';

update public.product_identifiers identifiers
set verification_status = case
  when identifiers.normalized_value = 'R2703P' then 'conflict'
  else 'supplier_only'
end
from public.product_variants variants
where identifiers.product_variant_id = variants.id
  and variants.sku = 'TOPSTAR-J415'
  and identifiers.identifier_type = 'cross_reference';
