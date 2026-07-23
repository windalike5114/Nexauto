-- Add the first lighting bundle while keeping the existing database-first product model.

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
),
bundle_attr as (
  insert into product_attributes (product_id, attributes)
  select
    id,
    '{"bundle":["4 x H11 bulbs + licence plate bulbs"],"voltage":["12V"],"fitment":["Check vehicle bulb type before ordering"]}'::jsonb
  from lighting_bundle
  on conflict (product_id) do update set attributes = excluded.attributes
  returning product_id
)
insert into product_variants (product_id, sku, price, stock, attributes)
select
  lighting_bundle.id,
  'NXLB-H11-4P-LP',
  65.00,
  40,
  '{"bundle":"4 x H11 bulbs + licence plate bulbs","voltage":"12V","fitment":"Check vehicle bulb type before ordering"}'::jsonb
from lighting_bundle
on conflict (sku) do update set
  price = excluded.price,
  stock = excluded.stock,
  attributes = excluded.attributes,
  active = true;
