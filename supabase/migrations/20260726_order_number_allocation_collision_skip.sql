-- Make order number allocation resilient to existing historical/manual numbers.
-- Format remains NEX00001, NEX00002, ...
-- If the generated number already exists, the function consumes it and tries the next value.

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
        items_snapshot = jsonb_set(
          coalesce(items_snapshot, '{}'::jsonb),
          '{order_number}',
          to_jsonb(next_order_number),
          true
        ),
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
        continue;
    end;
  end loop;
end;
$$;
