-- Product rows are served through the guarded, bounded storefront API.
-- Preserve service_role access used by storefront, stock and checkout.
-- Before applying: save the current ACL and prepare its exact rollback.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
declare target text;
begin
  foreach target in array array[
    'products', 'product_variants', 'product_attributes',
    'wiper_sets', 'wiper_rear_addons', 'checkout_eligible_product_variants'
  ] loop
    if to_regclass('public.' || target) is null then
      raise exception 'Missing catalogue object: %', target;
    end if;
    if not has_table_privilege('service_role', 'public.' || target, 'SELECT') then
      raise exception 'Server SELECT access required: %', target;
    end if;
  end loop;
end $$;

revoke select on table
  public.products, public.product_variants, public.product_attributes,
  public.wiper_sets, public.wiper_rear_addons, public.checkout_eligible_product_variants
from public, anon, authenticated;

do $$
declare target text;
begin
  foreach target in array array[
    'products', 'product_variants', 'product_attributes',
    'wiper_sets', 'wiper_rear_addons', 'checkout_eligible_product_variants'
  ] loop
    if has_table_privilege('anon', 'public.' || target, 'SELECT')
       or has_table_privilege('authenticated', 'public.' || target, 'SELECT')
       or has_any_column_privilege('anon', 'public.' || target, 'SELECT')
       or has_any_column_privilege('authenticated', 'public.' || target, 'SELECT')
       or not has_table_privilege('service_role', 'public.' || target, 'SELECT') then
      raise exception 'Unexpected catalogue access after revoke: %', target;
    end if;
  end loop;
end $$;
commit;

select c.relname as object,
  has_table_privilege('anon', c.oid, 'SELECT') as anon_select,
  has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_select,
  has_table_privilege('service_role', c.oid, 'SELECT') as service_select
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in (
  'products','product_variants','product_attributes',
  'wiper_sets','wiper_rear_addons','checkout_eligible_product_variants'
) order by c.relname;
