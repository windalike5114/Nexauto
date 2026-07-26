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
  updated_count integer;
begin
  select order_number
    into existing_order_number
  from orders
  where id = order_uuid;

  if existing_order_number is not null then
    return existing_order_number;
  end if;

  loop
    next_order_number := 'NEX' || lpad(nextval('nex_order_number_seq')::text, 5, '0');

    begin
      update orders
      set
        order_number = next_order_number,
        items_snapshot = case
          when items_snapshot is null then jsonb_build_object('order_number', next_order_number)
          when jsonb_typeof(items_snapshot) = 'object' then jsonb_set(
            items_snapshot,
            '{order_number}',
            to_jsonb(next_order_number),
            true
          )
          else jsonb_build_object(
            'order_number',
            next_order_number,
            'legacy_items_snapshot',
            items_snapshot
          )
        end,
        updated_at = now()
      where id = order_uuid
        and order_number is null;

      get diagnostics updated_count = row_count;

      if updated_count = 1 then
        return next_order_number;
      end if;

      select order_number
        into existing_order_number
      from orders
      where id = order_uuid;

      if existing_order_number is not null then
        return existing_order_number;
      end if;

      raise exception 'Order % was not found while allocating an order number.', order_uuid;
    exception
      when unique_violation then
        -- A historical or manually assigned order already uses this number.
        -- Consume the sequence value and try the next natural number.
        continue;
    end;
  end loop;
end;
$$;
