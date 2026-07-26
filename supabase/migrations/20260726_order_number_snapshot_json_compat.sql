-- Make order number allocation compatible with historical items_snapshot shapes.
-- Some early orders stored items_snapshot as a JSON array, so jsonb_set(..., '{order_number}', ...)
-- fails because arrays require integer path elements. Preserve those legacy snapshots under
-- legacy_items_snapshot and store order_number in a stable object wrapper.

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
        continue;
    end;
  end loop;
end;
$$;
