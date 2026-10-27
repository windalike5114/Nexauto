-- Curated multi-source identity/OE/cross-reference chain for Suzuki Swift AZG.
insert into public.catalog_data_sources (
  code, name, source_kind, vehicle_identity_priority, product_fitment_priority, active, metadata
)
values (
  'SWIFT_AZG_OEM_DB1941_CROSSREF_2026',
  'Suzuki Swift AZG OE to Bendix DB1941 cross-reference chain',
  'market_reference',
  80,
  30,
  true,
  '{"product_line":"brake_pad","reference_scheme":"bendix_db","evidence_type":"vehicle_identity_plus_oe_cross_reference","source_confidence":"high","oem_numbers":["55810-68L00","55810-68L50"],"bendix_reference":"DB1941"}'::jsonb
)
on conflict (code) do update set
  name = excluded.name,
  source_kind = excluded.source_kind,
  product_fitment_priority = excluded.product_fitment_priority,
  active = excluded.active,
  metadata = public.catalog_data_sources.metadata || excluded.metadata,
  updated_at = now();

