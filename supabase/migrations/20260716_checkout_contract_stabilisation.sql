alter table orders
  add column if not exists checkout_version text,
  add column if not exists pricing_version text,
  add column if not exists pricing_snapshot jsonb,
  add column if not exists reward_state jsonb;

alter table order_items
  add column if not exists line_subtotal numeric(10, 2),
  add column if not exists line_discount numeric(10, 2),
  add column if not exists vehicle_application_id uuid references vehicle_applications(id) on delete set null,
  add column if not exists wiper_set_id uuid references wiper_sets(id) on delete set null,
  add column if not exists vehicle_snapshot jsonb,
  add column if not exists product_snapshot jsonb;

update order_items
set
  line_subtotal = coalesce(line_subtotal, unit_price * qty),
  line_discount = coalesce(line_discount, greatest(unit_price * qty - line_total, 0))
where line_subtotal is null
   or line_discount is null;

create index if not exists orders_checkout_version_idx
  on orders(checkout_version);

create index if not exists order_items_vehicle_application_idx
  on order_items(vehicle_application_id);

create index if not exists order_items_wiper_set_idx
  on order_items(wiper_set_id);
