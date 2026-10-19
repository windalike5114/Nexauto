-- Product publication and checkout safety for generated catalogue content.
-- Existing live products stay purchasable. Every newly inserted product is
-- private/catalog-only and checkout-disabled until it is explicitly approved.

create table if not exists public.catalog_generation_batches (
  id uuid primary key default gen_random_uuid(),
  source_name text not null,
  source_file text,
  prompt_version text,
  generator_name text,
  status text not null default 'draft',
  row_count integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  constraint catalog_generation_batches_status_check
    check (status in ('draft', 'generating', 'review', 'completed', 'failed', 'cancelled')),
  constraint catalog_generation_batches_row_count_check check (row_count >= 0),
  constraint catalog_generation_batches_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);

alter table public.products
  add column if not exists visibility_status text not null default 'internal',
  add column if not exists content_status text not null default 'generated',
  add column if not exists commerce_status text not null default 'catalog_only',
  add column if not exists checkout_enabled boolean not null default false,
  add column if not exists content_origin text not null default 'generated',
  add column if not exists generation_batch_id uuid references public.catalog_generation_batches(id) on delete set null,
  add column if not exists content_generated_at timestamptz,
  add column if not exists content_reviewed_at timestamptz,
  add column if not exists content_reviewed_by uuid,
  add column if not exists content_metadata jsonb not null default '{}'::jsonb;

-- This migration runs once. Products already live before the migration retain
-- their current commerce behaviour; the safe defaults apply to future rows.
update public.products
set visibility_status = 'public',
    content_status = 'approved',
    commerce_status = 'active',
    checkout_enabled = true,
    content_origin = 'manual'
where active = true
  and generation_batch_id is null
  and visibility_status = 'internal'
  and content_status = 'generated'
  and commerce_status = 'catalog_only'
  and checkout_enabled = false;

-- Existing enquiry-only placeholders must remain impossible to purchase.
update public.products
set visibility_status = 'public',
    content_status = 'approved',
    commerce_status = 'enquiry',
    checkout_enabled = false,
    content_origin = 'manual'
where slug in ('vehicle-fit-battery', 'vehicle-fit-oil-filter');

alter table public.products
  drop constraint if exists products_visibility_status_check,
  add constraint products_visibility_status_check
    check (visibility_status in ('internal', 'public', 'archived')),
  drop constraint if exists products_content_status_check,
  add constraint products_content_status_check
    check (content_status in ('generated', 'review', 'approved', 'rejected')),
  drop constraint if exists products_commerce_status_check,
  add constraint products_commerce_status_check
    check (commerce_status in ('catalog_only', 'enquiry', 'active', 'unavailable', 'discontinued')),
  drop constraint if exists products_content_origin_check,
  add constraint products_content_origin_check
    check (content_origin in ('generated', 'supplier', 'imported', 'manual')),
  drop constraint if exists products_content_metadata_object_check,
  add constraint products_content_metadata_object_check
    check (jsonb_typeof(content_metadata) = 'object'),
  drop constraint if exists products_checkout_state_check,
  add constraint products_checkout_state_check check (
    checkout_enabled = false
    or (
      active = true
      and visibility_status = 'public'
      and content_status = 'approved'
      and commerce_status = 'active'
    )
  );

create table if not exists public.product_media (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  media_type text not null default 'image',
  url text not null,
  alt_text text not null default '',
  origin text not null default 'generated',
  review_status text not null default 'generated',
  generation_batch_id uuid references public.catalog_generation_batches(id) on delete set null,
  is_primary boolean not null default false,
  sort_order integer not null default 100,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid,
  constraint product_media_type_check check (media_type in ('image', 'video', 'document')),
  constraint product_media_origin_check check (origin in ('generated', 'supplier', 'imported', 'manual')),
  constraint product_media_review_status_check check (review_status in ('generated', 'review', 'approved', 'rejected')),
  constraint product_media_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);

create unique index if not exists product_media_one_primary_uidx
  on public.product_media(product_id)
  where is_primary = true;
create index if not exists product_media_product_sort_idx
  on public.product_media(product_id, sort_order, created_at);
create index if not exists products_public_catalog_idx
  on public.products(category_slug, created_at desc)
  where active = true and visibility_status = 'public';
create index if not exists products_generation_batch_idx
  on public.products(generation_batch_id)
  where generation_batch_id is not null;

-- Wiper commerce uses dedicated tables, so it receives the same fail-closed
-- lifecycle rather than relying on the generic products table.
alter table public.wiper_sets
  add column if not exists visibility_status text not null default 'internal',
  add column if not exists content_status text not null default 'generated',
  add column if not exists commerce_status text not null default 'catalog_only',
  add column if not exists checkout_enabled boolean not null default false,
  add column if not exists generation_batch_id uuid references public.catalog_generation_batches(id) on delete set null;

-- Historical rows can contain lengths that are no longer allowed. PostgreSQL
-- enforces NOT VALID constraints on every updated row, so temporarily remove
-- the length guards while lifecycle states are backfilled. Invalid rows are
-- explicitly quarantined below before the guards are restored.
alter table public.wiper_sets
  drop constraint if exists wiper_sets_driver_approved_check,
  drop constraint if exists wiper_sets_passenger_approved_check,
  drop constraint if exists wiper_sets_rear_approved_check;

update public.wiper_sets
set visibility_status = 'public',
    content_status = 'approved',
    commerce_status = 'active',
    checkout_enabled = true
where active = true
  and generation_batch_id is null
  and visibility_status = 'internal'
  and content_status = 'generated'
  and commerce_status = 'catalog_only'
  and checkout_enabled = false;

update public.wiper_sets
set visibility_status = 'public',
    content_status = 'review',
    commerce_status = 'catalog_only',
    checkout_enabled = false
where driver_length_in not in (14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 26, 28, 30)
   or passenger_length_in not in (14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 26, 28, 30)
   or (rear_length_in is not null and rear_length_in not in (8, 10, 11, 12, 13, 14, 15, 16));

alter table public.wiper_sets
  drop constraint if exists wiper_sets_visibility_status_check,
  add constraint wiper_sets_visibility_status_check
    check (visibility_status in ('internal', 'public', 'archived')),
  drop constraint if exists wiper_sets_content_status_check,
  add constraint wiper_sets_content_status_check
    check (content_status in ('generated', 'review', 'approved', 'rejected')),
  drop constraint if exists wiper_sets_commerce_status_check,
  add constraint wiper_sets_commerce_status_check
    check (commerce_status in ('catalog_only', 'enquiry', 'active', 'unavailable', 'discontinued')),
  drop constraint if exists wiper_sets_checkout_state_check,
  add constraint wiper_sets_checkout_state_check check (
    checkout_enabled = false
    or (
      active = true
      and visibility_status = 'public'
      and content_status = 'approved'
      and commerce_status = 'active'
    )
  ),
  add constraint wiper_sets_driver_approved_check
    check (driver_length_in in (14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 26, 28, 30)) not valid,
  add constraint wiper_sets_passenger_approved_check
    check (passenger_length_in in (14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 26, 28, 30)) not valid,
  add constraint wiper_sets_rear_approved_check
    check (rear_length_in is null or rear_length_in in (8, 10, 11, 12, 13, 14, 15, 16)) not valid;

alter table public.wiper_rear_addons
  add column if not exists visibility_status text not null default 'internal',
  add column if not exists content_status text not null default 'generated',
  add column if not exists commerce_status text not null default 'catalog_only',
  add column if not exists checkout_enabled boolean not null default false,
  add column if not exists generation_batch_id uuid references public.catalog_generation_batches(id) on delete set null;

alter table public.wiper_rear_addons
  drop constraint if exists wiper_rear_addons_approved_check;

update public.wiper_rear_addons
set visibility_status = 'public',
    content_status = 'approved',
    commerce_status = 'active',
    checkout_enabled = true
where active = true
  and generation_batch_id is null
  and visibility_status = 'internal'
  and content_status = 'generated'
  and commerce_status = 'catalog_only'
  and checkout_enabled = false;

update public.wiper_rear_addons
set visibility_status = 'public',
    content_status = 'review',
    commerce_status = 'catalog_only',
    checkout_enabled = false
where rear_length_in not in (8, 10, 11, 12, 13, 14, 15, 16);

alter table public.wiper_rear_addons
  drop constraint if exists wiper_rear_addons_visibility_status_check,
  add constraint wiper_rear_addons_visibility_status_check
    check (visibility_status in ('internal', 'public', 'archived')),
  drop constraint if exists wiper_rear_addons_content_status_check,
  add constraint wiper_rear_addons_content_status_check
    check (content_status in ('generated', 'review', 'approved', 'rejected')),
  drop constraint if exists wiper_rear_addons_commerce_status_check,
  add constraint wiper_rear_addons_commerce_status_check
    check (commerce_status in ('catalog_only', 'enquiry', 'active', 'unavailable', 'discontinued')),
  drop constraint if exists wiper_rear_addons_checkout_state_check,
  add constraint wiper_rear_addons_checkout_state_check check (
    checkout_enabled = false
    or (
      active = true
      and visibility_status = 'public'
      and content_status = 'approved'
      and commerce_status = 'active'
    )
  ),
  add constraint wiper_rear_addons_approved_check
    check (rear_length_in in (8, 10, 11, 12, 13, 14, 15, 16)) not valid;

-- Checkout reads from a fail-closed database view. A generated product cannot
-- become payable merely because a browser displays it or a variant is active.
create or replace view public.checkout_eligible_product_variants
with (security_invoker = true)
as
select
  variants.id,
  variants.product_id,
  variants.sku,
  variants.price,
  variants.stock,
  variants.attributes,
  variants.active,
  products.name as product_name,
  products.category_slug
from public.product_variants variants
join public.products products on products.id = variants.product_id
where variants.active = true
  and products.active = true
  and products.visibility_status = 'public'
  and products.content_status = 'approved'
  and products.commerce_status = 'active'
  and products.checkout_enabled = true;

alter table public.catalog_generation_batches enable row level security;
alter table public.product_media enable row level security;

drop policy if exists "Public can read published product media" on public.product_media;
create policy "Public can read published product media"
  on public.product_media for select
  using (
    review_status = 'approved'
    and exists (
      select 1
      from public.products
      where products.id = product_media.product_id
        and products.active = true
        and products.visibility_status = 'public'
    )
  );

drop policy if exists "Public can read active products" on public.products;
create policy "Public can read active products"
  on public.products for select
  using (active = true and visibility_status = 'public');

drop policy if exists "Public can read product attributes" on public.product_attributes;
create policy "Public can read product attributes"
  on public.product_attributes for select
  using (
    exists (
      select 1 from public.products
      where products.id = product_attributes.product_id
        and products.active = true
        and products.visibility_status = 'public'
    )
  );

drop policy if exists "Public can read active variants" on public.product_variants;
create policy "Public can read active variants"
  on public.product_variants for select
  using (
    active = true
    and exists (
      select 1 from public.products
      where products.id = product_variants.product_id
        and products.active = true
        and products.visibility_status = 'public'
    )
  );

drop policy if exists "Public can read active wiper sets" on public.wiper_sets;
create policy "Public can read active wiper sets"
  on public.wiper_sets for select
  using (active = true and visibility_status = 'public');

drop policy if exists "Public can read active wiper rear addons" on public.wiper_rear_addons;
create policy "Public can read active wiper rear addons"
  on public.wiper_rear_addons for select
  using (active = true and visibility_status = 'public');

grant select on public.checkout_eligible_product_variants to anon, authenticated, service_role;
