# NexAuto

Wiper-focused ecommerce MVP built with Next.js App Router, Tailwind CSS, Supabase, and Stripe Checkout.

## Current Scope

- Vehicle-based wiper finder from Supabase fitment data
- Front wiper pair SKU pages such as `WPFP2216`
- Optional rear blade add-on
- Cart and Stripe Checkout
- Stripe webhook order persistence
- Customer email account and saved vehicle garage
- Hidden admin workbench for orders, wiper fulfillment, product pricing, and product content

## Local Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

PowerShell may block `npm.ps1`; on Windows you can run npm through `npm.cmd`.

## Environment

```bash
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
ADMIN_EMAILS=
```

`ADMIN_EMAILS` is a comma-separated allowlist for `/admin`, for example:

```bash
ADMIN_EMAILS=sales@nexauto.co.nz,owner@nexauto.co.nz
```

## Stripe

Checkout session creation is handled by:

```text
POST /api/checkout
```

Stripe webhook endpoint:

```text
POST /api/stripe/webhook
```

For production, configure this webhook URL in Stripe:

```text
https://nexautoparts.co.nz/api/stripe/webhook
```

Listen for:

```text
checkout.session.completed
```

The webhook writes:

- `orders`
- `order_items`
- `customer_profiles`
- `customer_vehicles`
- `order_vehicle_snapshots`
- `order_wiper_fulfillment`

## Supabase

Run these SQL files in Supabase SQL Editor when setting up a fresh database:

```text
supabase/schema.sql
supabase/fitment_schema.sql
supabase/wiper_commerce_schema.sql
supabase/migrations/20261006_vehicle_catalog_v2.sql
```

The V2 migration adds canonical generation, variant, chassis, source mapping,
review, wiper configuration, and reusable product fitment tables without
removing the legacy fitment tables. See `docs/vehicle-catalog-v2-upgrade.md`
for the staged cutover plan.

Then import fitment data and verify:

```bash
npm run vehicle-catalog:report
npm run vehicle-catalog:import
npm run wiper-sources:report
npm run wiper-sources:import
npm run fitment:import
npm run fitment:check
npm run wiper-commerce:check
```

Run `vehicle-catalog:report` before every V2 import. Records marked `review`
remain in the source and review tables but are not promoted into canonical
generation, variant, chassis, or application records.

`wiper-sources:report` is read-only and compares all four supplied wiper
workbooks against the Machter backbone. `wiper-sources:import` stages the
reviewed report in V2; it never publishes a fitment automatically. See
`docs/vehicle-catalog-review-notes.md` for current counts and manual-review
items.

## Wiper SKU Flow

1. Customer selects make, model, and year.
2. Finder resolves blade lengths from `wiper_length_fitments`.
3. Front pair SKU is matched from `wiper_sets`.
4. Customer opens `/wipers/[sku]`.
5. Cart stores SKU, lengths, and vehicle context.
6. Stripe Checkout receives compact metadata.
7. Webhook creates the order and fulfillment row.
8. Admin selects connector details before dispatch.
