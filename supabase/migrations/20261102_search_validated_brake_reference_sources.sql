insert into public.catalog_data_sources (
  code, name, source_kind, vehicle_identity_priority, product_fitment_priority, active, metadata
)
values
  (
    'JNBK_D22_DB438_CROSSREF_2026',
    'JNBK D22 application and Bendix DB438 cross-reference evidence',
    'market_reference', 80, 20, true,
    '{"product_line":"brake_pad","reference_scheme":"bendix_db","source_confidence":"high","evidence_type":"exact_application_plus_manufacturer_cross_reference","url":"https://www.jnbk-brake.com/catalogue/partdetails.aspx?PartNumber=PN2344"}'::jsonb
  ),
  (
    'BENDIX_SWIFT_DB1117_CROSSCHECK_2026',
    'Bendix Swift DB1117 exact-configuration cross-check',
    'market_reference', 80, 20, true,
    '{"product_line":"brake_pad","reference_scheme":"bendix_db","source_confidence":"high","evidence_type":"authoritative_local_catalogue_plus_exact_vehicle_crosscheck","url":"https://www.autosurplus.com.au/bendix-gct-disc-brake-pad-set-db1117-gct"}'::jsonb
  )
on conflict (code) do update set
  name = excluded.name,
  source_kind = excluded.source_kind,
  vehicle_identity_priority = excluded.vehicle_identity_priority,
  product_fitment_priority = excluded.product_fitment_priority,
  active = excluded.active,
  metadata = public.catalog_data_sources.metadata || excluded.metadata,
  updated_at = now();

