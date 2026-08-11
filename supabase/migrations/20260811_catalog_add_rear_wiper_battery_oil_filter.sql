with rear_wiper as (
  insert into products (
    slug,
    name,
    category_slug,
    price,
    description,
    images,
    detail_sections
  )
  values (
    'premium-rear-wiper-blade',
    'Premium Rear Wiper Blade',
    'wiper',
    34.99,
    'A premium rear wiper blade with selectable lengths from 8 inch to 16 inch for supported rear screen applications.',
    array['/products/rear-wiper-blade.jpg'],
    '[
      {
        "title": "Rear Wiper Sizes",
        "body": "Available in 8 inch, 10 inch, 11 inch, 12 inch, 13 inch, 14 inch, 15 inch, and 16 inch options for supported rear screen applications."
      },
      {
        "title": "Quiet Everyday Performance",
        "body": "Designed for smooth rear window wiping with dependable contact and practical all-season performance."
      },
      {
        "title": "Fitment Reminder",
        "body": "Rear blade sizing and attachment style can vary by vehicle. Contact us if you need help confirming the correct rear blade before ordering."
      }
    ]'::jsonb
  )
  on conflict (slug) do update set
    name = excluded.name,
    category_slug = excluded.category_slug,
    price = excluded.price,
    description = excluded.description,
    images = excluded.images,
    detail_sections = excluded.detail_sections,
    active = true
  returning id
),
rear_wiper_attr as (
  insert into product_attributes (product_id, attributes)
  select
    id,
    '{"length":[8,10,11,12,13,14,15,16]}'::jsonb
  from rear_wiper
  on conflict (product_id) do update set attributes = excluded.attributes
  returning product_id
)
insert into product_variants (product_id, sku, price, stock, attributes)
select
  rear_wiper.id,
  'RWB' || lpad(length_value::text, 2, '0'),
  34.99,
  25,
  jsonb_build_object('length', length_value)
from rear_wiper
cross join unnest(array[8,10,11,12,13,14,15,16]) as length_value
on conflict (sku) do update set
  price = excluded.price,
  stock = excluded.stock,
  attributes = excluded.attributes,
  active = true;

with lighting_bundle as (
  insert into products (
    slug,
    name,
    category_slug,
    price,
    description,
    images,
    detail_sections
  )
  values (
    'h11-headlight-license-plate-bulb-bundle',
    'H11 Headlight & Licence Plate Bulb Bundle',
    'bulb',
    65.00,
    'A practical lighting refresh bundle with four H11 12V halogen bulbs plus licence plate light bulbs for everyday replacement needs.',
    array['/products/halogen-bulb.png'],
    '[
      {
        "title": "Bundle Contents",
        "body": "Includes four H11 12V halogen replacement bulbs for vehicles that use H11 fitment, plus licence plate light bulbs for a clean exterior lighting refresh."
      },
      {
        "title": "H11 Replacement Use",
        "body": "H11 bulbs are commonly used in low beam, fog light, and daytime running light applications depending on the vehicle. Always confirm your existing bulb type or owner manual before ordering."
      },
      {
        "title": "Licence Plate Lighting",
        "body": "The included licence plate bulbs suit common 12V wedge-style replacement applications used for number plate illumination on many vehicles."
      },
      {
        "title": "Designed for Simple Maintenance",
        "body": "A convenient value pack for drivers who want to refresh multiple exterior bulbs in one order without buying each item separately."
      }
    ]'::jsonb
  )
  on conflict (slug) do update set
    name = excluded.name,
    category_slug = excluded.category_slug,
    price = excluded.price,
    description = excluded.description,
    images = excluded.images,
    detail_sections = excluded.detail_sections,
    active = true
  returning id
)
update product_variants
set
  price = 65.00,
  stock = stock,
  attributes = attributes,
  active = true
from lighting_bundle
where product_variants.product_id = lighting_bundle.id
  and product_variants.sku = 'NXLB-H11-4P-LP';

with battery_product as (
  insert into products (
    slug,
    name,
    category_slug,
    price,
    description,
    images,
    detail_sections
  )
  values (
    'vehicle-fit-battery',
    'Vehicle Fit Battery',
    'battery',
    249.99,
    'Battery fitment depends on your exact vehicle. Contact us with your vehicle details so we can confirm the correct option.',
    array[]::text[],
    '[
      {
        "title": "Fitment Required",
        "body": "Battery compatibility depends on tray size, terminal layout, hold-down style, and cold-cranking requirements. Contact us to confirm the correct battery for your vehicle."
      }
    ]'::jsonb
  )
  on conflict (slug) do update set
    name = excluded.name,
    category_slug = excluded.category_slug,
    price = excluded.price,
    description = excluded.description,
    images = excluded.images,
    detail_sections = excluded.detail_sections,
    active = true
  returning id
),
battery_attr as (
  insert into product_attributes (product_id, attributes)
  select
    id,
    '{"fitment":["Contact us with vehicle details"]}'::jsonb
  from battery_product
  on conflict (product_id) do update set attributes = excluded.attributes
  returning product_id
)
insert into product_variants (product_id, sku, price, stock, attributes)
select
  battery_product.id,
  'BAT-CONTACT',
  249.99,
  0,
  '{"fitment":"Contact us with vehicle details"}'::jsonb
from battery_product
on conflict (sku) do update set
  price = excluded.price,
  stock = excluded.stock,
  attributes = excluded.attributes,
  active = true;

with oil_filter_product as (
  insert into products (
    slug,
    name,
    category_slug,
    price,
    description,
    images,
    detail_sections
  )
  values (
    'vehicle-fit-oil-filter',
    'Vehicle Fit Oil Filter',
    'filter',
    24.99,
    'Oil filter fitment depends on the exact engine and vehicle application. Contact us with your vehicle details so we can confirm the correct filter.',
    array[]::text[],
    '[
      {
        "title": "Engine Fitment Required",
        "body": "Oil filters vary by engine code and production range. Contact us with your vehicle details so we can confirm the correct oil filter before ordering."
      }
    ]'::jsonb
  )
  on conflict (slug) do update set
    name = excluded.name,
    category_slug = excluded.category_slug,
    price = excluded.price,
    description = excluded.description,
    images = excluded.images,
    detail_sections = excluded.detail_sections,
    active = true
  returning id
),
oil_filter_attr as (
  insert into product_attributes (product_id, attributes)
  select
    id,
    '{"fitment":["Contact us with vehicle details"]}'::jsonb
  from oil_filter_product
  on conflict (product_id) do update set attributes = excluded.attributes
  returning product_id
)
insert into product_variants (product_id, sku, price, stock, attributes)
select
  oil_filter_product.id,
  'OF-CONTACT',
  24.99,
  0,
  '{"fitment":"Contact us with vehicle details"}'::jsonb
from oil_filter_product
on conflict (sku) do update set
  price = excluded.price,
  stock = excluded.stock,
  attributes = excluded.attributes,
  active = true;
