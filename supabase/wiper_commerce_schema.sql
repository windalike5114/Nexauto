-- Schema for the wiper-focused commerce flow.
-- This migration can be executed after the fitment schema and CAT078 import.

create extension if not exists pgcrypto;

create table if not exists customer_profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  email text not null unique,
  name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists customer_vehicles (
  id uuid primary key default gen_random_uuid(),
  customer_profile_id uuid references customer_profiles(id) on delete cascade,
  auth_user_id uuid,
  email text not null,
  vehicle_application_id uuid references vehicle_applications(id) on delete set null,
  make_snapshot text not null,
  model_snapshot text not null,
  year integer not null,
  source text not null default 'fitment_lookup',
  last_used_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (email, vehicle_application_id, year)
);

create table if not exists wiper_sets (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  slug text not null unique,
  name text not null,
  set_type text not null default 'front_pair',
  driver_length_in numeric(4, 1) not null,
  passenger_length_in numeric(4, 1) not null,
  rear_length_in numeric(4, 1),
  price numeric(10, 2) not null check (price >= 0),
  compare_at_price numeric(10, 2),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wiper_sets_type_check check (set_type in ('front_pair', 'front_rear_set'))
);

create table if not exists wiper_rear_addons (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  rear_length_in numeric(4, 1) not null,
  price numeric(10, 2) not null check (price >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists order_vehicle_snapshots (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  vehicle_application_id uuid references vehicle_applications(id) on delete set null,
  customer_vehicle_id uuid references customer_vehicles(id) on delete set null,
  make_snapshot text not null,
  model_snapshot text not null,
  year integer not null,
  start_raw text,
  end_raw text,
  created_at timestamptz not null default now()
);

create table if not exists order_wiper_fulfillment (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  order_item_id uuid references order_items(id) on delete cascade,
  vehicle_application_id uuid references vehicle_applications(id) on delete set null,
  wiper_set_id uuid references wiper_sets(id) on delete set null,
  driver_length_in numeric(4, 1),
  passenger_length_in numeric(4, 1),
  rear_length_in numeric(4, 1),
  driver_connector text,
  passenger_connector text,
  rear_connector text,
  connector_status text not null default 'pending',
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_wiper_fulfillment_status_check check (
    connector_status in ('pending', 'selected', 'packed', 'fulfilled', 'issue')
  )
);

create table if not exists email_events (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  recipient text not null,
  subject text,
  customer_id uuid references customer_profiles(id) on delete set null,
  order_id uuid references orders(id) on delete set null,
  resend_email_id text,
  status text not null default 'queued',
  error_code text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint email_events_status_check check (
    status in ('queued', 'sent', 'delivered', 'delayed', 'failed', 'bounced', 'complained')
  )
);

create table if not exists contact_enquiries (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  part_or_sku text,
  message text not null,
  source_page text,
  source_url text,
  product_name text,
  product_sku text,
  status text not null default 'new',
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contact_enquiries_status_check check (
    status in ('new', 'in_progress', 'replied', 'closed')
  )
);

create index if not exists customer_profiles_email_idx
  on customer_profiles(email);
create index if not exists customer_vehicles_email_idx
  on customer_vehicles(email);
create index if not exists customer_vehicles_profile_idx
  on customer_vehicles(customer_profile_id);
create index if not exists wiper_sets_lengths_idx
  on wiper_sets(driver_length_in, passenger_length_in, rear_length_in);
create index if not exists wiper_rear_addons_length_idx
  on wiper_rear_addons(rear_length_in);
create index if not exists order_vehicle_snapshots_order_idx
  on order_vehicle_snapshots(order_id);
create index if not exists order_wiper_fulfillment_order_idx
  on order_wiper_fulfillment(order_id);
create index if not exists order_wiper_fulfillment_status_idx
  on order_wiper_fulfillment(connector_status, created_at desc);
create index if not exists email_events_recipient_idx
  on email_events(recipient);
create index if not exists email_events_order_idx
  on email_events(order_id);
create index if not exists email_events_status_idx
  on email_events(status, created_at desc);
create index if not exists email_events_resend_idx
  on email_events(resend_email_id);
create index if not exists contact_enquiries_email_idx
  on contact_enquiries(email);
create index if not exists contact_enquiries_status_idx
  on contact_enquiries(status, created_at desc);

alter table customer_profiles enable row level security;
alter table customer_vehicles enable row level security;
alter table wiper_sets enable row level security;
alter table wiper_rear_addons enable row level security;
alter table order_vehicle_snapshots enable row level security;
alter table order_wiper_fulfillment enable row level security;
alter table email_events enable row level security;
alter table contact_enquiries enable row level security;

drop policy if exists "Public can read active wiper sets" on wiper_sets;
create policy "Public can read active wiper sets"
  on wiper_sets for select
  using (active = true);

drop policy if exists "Public can read active wiper rear addons" on wiper_rear_addons;
create policy "Public can read active wiper rear addons"
  on wiper_rear_addons for select
  using (active = true);

-- Customer profile, garage, order snapshot, and fulfillment writes should be done
-- through service-role APIs or future authenticated policies.

-- Draft seed for front-pair sets generated from imported fitment data.
-- Front-pair daily sale price is 59.99 against a 79.99 brand anchor price.
insert into wiper_sets (
  sku,
  slug,
  name,
  set_type,
  driver_length_in,
  passenger_length_in,
  compare_at_price,
  price,
  active
)
select distinct
  'WPFP' ||
    trim(to_char(greatest(driver_length_in, passenger_length_in), 'FM999D9'), '.') ||
    trim(to_char(least(driver_length_in, passenger_length_in), 'FM999D9'), '.') as sku,
  'wiper-pair-' ||
    trim(to_char(greatest(driver_length_in, passenger_length_in), 'FM999D9'), '.') ||
    '-' ||
    trim(to_char(least(driver_length_in, passenger_length_in), 'FM999D9'), '.') as slug,
  'Front Wiper Pair - ' ||
    trim(to_char(greatest(driver_length_in, passenger_length_in), 'FM999D9'), '.') ||
    '" + ' ||
    trim(to_char(least(driver_length_in, passenger_length_in), 'FM999D9'), '.') ||
    '"' as name,
  'front_pair',
  greatest(driver_length_in, passenger_length_in),
  least(driver_length_in, passenger_length_in),
  79.99,
  59.99,
  true
from wiper_length_fitments
where driver_length_in is not null
  and passenger_length_in is not null
on conflict (slug) do update set
  sku = excluded.sku,
  name = excluded.name,
  set_type = excluded.set_type,
  driver_length_in = excluded.driver_length_in,
  passenger_length_in = excluded.passenger_length_in,
  compare_at_price = excluded.compare_at_price,
  price = excluded.price,
  active = excluded.active,
  updated_at = now();

-- Draft rear add-ons generated from distinct rear blade lengths.
-- Rear add-on price is intentionally isolated from front-pair pricing.
insert into wiper_rear_addons (
  slug,
  name,
  rear_length_in,
  price,
  active
)
select distinct
  'wiper-rear-' || trim(to_char(rear_length_in, 'FM999D9'), '.') as slug,
  'Rear Wiper Blade - ' || trim(to_char(rear_length_in, 'FM999D9'), '.') || '"' as name,
  rear_length_in,
  19.99,
  true
from wiper_length_fitments
where rear_length_in is not null
on conflict (slug) do update set
  name = excluded.name,
  rear_length_in = excluded.rear_length_in,
  price = excluded.price,
  active = excluded.active,
  updated_at = now();
