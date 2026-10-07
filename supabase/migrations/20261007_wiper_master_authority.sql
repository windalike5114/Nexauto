-- Treat the user-provided Wiper Master as the authoritative source for
-- vehicle identity and wiper fitment. External catalogues remain evidence,
-- but must not override an otherwise publishable Wiper Master record.

update public.catalog_data_sources
set
  vehicle_identity_priority = 5,
  product_fitment_priority = 1,
  metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'authoritative_vehicle_identity', true,
    'authoritative_product_fitment', true,
    'conflict_policy', 'user_source_overrides_external_sources'
  ),
  updated_at = now()
where code = 'WIPER_MASTER';
