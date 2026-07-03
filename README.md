# NexAuto

Database-first auto consumables ecommerce MVP built with Next.js App Router, Tailwind CSS, Supabase, and Stripe Checkout.

## MVP scope

- Browse active products from Supabase
- Filter by category
- Generate product selectors from `product_attributes`
- Match selected attributes to real `product_variants`
- Add SKU-level items to cart with `variantId`
- Create Stripe Checkout sessions after server-side price and stock validation
- Persist paid orders from Stripe webhooks into `orders` and `order_items`
- Reserve vehicle fitment tables for future search without exposing fitment UI yet

## Local setup

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
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
```

Run `supabase/schema.sql` in Supabase SQL editor before loading the app. The seed data is stored in the database, not in the frontend.

## Data model

- `categories`: storefront filters and future product families
- `products`: product display data
- `product_attributes`: dynamic selector schema per product
- `product_variants`: SKU, price, stock, and concrete attribute combinations
- `orders`: payment/order header from Stripe
- `order_items`: line-item rows for admin, reporting, and future stock workflows
- `fitment_vehicles`, `product_fitments`, `variant_fitments`: reserved for future vehicle compatibility

## SKU logic

The frontend does not generate SKU strings. It loads available attributes and variants from Supabase, lets the customer select attributes, then finds the matching active variant. New categories can add new attributes without changing the product page flow.
