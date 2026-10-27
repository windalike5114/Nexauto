-- Register bulbs using the existing normalized commerce tables.
-- products: title, subtitle (description), ordered feature paragraphs (detail_sections), images, publication.
-- product_variants: canonical NBL SKU, authoritative price, internal supplier reference and inventory mode.
-- product_attributes: one parameter set per product; each named parameter has an array of text values.
-- vehicle_catalog_product_fitments: future application_id / product_variant_id / lamp position relationships.
-- This migration deliberately creates NO fitment records.
--
-- The initial source has no stock counts. inventory_mode='untracked' explicitly
-- permits ordering without interpreting the legacy non-null stock column as a
-- physical count. For tracked inventory, switch inventory_mode to 'tracked';
-- checkout then enforces product_variants.stock. Never substitute a fake count.
-- Source data is imported by scripts/catalog/import-bulbs-supabase.mjs, which
-- stages internal products, verifies all records, then publishes in one statement.

insert into public.catalog_product_lines (
  code, name, category_slug, specification_table,
  reference_layer_enabled, active, metadata
)
values (
  'bulb', 'Light bulbs', 'bulb', 'product_attributes', false, true,
  '{"schema_version":1,"source":"NEXAUTO_BULBS_USER_CATALOGUE_V4_20261026","canonical_sku":"product_variants.sku","content_table":"products","feature_field":"detail_sections","inventory_mode_field":"product_variants.attributes.inventory_mode","fitment_table":"vehicle_catalog_product_fitments","fitment_key":"product_variant_id","fitment_status":"reserved_no_data","fitment_positions":["headlight_low","headlight_high","fog_front","indicator_front","indicator_rear","brake","tail","reverse","number_plate","interior"]}'::jsonb
)
on conflict (code) do update set
  name = excluded.name,
  category_slug = excluded.category_slug,
  specification_table = excluded.specification_table,
  active = excluded.active,
  metadata = public.catalog_product_lines.metadata || excluded.metadata,
  updated_at = now();
