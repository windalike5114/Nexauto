-- Independent Akebono brake-pad references. These are catalogue knowledge,
-- not NexAuto products and not inferred Bendix DB cross-references.
insert into public.catalog_data_sources (
  code, name, source_kind, vehicle_identity_priority, product_fitment_priority, active, metadata
)
values (
  'AKEBONO_JP_SUZUKI_FITMENT_2026',
  'Akebono Japan Suzuki aftermarket fitment catalogue',
  'product_catalogue',
  100,
  20,
  true,
  '{"product_line":"brake_pad","reference_scheme":"akebono_an","market":"JP","source_confidence":"authoritative","url":"https://www.akebono-brake.com/product_technology/aftermarket/docs/pf09_suzuki.pdf"}'::jsonb
)
on conflict (code) do update set
  name = excluded.name,
  source_kind = excluded.source_kind,
  product_fitment_priority = excluded.product_fitment_priority,
  active = excluded.active,
  metadata = public.catalog_data_sources.metadata || excluded.metadata,
  updated_at = now();

insert into public.catalog_reference_schemes (
  product_type, code, name, issuer, active, metadata
)
values (
  'brake_pad',
  'akebono_an',
  'Akebono AN brake pad reference',
  'Akebono Brake Industry',
  true,
  '{"value_pattern":"^AN-[0-9]+WK$","market":"JP"}'::jsonb
)
on conflict (product_type, code) do update set
  name = excluded.name,
  issuer = excluded.issuer,
  active = excluded.active,
  metadata = public.catalog_reference_schemes.metadata || excluded.metadata,
  updated_at = now();

