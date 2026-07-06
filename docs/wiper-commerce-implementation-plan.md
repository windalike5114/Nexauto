# Wiper Commerce Implementation Plan

## Direction

NexAuto is moving from a broad MVP catalog into a focused wiper tool-store. The core customer promise is:

1. Find the correct wiper lengths by vehicle.
2. Buy a front pair as a simple length combination.
3. Leave connector selection to admin fulfillment.
4. Save the queried or purchased vehicle to the customer's garage.

Other categories stay reserved in the catalog and database, but no new frontend buying flow should be built for them until the wiper loop is stable.

## Current State

Implemented:

- Product catalog from Supabase.
- Variant-driven product page.
- Cart and Stripe Checkout for `product_variants`.
- Wiper fitment database:
  - `vehicle_makes`
  - `vehicle_models`
  - `vehicle_applications`
  - `wiper_length_fitments`
  - reserved `wiper_connector_fitments`
- Wiper finder:
  - Make
  - Model
  - Year
  - driver/passenger/rear length result

Important limitation:

- The finder currently links to the existing single-blade product page.
- The cart currently expects product variant IDs.
- The order webhook currently writes variant-based order items only.
- Customer garage and admin connector fulfillment do not exist yet.

## Business Model Decision

Frontend customer-facing SKU should be a wiper length set, not connector-specific stock.

Customer sees:

```txt
Front Wiper Pair - 22" + 16"
```

Customer-facing SKU format:

```txt
WPFP{LONG}{SHORT}
```

Examples:

```txt
WPFP2216
WPFP2419
WPFP2620
```

Rules:

- `WP` = wiper.
- `FP` = front pair.
- longer blade length comes first when the two sides differ.
- if both sides use the same front length, the length is repeated, for example `18 + 18 -> WPFP1818`.
- connector is not encoded in the customer-facing SKU.
- rear blade is not included in the front-pair SKU.
- only combinations that actually exist in fitment data are generated.

Optional later:

```txt
Front + Rear Wiper Set - 22" + 16" + 14"
```

Rear wiper decision:

```txt
Rear blade is an optional add-on after the front pair is selected.
```

Customer should not choose:

```txt
J-hook
Pin
Side-pin
```

Admin sees connector fields and manually fulfills the order.

## Target Flow

```txt
Vehicle finder
  -> wiper length result
  -> add front pair to cart
  -> Stripe Checkout with email
  -> Stripe webhook creates order
  -> customer profile is created/updated by email
  -> vehicle is saved to customer garage
  -> order includes vehicle and length snapshot
  -> admin manually chooses connector
  -> fulfillment status moves from pending to ready/fulfilled
```

## Data Model

### 1. Customer Profiles

Purpose: provide an email-first customer record even before full account UX is mature.

```sql
create table customer_profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  email text not null unique,
  name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Notes:

- `email` is the stable MVP identity.
- `auth_user_id` can link to Supabase Auth when the customer signs in.
- Checkout can create/update this table without forcing pre-purchase registration.

### 2. Customer Vehicles

Purpose: customer garage.

```sql
create table customer_vehicles (
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
```

Notes:

- Snapshot fields keep history readable if fitment data is later changed.
- The same structure can support future product categories.

### 3. Wiper Sets

Purpose: customer-facing sellable set generated from length combinations.

```sql
create table wiper_sets (
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
```

Example slug:

```txt
wiper-pair-22-16
```

Notes:

- This is not connector-specific.
- It can be seeded from distinct `driver_length_in + passenger_length_in` combinations in `wiper_length_fitments`.
- Inventory can initially be operational rather than strict SKU stock.
- Front-pair MVP price is fixed at NZD 59.99.
- Rear add-on price will be modeled separately so it can be attached to a selected vehicle when rear length exists.

### 3a. Wiper Rear Add-ons

Purpose: optional rear blade item offered only when fitment data includes rear length.

```sql
create table wiper_rear_addons (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  rear_length_in numeric(4, 1) not null,
  price numeric(10, 2) not null check (price >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

The first implementation can seed these by distinct rear lengths. The cart item remains tied to the vehicle snapshot selected in the finder.

### 4. Order Vehicle Snapshots

Purpose: attach vehicle context to order, independent of future fitment edits.

```sql
create table order_vehicle_snapshots (
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
```

### 5. Order Wiper Fulfillment

Purpose: backend connector handling.

```sql
create table order_wiper_fulfillment (
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
```

## Cart Model

Current cart item is variant-only. It should become a discriminated structure.

```ts
type VariantCartItem = {
  type: "variant";
  productId: string;
  variantId: string;
  sku: string;
  name: string;
  category: string;
  qty: number;
  price: number;
  attributes: Record<string, string | number>;
};

type WiperSetCartItem = {
  type: "wiper_set";
  wiperSetId: string;
  rearAddonId?: string | null;
  sku: string;
  name: string;
  qty: number;
  price: number;
  vehicleApplicationId: string;
  vehicle: {
    make: string;
    model: string;
    year: number;
    startRaw?: string | null;
    endRaw?: string | null;
  };
  lengths: {
    driver: number;
    passenger: number;
    rear?: number | null;
  };
  rearAddon?: {
    length: number;
    price: number;
  } | null;
};
```

MVP can keep variant cart support for existing bulb/wiper product pages, but wiper finder purchases should use `wiper_set`.

## Checkout Metadata

Stripe Checkout metadata should include enough to reconstruct the order safely:

```json
{
  "items": [
    {
      "type": "wiper_set",
      "wiper_set_id": "...",
      "qty": 1,
      "price": 39.99,
      "vehicle_application_id": "...",
      "vehicle": {
        "make": "Alfa Romeo",
        "model": "147",
        "year": 2006
      },
      "lengths": {
        "driver": 22,
        "passenger": 16,
        "rear": null
      }
    }
  ]
}
```

The checkout API should validate:

- wiper set exists and is active
- price matches database
- vehicle application exists
- lengths match the selected fitment result or stored wiper set

## Webhook Responsibilities

On `checkout.session.completed`:

1. Create/update `customer_profiles` by email.
2. Create/update `customer_vehicles`.
3. Create `orders`.
4. Create `order_items`.
5. Create `order_vehicle_snapshots`.
6. Create `order_wiper_fulfillment` with:

```txt
connector_status = pending
driver_connector = null
passenger_connector = null
rear_connector = null
```

## Admin Workflow

Admin order screen should prioritize fulfillment, not catalog management.

Display:

```txt
Order ID
Customer email
Vehicle
Driver length
Passenger length
Rear length
Connector status
Admin connector fields
Admin note
```

Actions:

```txt
Set connectors
Mark selected
Mark packed
Mark fulfilled
Flag issue
```

## Frontend Placement

### Home

Keep wiper finder prominent because site direction is tool-store.

### Shop

Only show wiper finder when:

```txt
category=wiper
```

### Product Detail

For wiper product, show finder before manual configuration or replace manual configuration once wiper sets are live.

### Account

Later add:

```txt
My Garage
Saved vehicles
Reorder wipers
```

## Phased Build Plan

### Phase 1: Schema and Seed

Deliver:

- add tables
- seed distinct front-pair `wiper_sets`
- seed distinct rear `wiper_rear_addons`
- add Supabase policies
- add check script

Acceptance:

- database has customer/order fulfillment tables
- wiper sets generated from fitment lengths
- rear add-ons generated from rear fitment lengths
- no frontend behavior changes required

Implementation order:

1. Execute `supabase/wiper_commerce_schema.sql` in Supabase SQL Editor.
2. Execute migration in Supabase SQL Editor.
3. Add typed query helpers for:
   - front-pair wiper set lookup by driver/passenger length
   - rear add-on lookup by rear length
   - customer profile and vehicle upsert
4. Add a check script to report:
   - `wiper_sets` count
   - `wiper_rear_addons` count
   - duplicate length combinations
5. Do not change customer cart behavior in Phase 1.

### Phase 2: Wiper Set Cart

Deliver:

- finder result has `Add front pair to cart`
- cart supports `type = wiper_set`
- cart displays vehicle + lengths

Acceptance:

- user can add a vehicle-specific front pair
- item persists in localStorage
- existing variant cart items still work

### Phase 3: Checkout and Webhook

Deliver:

- checkout accepts mixed cart item types
- Stripe metadata includes vehicle snapshot
- webhook writes customer profile, vehicle, order snapshot, fulfillment row

Acceptance:

- paid order includes vehicle and pending connector status
- customer garage record is created by email

### Phase 4: Admin Fulfillment

Deliver:

- admin order list shows wiper fulfillment queue
- admin can set connector fields and status

Acceptance:

- staff can fulfill an order without looking in Stripe

### Phase 5: Account Garage

Deliver:

- customer account shows saved vehicles
- vehicle can reorder wipers

Acceptance:

- returning customer can buy for saved vehicle with fewer steps

## Decisions To Confirm Before Coding Phase 1

1. Front pair price rule:

```txt
fixed price per pair
or price based on long + short length
```

2. Rear wiper:

```txt
do not sell yet
or optional add-on after front pair
```

3. Existing single-blade product:

```txt
keep for admin/testing
or hide from customer-facing wiper flow
```

4. Customer auth:

```txt
email profile first, login later
or magic link account immediately
```

Recommended defaults:

```txt
front pair fixed price at 59.99
rear as optional add-on
keep single-blade product for test/manual purchase
email profile first
```

Confirmed decisions:

```txt
Front pair price: 59.99
Rear wiper: optional add-on
Existing single-blade product: keep for testing/manual purchase
Customer auth: email profile first, login UX later
```
