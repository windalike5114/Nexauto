-- Toyota OE brake-pad references retained as product-independent catalogue
-- knowledge. These rows do not create a NexAuto SKU or make a part sellable.
insert into public.catalog_data_sources (
  code, name, source_kind, vehicle_identity_priority, product_fitment_priority, active, metadata
)
values (
  'TOYOTA_EPC_PARTSOUQ_2026',
  'Toyota EPC vehicle and OE part evidence via PartSouq',
  'market_reference',
  20,
  20,
  true,
  '{"product_line":"brake_pad","reference_scheme":"toyota_oe","evidence_type":"manufacturer_epc_mirror","retrieved_on":"2026-10-25"}'::jsonb
)
on conflict (code) do update set
  name = excluded.name,
  source_kind = excluded.source_kind,
  vehicle_identity_priority = excluded.vehicle_identity_priority,
  product_fitment_priority = excluded.product_fitment_priority,
  active = excluded.active,
  metadata = public.catalog_data_sources.metadata || excluded.metadata,
  updated_at = now();

insert into public.catalog_reference_schemes (
  product_type, code, name, issuer, active, metadata
)
values (
  'brake_pad',
  'toyota_oe',
  'Toyota OE brake pad reference',
  'Toyota Motor Corporation',
  true,
  '{"value_pattern":"^[0-9]{5}-[0-9]{5}$","reference_role":"manufacturer_oe"}'::jsonb
)
on conflict (product_type, code) do update set
  name = excluded.name,
  issuer = excluded.issuer,
  active = excluded.active,
  metadata = public.catalog_reference_schemes.metadata || excluded.metadata,
  updated_at = now();

