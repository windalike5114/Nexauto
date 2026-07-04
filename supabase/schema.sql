create extension if not exists pgcrypto;

create table if not exists categories (
  slug text primary key,
  name text not null,
  description text not null default '',
  sort_order integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  category_slug text not null references categories(slug),
  price numeric(10, 2) not null check (price >= 0),
  description text not null default '',
  detail_sections jsonb not null default '[]'::jsonb,
  video_url text,
  images text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table products add column if not exists detail_sections jsonb not null default '[]'::jsonb;
alter table products add column if not exists video_url text;

create table if not exists product_attributes (
  product_id uuid primary key references products(id) on delete cascade,
  attributes jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint product_attributes_is_object check (jsonb_typeof(attributes) = 'object')
);

create table if not exists product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  sku text not null unique,
  price numeric(10, 2) not null check (price >= 0),
  stock integer not null default 0 check (stock >= 0),
  attributes jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_variants_attributes_is_object check (jsonb_typeof(attributes) = 'object')
);

create index if not exists product_variants_product_id_idx on product_variants(product_id);
create index if not exists product_variants_attributes_gin_idx on product_variants using gin(attributes);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  email text,
  customer_name text,
  shipping_address jsonb not null default '{}'::jsonb,
  billing_address jsonb not null default '{}'::jsonb,
  items_snapshot jsonb not null default '[]'::jsonb,
  subtotal numeric(10, 2) not null default 0,
  currency text not null default 'nzd',
  status text not null default 'pending',
  stripe_session_id text unique,
  stripe_payment_intent_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_status_check check (status in ('pending', 'paid', 'cancelled', 'refunded', 'failed'))
);

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  product_id uuid references products(id),
  variant_id uuid references product_variants(id),
  sku text not null,
  product_name text not null,
  attributes jsonb not null default '{}'::jsonb,
  qty integer not null check (qty > 0),
  unit_price numeric(10, 2) not null check (unit_price >= 0),
  line_total numeric(10, 2) not null check (line_total >= 0),
  created_at timestamptz not null default now()
);

create index if not exists order_items_order_id_idx on order_items(order_id);
create index if not exists orders_status_created_at_idx on orders(status, created_at desc);

-- Reserved for later vehicle fitment search. No frontend route uses these tables in the MVP.
create table if not exists fitment_vehicles (
  id uuid primary key default gen_random_uuid(),
  market text not null default 'NZ',
  year_from integer not null,
  year_to integer,
  make text not null,
  model text not null,
  trim text,
  engine text,
  body text,
  created_at timestamptz not null default now()
);

create table if not exists product_fitments (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  vehicle_id uuid not null references fitment_vehicles(id) on delete cascade,
  position text,
  notes text,
  created_at timestamptz not null default now(),
  unique (product_id, vehicle_id, position)
);

create table if not exists variant_fitments (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references product_variants(id) on delete cascade,
  vehicle_id uuid not null references fitment_vehicles(id) on delete cascade,
  position text,
  notes text,
  created_at timestamptz not null default now(),
  unique (variant_id, vehicle_id, position)
);

-- Structured vehicle fitment foundation. This sits beside the early MVP
-- fitment_vehicles tables above and is intended for parsed catalogue imports.
create table if not exists fitment_import_batches (
  id uuid primary key default gen_random_uuid(),
  source_name text not null,
  source_file text,
  category_slug text references categories(slug),
  imported_by text,
  row_count integer not null default 0,
  parsed_count integer not null default 0,
  skipped_count integer not null default 0,
  error_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists fitment_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references fitment_import_batches(id) on delete cascade,
  row_number integer not null,
  raw_values jsonb not null default '{}'::jsonb,
  detected_row_type text not null,
  parse_status text not null default 'pending',
  parse_notes text[] not null default '{}',
  parsed_values jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (batch_id, row_number),
  constraint fitment_import_rows_status_check check (parse_status in ('ok', 'skipped', 'warning', 'error'))
);

create table if not exists vehicle_makes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  normalized_name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists vehicle_models (
  id uuid primary key default gen_random_uuid(),
  make_id uuid not null references vehicle_makes(id) on delete cascade,
  name text not null,
  normalized_name text not null,
  created_at timestamptz not null default now(),
  unique (make_id, normalized_name)
);

create table if not exists vehicle_applications (
  id uuid primary key default gen_random_uuid(),
  make_id uuid not null references vehicle_makes(id) on delete cascade,
  model_id uuid not null references vehicle_models(id) on delete cascade,
  market text not null default 'NZ',
  year_start integer,
  month_start integer check (month_start between 1 and 12),
  year_end integer,
  month_end integer check (month_end between 1 and 12),
  start_raw text,
  end_raw text,
  source_name text not null default 'unknown',
  source_row_id uuid references fitment_import_rows(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (make_id, model_id, market, year_start, month_start, year_end, month_end, source_name)
);

create table if not exists wiper_length_fitments (
  id uuid primary key default gen_random_uuid(),
  vehicle_application_id uuid not null references vehicle_applications(id) on delete cascade,
  driver_length_in numeric(4, 1),
  passenger_length_in numeric(4, 1),
  rear_length_in numeric(4, 1),
  driver_length_source text,
  passenger_length_source text,
  rear_length_source text,
  source_name text not null default 'unknown',
  source_row_id uuid references fitment_import_rows(id) on delete set null,
  notes text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (vehicle_application_id, source_name)
);

create table if not exists wiper_connector_fitments (
  id uuid primary key default gen_random_uuid(),
  vehicle_application_id uuid not null references vehicle_applications(id) on delete cascade,
  position text not null check (position in ('driver', 'passenger', 'rear')),
  connector_type text not null,
  source_name text not null default 'unknown',
  source_row_id uuid references fitment_import_rows(id) on delete set null,
  notes text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (vehicle_application_id, position, connector_type, source_name)
);

create index if not exists fitment_import_rows_batch_status_idx
  on fitment_import_rows(batch_id, parse_status);
create index if not exists vehicle_applications_lookup_idx
  on vehicle_applications(market, make_id, model_id, year_start, year_end);
create index if not exists wiper_length_fitments_application_idx
  on wiper_length_fitments(vehicle_application_id);
create index if not exists wiper_connector_fitments_application_idx
  on wiper_connector_fitments(vehicle_application_id);

alter table categories enable row level security;
alter table products enable row level security;
alter table product_attributes enable row level security;
alter table product_variants enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table fitment_vehicles enable row level security;
alter table product_fitments enable row level security;
alter table variant_fitments enable row level security;
alter table fitment_import_batches enable row level security;
alter table fitment_import_rows enable row level security;
alter table vehicle_makes enable row level security;
alter table vehicle_models enable row level security;
alter table vehicle_applications enable row level security;
alter table wiper_length_fitments enable row level security;
alter table wiper_connector_fitments enable row level security;

drop policy if exists "Public can read vehicle makes" on vehicle_makes;
create policy "Public can read vehicle makes"
  on vehicle_makes for select
  using (true);

drop policy if exists "Public can read vehicle models" on vehicle_models;
create policy "Public can read vehicle models"
  on vehicle_models for select
  using (true);

drop policy if exists "Public can read active vehicle applications" on vehicle_applications;
create policy "Public can read active vehicle applications"
  on vehicle_applications for select
  using (active = true);

drop policy if exists "Public can read wiper length fitments" on wiper_length_fitments;
create policy "Public can read wiper length fitments"
  on wiper_length_fitments for select
  using (
    exists (
      select 1 from vehicle_applications
      where vehicle_applications.id = wiper_length_fitments.vehicle_application_id
      and vehicle_applications.active = true
    )
  );

drop policy if exists "Public can read wiper connector fitments" on wiper_connector_fitments;
create policy "Public can read wiper connector fitments"
  on wiper_connector_fitments for select
  using (
    exists (
      select 1 from vehicle_applications
      where vehicle_applications.id = wiper_connector_fitments.vehicle_application_id
      and vehicle_applications.active = true
    )
  );

drop policy if exists "Public can read active categories" on categories;
create policy "Public can read active categories"
  on categories for select
  using (active = true);

drop policy if exists "Public can read active products" on products;
create policy "Public can read active products"
  on products for select
  using (active = true);

drop policy if exists "Public can read product attributes" on product_attributes;
create policy "Public can read product attributes"
  on product_attributes for select
  using (
    exists (
      select 1 from products
      where products.id = product_attributes.product_id
      and products.active = true
    )
  );

drop policy if exists "Public can read active variants" on product_variants;
create policy "Public can read active variants"
  on product_variants for select
  using (
    active = true
    and exists (
      select 1 from products
      where products.id = product_variants.product_id
      and products.active = true
    )
  );

insert into categories (slug, name, description, sort_order) values
  ('wiper', 'Wipers', 'Universal blades selected by length and connector.', 10),
  ('bulb', 'Bulbs', 'Replacement headlight bulbs selected by base and voltage.', 20),
  ('brake-pad', 'Brake Pads', 'Reserved for future fitment-based brake products.', 30),
  ('filter', 'Filters', 'Reserved for future engine and cabin filter products.', 40),
  ('battery', 'Batteries', 'Reserved for future battery specification products.', 50)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  sort_order = excluded.sort_order;

with wiper as (
  insert into products (slug, name, category_slug, price, description, images)
  values (
    'universal-wiper-blade',
    'Universal Wiper Blade',
    'wiper',
    19.99,
    'All-weather rubber blade selected by length and connector.',
    array['/products/wiper-blade.png']
  )
  on conflict (slug) do update set
    name = excluded.name,
    category_slug = excluded.category_slug,
    price = excluded.price,
    description = excluded.description,
    images = excluded.images
  returning id
),
wiper_attr as (
  insert into product_attributes (product_id, attributes)
  select id, '{"length":[14,16,18,20,22,24,26,28],"connector":["J-hook","Pin","Side-pin"]}'::jsonb from wiper
  on conflict (product_id) do update set attributes = excluded.attributes
  returning product_id
)
insert into product_variants (product_id, sku, price, stock, attributes)
select
  wiper.id,
  'WIPER-' || length_value || '-' || regexp_replace(upper(connector_value), '[^A-Z0-9]', '', 'g'),
  19.99,
  case when length_value::integer >= 26 and connector_value = 'Side-pin' then 8 else 50 end,
  jsonb_build_object('length', length_value::integer, 'connector', connector_value)
from wiper
cross join unnest(array['14','16','18','20','22','24','26','28']) as length_value
cross join unnest(array['J-hook','Pin','Side-pin']) as connector_value
on conflict (sku) do update set
  price = excluded.price,
  stock = excluded.stock,
  attributes = excluded.attributes,
  active = true;

with bulb as (
  insert into products (slug, name, category_slug, price, description, images)
  values (
    'brightbeam-halogen-bulb',
    'BrightBeam Halogen Bulb',
    'bulb',
    14.99,
    'Road-legal replacement halogen bulb selected by base type and voltage.',
    array['/products/halogen-bulb.png']
  )
  on conflict (slug) do update set
    name = excluded.name,
    category_slug = excluded.category_slug,
    price = excluded.price,
    description = excluded.description,
    images = excluded.images
  returning id
),
bulb_attr as (
  insert into product_attributes (product_id, attributes)
  select id, '{"baseType":["H7","H11"],"voltage":["12V"]}'::jsonb from bulb
  on conflict (product_id) do update set attributes = excluded.attributes
  returning product_id
)
insert into product_variants (product_id, sku, price, stock, attributes)
select bulb.id, variant.sku, variant.price, variant.stock, variant.attributes
from bulb
cross join (
  values
    ('BULB-H7-12V', 14.99::numeric, 42, '{"baseType":"H7","voltage":"12V"}'::jsonb),
    ('BULB-H11-12V', 16.99::numeric, 31, '{"baseType":"H11","voltage":"12V"}'::jsonb)
) as variant(sku, price, stock, attributes)
on conflict (sku) do update set
  price = excluded.price,
  stock = excluded.stock,
  attributes = excluded.attributes,
  active = true;
