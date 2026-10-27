-- Oil filters use the existing filter category. Air filters are an independent
-- future product line, like brake_drum: reference knowledge without products.
insert into public.catalog_product_lines
  (code,name,category_slug,specification_table,reference_layer_enabled,active,metadata)
values
  ('oil_filter','Oil filter','filter','filter_variant_specs',true,true,
   '{"matching_rule":"exact_engine_and_complete_year_config_intersection"}'::jsonb),
  ('air_filter','Air filter','air-filter','air_filter_variant_specs',true,false,
   '{"status":"future_product_line","reference_only":true,"matching_rule":"exact_series_engine_and_complete_year_config_intersection"}'::jsonb)
on conflict (code) do nothing;

insert into public.catalog_reference_schemes
  (product_type,code,name,issuer,active,metadata)
values
  ('oil_filter','ryco','Ryco catalogue reference','Ryco',true,'{"market":"AU"}'::jsonb),
  ('air_filter','ryco','Ryco catalogue reference','Ryco',true,'{"market":"AU"}'::jsonb)
on conflict (product_type,code) do nothing;
