-- Backfill natural sequential order numbers for historical orders.
-- Run after:
-- 1. 20260726_order_number_allocation_collision_skip.sql
-- 2. 20260726_order_number_snapshot_json_compat.sql
--
-- This only fills orders where orders.order_number is null.
-- Existing order_number values are preserved.

alter table orders
  add column if not exists order_number text unique;

create sequence if not exists nex_order_number_seq start 1;

do $$
declare
  order_record record;
  allocated_order_number text;
begin
  for order_record in
    select id
    from orders
    where order_number is null
    order by created_at asc, id asc
  loop
    allocated_order_number := allocate_nex_order_number(order_record.id);
  end loop;
end;
$$;

select setval(
  'nex_order_number_seq',
  greatest(
    coalesce(
      (
        select max(substring(order_number from 4)::integer)
        from orders
        where order_number ~ '^NEX[0-9]{5,}$'
      ),
      0
    ),
    1
  ),
  true
);
