-- Run this once in Supabase SQL Editor before relying on strict sequential order numbers.
-- Format: NEX00001, NEX00002, ...

alter table orders
  add column if not exists order_number text unique;

create sequence if not exists nex_order_number_seq start 1;

create or replace function allocate_nex_order_number(order_uuid uuid)
returns text
language plpgsql
security definer
as $$
declare
  existing_order_number text;
  next_order_number text;
begin
  select order_number
    into existing_order_number
  from orders
  where id = order_uuid;

  if existing_order_number is not null then
    return existing_order_number;
  end if;

  next_order_number := 'NEX' || lpad(nextval('nex_order_number_seq')::text, 5, '0');

  update orders
  set
    order_number = next_order_number,
    items_snapshot = jsonb_set(
      coalesce(items_snapshot, '{}'::jsonb),
      '{order_number}',
      to_jsonb(next_order_number),
      true
    ),
    updated_at = now()
  where id = order_uuid;

  return next_order_number;
end;
$$;
