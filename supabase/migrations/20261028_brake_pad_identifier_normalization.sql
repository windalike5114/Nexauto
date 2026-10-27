-- Register the normalized brake-pad identifier source. Product rows are
-- populated by scripts/catalog/normalize-brake-pad-catalog.mjs after the
-- additive brake_pad_variant_specs table migration has been deployed.

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
  'TOPSTAR_BENDIX_BRAKE_PAD_CATALOG_V1',
  'TopStar / Bendix brake pad catalogue V1',
  'product_catalogue',
  100,
  30,
  true,
  '{"product_line":"brake_pad","identifier_rule":"TopStar supplier SKU CDBxxxx equals Bendix cross-reference DBxxxx with a supplier C prefix"}'::jsonb
)
on conflict (code) do update set
  name = excluded.name,
  source_kind = excluded.source_kind,
  product_fitment_priority = excluded.product_fitment_priority,
  active = excluded.active,
  metadata = public.catalog_data_sources.metadata || excluded.metadata,
  updated_at = now();

comment on column public.brake_pad_variant_specs.part_number is
  'Canonical NexAuto NBP SKU snapshot. External TopStar CDB and Bendix DB identifiers belong in product_identifiers.';

comment on column public.brake_pad_variant_specs.axle_position is
  'Supplier catalogue axle position for the product. The application-specific installation position remains vehicle_catalog_product_fitments.position.';
