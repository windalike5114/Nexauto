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
  checkout_version text,
  pricing_version text,
  pricing_snapshot jsonb,
  reward_state jsonb,
  subtotal numeric(10, 2) not null default 0,
  currency text not null default 'nzd',
  status text not null default 'pending',
  order_number text unique,
  customer_profile_id uuid,
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
  line_subtotal numeric(10, 2),
  line_discount numeric(10, 2),
  line_total numeric(10, 2) not null check (line_total >= 0),
  vehicle_application_id uuid,
  wiper_set_id uuid,
  vehicle_snapshot jsonb,
  product_snapshot jsonb,
  created_at timestamptz not null default now()
);

create index if not exists order_items_order_id_idx on order_items(order_id);
create index if not exists order_items_vehicle_application_idx on order_items(vehicle_application_id);
create index if not exists order_items_wiper_set_idx on order_items(wiper_set_id);
create index if not exists orders_status_created_at_idx on orders(status, created_at desc);
create index if not exists orders_checkout_version_idx on orders(checkout_version);
create index if not exists orders_customer_profile_id_idx on orders(customer_profile_id);
create index if not exists orders_normalized_email_status_unowned_idx
  on orders(lower(btrim(email)), status, created_at desc)
  where customer_profile_id is null
    and email is not null
    and btrim(email) <> '';

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

create table if not exists customer_addresses (
  id uuid primary key default gen_random_uuid(),
  customer_profile_id uuid not null references customer_profiles(id) on delete cascade,
  label text,
  recipient_name text not null,
  company text,
  phone text,
  line1 text not null,
  line2 text,
  suburb text,
  city text not null,
  region text,
  postcode text,
  country text not null default 'NZ',
  is_default_shipping boolean not null default false,
  legacy_import_fingerprint text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_addresses_country_check check (country = 'NZ')
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

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'order_items_vehicle_application_id_fkey'
  ) then
    alter table order_items
      add constraint order_items_vehicle_application_id_fkey
      foreign key (vehicle_application_id) references vehicle_applications(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'order_items_wiper_set_id_fkey'
  ) then
    alter table order_items
      add constraint order_items_wiper_set_id_fkey
      foreign key (wiper_set_id) references wiper_sets(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'orders_customer_profile_id_fkey'
  ) then
    alter table orders
      add constraint orders_customer_profile_id_fkey
      foreign key (customer_profile_id) references customer_profiles(id) on delete set null;
  end if;
end $$;

create table if not exists email_events (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  recipient text not null,
  subject text,
  customer_id uuid references customer_profiles(id) on delete set null,
  order_id uuid references orders(id) on delete set null,
  resend_email_id text,
  dedupe_key text,
  status text not null default 'queued',
  error_code text,
  attempt_count integer not null default 0,
  next_retry_at timestamptz,
  last_error_summary text,
  claimed_at timestamptz,
  last_attempted_at timestamptz,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint email_events_status_check check (
    status in ('queued', 'pending', 'sending', 'sent', 'delivered', 'delayed', 'failed', 'failed_retryable', 'bounced', 'complained')
  )
);

create table if not exists system_audit_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  entity_type text not null,
  entity_id text,
  actor_type text not null,
  actor_id text,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint system_audit_events_actor_type_check check (
    actor_type in ('system', 'admin', 'cron')
  )
);

create table if not exists order_claim_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete restrict,
  customer_profile_id uuid references customer_profiles(id) on delete set null,
  auth_user_id uuid,
  normalized_email text not null,
  claim_method text not null,
  status text not null,
  reason text,
  source text not null default 'account_initialization',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint order_claim_events_method_check check (
    claim_method in (
      'authenticated_checkout',
      'verified_email_claim',
      'admin_manual_claim',
      'migration_backfill'
    )
  ),
  constraint order_claim_events_status_check check (
    status in (
      'claimed',
      'already_owned',
      'skipped_ineligible',
      'conflict',
      'failed'
    )
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

create index if not exists fitment_import_rows_batch_status_idx
  on fitment_import_rows(batch_id, parse_status);
create index if not exists vehicle_applications_lookup_idx
  on vehicle_applications(market, make_id, model_id, year_start, year_end);
create index if not exists wiper_length_fitments_application_idx
  on wiper_length_fitments(vehicle_application_id);
create index if not exists wiper_connector_fitments_application_idx
  on wiper_connector_fitments(vehicle_application_id);
create index if not exists customer_profiles_email_idx
  on customer_profiles(email);
create index if not exists customer_vehicles_email_idx
  on customer_vehicles(email);
create index if not exists customer_vehicles_profile_idx
  on customer_vehicles(customer_profile_id);
create index if not exists customer_addresses_profile_idx
  on customer_addresses(customer_profile_id);
create index if not exists customer_addresses_profile_default_idx
  on customer_addresses(customer_profile_id, is_default_shipping);
create unique index if not exists customer_addresses_one_default_uidx
  on customer_addresses(customer_profile_id)
  where is_default_shipping = true;
create unique index if not exists customer_addresses_legacy_import_uidx
  on customer_addresses(customer_profile_id, legacy_import_fingerprint)
  where legacy_import_fingerprint is not null;
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
create unique index if not exists email_events_dedupe_key_uidx
  on email_events(dedupe_key)
  where dedupe_key is not null;
create index if not exists email_events_retry_idx
  on email_events(status, next_retry_at, updated_at)
  where status in ('failed', 'failed_retryable');
create index if not exists system_audit_events_entity_idx
  on system_audit_events(entity_type, entity_id, created_at desc);
create index if not exists system_audit_events_type_idx
  on system_audit_events(event_type, created_at desc);
create index if not exists order_claim_events_order_idx
  on order_claim_events(order_id, created_at desc);
create index if not exists order_claim_events_profile_idx
  on order_claim_events(customer_profile_id, created_at desc);
create unique index if not exists order_claim_events_result_uidx
  on order_claim_events (
    order_id,
    customer_profile_id,
    claim_method,
    status,
    reason
  )
  where status in (
    'claimed',
    'already_owned',
    'conflict',
    'skipped_ineligible'
  );
create index if not exists contact_enquiries_email_idx
  on contact_enquiries(email);
create index if not exists contact_enquiries_status_idx
  on contact_enquiries(status, created_at desc);

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
alter table customer_profiles enable row level security;
alter table customer_vehicles enable row level security;
alter table customer_addresses enable row level security;
alter table wiper_sets enable row level security;
alter table wiper_rear_addons enable row level security;
alter table order_vehicle_snapshots enable row level security;
alter table order_wiper_fulfillment enable row level security;
alter table email_events enable row level security;
alter table system_audit_events enable row level security;
alter table contact_enquiries enable row level security;

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

drop policy if exists "Public can read active wiper sets" on wiper_sets;
create policy "Public can read active wiper sets"
  on wiper_sets for select
  using (active = true);

drop policy if exists "Public can read active wiper rear addons" on wiper_rear_addons;
create policy "Public can read active wiper rear addons"
  on wiper_rear_addons for select
  using (active = true);

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

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists customer_addresses_set_updated_at on public.customer_addresses;
create trigger customer_addresses_set_updated_at
before update on public.customer_addresses
for each row
execute function public.set_updated_at();

create or replace function public.create_customer_address(
  p_auth_user_id uuid,
  p_label text,
  p_recipient_name text,
  p_company text,
  p_phone text,
  p_line1 text,
  p_line2 text,
  p_suburb text,
  p_city text,
  p_region text,
  p_postcode text,
  p_country text,
  p_is_default_shipping boolean default false,
  p_legacy_import_fingerprint text default null
)
returns public.customer_addresses
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_should_default boolean;
  v_address public.customer_addresses%rowtype;
begin
  select id into v_profile_id
  from public.customer_profiles
  where auth_user_id = p_auth_user_id;

  if v_profile_id is null then
    raise exception 'customer_profile_not_found';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_profile_id::text));

  select (p_is_default_shipping or not exists (
    select 1 from public.customer_addresses
    where customer_profile_id = v_profile_id
  )) into v_should_default;

  if v_should_default then
    update public.customer_addresses
    set is_default_shipping = false
    where customer_profile_id = v_profile_id
      and is_default_shipping = true;
  end if;

  insert into public.customer_addresses (
    customer_profile_id,
    label,
    recipient_name,
    company,
    phone,
    line1,
    line2,
    suburb,
    city,
    region,
    postcode,
    country,
    is_default_shipping,
    legacy_import_fingerprint
  )
  values (
    v_profile_id,
    p_label,
    p_recipient_name,
    p_company,
    p_phone,
    p_line1,
    p_line2,
    p_suburb,
    p_city,
    p_region,
    p_postcode,
    coalesce(p_country, 'NZ'),
    v_should_default,
    p_legacy_import_fingerprint
  )
  returning * into v_address;

  return v_address;
end;
$$;

create or replace function public.set_default_customer_address(
  p_auth_user_id uuid,
  p_address_id uuid
)
returns public.customer_addresses
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_address public.customer_addresses%rowtype;
begin
  select id into v_profile_id
  from public.customer_profiles
  where auth_user_id = p_auth_user_id;

  if v_profile_id is null then
    raise exception 'customer_profile_not_found';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_profile_id::text));

  select * into v_address
  from public.customer_addresses
  where id = p_address_id
    and customer_profile_id = v_profile_id;

  if v_address.id is null then
    raise exception 'address_not_found';
  end if;

  update public.customer_addresses
  set is_default_shipping = false
  where customer_profile_id = v_profile_id
    and is_default_shipping = true
    and id <> p_address_id;

  update public.customer_addresses
  set is_default_shipping = true
  where id = p_address_id
  returning * into v_address;

  return v_address;
end;
$$;

create or replace function public.delete_customer_address(
  p_auth_user_id uuid,
  p_address_id uuid
)
returns table (
  deleted_address_id uuid,
  replacement_default_address_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_was_default boolean;
  v_replacement_id uuid;
begin
  select id into v_profile_id
  from public.customer_profiles
  where auth_user_id = p_auth_user_id;

  if v_profile_id is null then
    raise exception 'customer_profile_not_found';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_profile_id::text));

  select is_default_shipping into v_was_default
  from public.customer_addresses
  where id = p_address_id
    and customer_profile_id = v_profile_id;

  if v_was_default is null then
    raise exception 'address_not_found';
  end if;

  delete from public.customer_addresses
  where id = p_address_id
    and customer_profile_id = v_profile_id;

  if v_was_default then
    select id into v_replacement_id
    from public.customer_addresses
    where customer_profile_id = v_profile_id
    order by updated_at desc, created_at desc, id desc
    limit 1;

    if v_replacement_id is not null then
      update public.customer_addresses
      set is_default_shipping = true
      where id = v_replacement_id;
    end if;
  end if;

  return query select p_address_id, v_replacement_id;
end;
$$;

create or replace function public.customer_profile_belongs_to_auth_user(
  p_customer_profile_id uuid,
  p_auth_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.customer_profiles
    where id = p_customer_profile_id
      and auth_user_id = p_auth_user_id
  );
$$;

revoke all on function public.customer_profile_belongs_to_auth_user(uuid, uuid) from public;
revoke all on function public.customer_profile_belongs_to_auth_user(uuid, uuid) from anon;
grant execute on function public.customer_profile_belongs_to_auth_user(uuid, uuid) to authenticated;
grant execute on function public.customer_profile_belongs_to_auth_user(uuid, uuid) to service_role;

drop policy if exists "Customers can read own addresses" on public.customer_addresses;
create policy "Customers can read own addresses"
  on public.customer_addresses for select
  to authenticated
  using (
    public.customer_profile_belongs_to_auth_user(customer_profile_id, auth.uid())
  );

drop policy if exists "Customers can insert own addresses" on public.customer_addresses;
create policy "Customers can insert own addresses"
  on public.customer_addresses for insert
  to authenticated
  with check (
    public.customer_profile_belongs_to_auth_user(customer_profile_id, auth.uid())
  );

drop policy if exists "Customers can update own addresses" on public.customer_addresses;
create policy "Customers can update own addresses"
  on public.customer_addresses for update
  to authenticated
  using (
    public.customer_profile_belongs_to_auth_user(customer_profile_id, auth.uid())
  )
  with check (
    public.customer_profile_belongs_to_auth_user(customer_profile_id, auth.uid())
  );

drop policy if exists "Customers can delete own addresses" on public.customer_addresses;
create policy "Customers can delete own addresses"
  on public.customer_addresses for delete
  to authenticated
  using (
    public.customer_profile_belongs_to_auth_user(customer_profile_id, auth.uid())
  );

create or replace function public.claim_customer_orders_for_verified_user(
  p_auth_user_id uuid,
  p_verified_email text
)
returns table (
  claimed_count integer,
  already_owned_count integer,
  conflict_count integer,
  skipped_count integer,
  claimed_order_ids uuid[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.customer_profiles%rowtype;
  v_profile_count integer;
  v_profile_email text;
  v_verified_email text;
  v_claimed_ids uuid[] := '{}';
  v_claimed_count integer := 0;
  v_already_owned_count integer := 0;
  v_conflict_count integer := 0;
  v_skipped_count integer := 0;
begin
  if p_auth_user_id is null then
    raise exception 'auth_user_required';
  end if;

  v_verified_email := lower(btrim(coalesce(p_verified_email, '')));

  if v_verified_email = '' then
    raise exception 'verified_email_required';
  end if;

  select count(*)
  into v_profile_count
  from public.customer_profiles
  where auth_user_id = p_auth_user_id;

  if v_profile_count = 0 then
    raise exception 'customer_profile_not_found';
  end if;

  if v_profile_count > 1 then
    raise exception 'duplicate_customer_profile';
  end if;

  select *
  into v_profile
  from public.customer_profiles
  where auth_user_id = p_auth_user_id
  limit 1;

  v_profile_email := lower(btrim(coalesce(v_profile.email, '')));

  if v_profile_email = '' then
    raise exception 'customer_profile_email_missing';
  end if;

  if v_verified_email <> v_profile_email then
    raise exception 'customer_profile_email_mismatch';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('order_claim:' || v_profile.id::text, 0)
  );

  select count(*)
  into v_already_owned_count
  from public.orders o
  where lower(btrim(o.email)) = v_verified_email
    and o.status in ('paid', 'refunded')
    and o.customer_profile_id = v_profile.id;

  select count(*)
  into v_conflict_count
  from public.orders o
  where lower(btrim(o.email)) = v_verified_email
    and o.status in ('paid', 'refunded')
    and o.customer_profile_id is not null
    and o.customer_profile_id <> v_profile.id;

  select count(*)
  into v_skipped_count
  from public.orders o
  where lower(btrim(o.email)) = v_verified_email
    and o.status in ('pending', 'failed', 'cancelled')
    and o.customer_profile_id is null;

  with matching_unowned as (
    select o.id
    from public.orders o
    where lower(btrim(o.email)) = v_verified_email
      and o.status in ('paid', 'refunded')
      and o.customer_profile_id is null
    for update
  ),
  updated as (
    update public.orders o
    set
      customer_profile_id = v_profile.id,
      updated_at = now()
    from matching_unowned m
    where o.id = m.id
    returning o.id
  ),
  inserted_claims as (
    insert into public.order_claim_events (
      order_id,
      customer_profile_id,
      auth_user_id,
      normalized_email,
      claim_method,
      status,
      reason,
      source
    )
    select
      u.id,
      v_profile.id,
      p_auth_user_id,
      v_verified_email,
      'verified_email_claim',
      'claimed',
      'matched_verified_email',
      'account_initialization'
    from updated u
    on conflict do nothing
    returning order_id
  )
  select
    coalesce(array_agg(order_id), '{}'),
    count(*)::integer
  into v_claimed_ids, v_claimed_count
  from inserted_claims;

  insert into public.order_claim_events (
    order_id,
    customer_profile_id,
    auth_user_id,
    normalized_email,
    claim_method,
    status,
    reason,
    source
  )
  select
    o.id,
    v_profile.id,
    p_auth_user_id,
    v_verified_email,
    'verified_email_claim',
    'already_owned',
    'order_already_owned_by_profile',
    'account_initialization'
  from public.orders o
  where lower(btrim(o.email)) = v_verified_email
    and o.status in ('paid', 'refunded')
    and o.customer_profile_id = v_profile.id
    and not (o.id = any(v_claimed_ids))
  on conflict do nothing;

  insert into public.order_claim_events (
    order_id,
    customer_profile_id,
    auth_user_id,
    normalized_email,
    claim_method,
    status,
    reason,
    source
  )
  select
    o.id,
    v_profile.id,
    p_auth_user_id,
    v_verified_email,
    'verified_email_claim',
    'conflict',
    'order_owned_by_another_profile',
    'account_initialization'
  from public.orders o
  where lower(btrim(o.email)) = v_verified_email
    and o.status in ('paid', 'refunded')
    and o.customer_profile_id is not null
    and o.customer_profile_id <> v_profile.id
  on conflict do nothing;

  insert into public.order_claim_events (
    order_id,
    customer_profile_id,
    auth_user_id,
    normalized_email,
    claim_method,
    status,
    reason,
    source
  )
  select
    o.id,
    v_profile.id,
    p_auth_user_id,
    v_verified_email,
    'verified_email_claim',
    'skipped_ineligible',
    'order_status_not_eligible',
    'account_initialization'
  from public.orders o
  where lower(btrim(o.email)) = v_verified_email
    and o.status in ('pending', 'failed', 'cancelled')
    and o.customer_profile_id is null
  on conflict do nothing;

  return query select
    v_claimed_count,
    v_already_owned_count,
    v_conflict_count,
    v_skipped_count,
    v_claimed_ids;
end;
$$;

revoke execute on function public.claim_customer_orders_for_verified_user(uuid, text)
  from public, anon, authenticated;

grant execute on function public.claim_customer_orders_for_verified_user(uuid, text)
  to service_role;

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
  'Premium Front Windscreen Wiper Blade Pair - ' ||
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
