-- Security remediation 2026-10-27. Only ACL, RLS and function search_path change.
-- Capture current grants/configuration before applying. No business records change.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $hardening$
declare
  table_name text;
  signature text;
  function_oid oid;
  privilege_name text;
begin
  foreach table_name in array array['order_claim_events', 'stripe_webhook_events'] loop
    if to_regclass('public.' || table_name) is null then
      raise exception 'Missing private table: %', table_name;
    end if;
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all privileges on table public.%I from PUBLIC, anon, authenticated', table_name);
    if has_table_privilege('anon', 'public.' || table_name, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       or has_table_privilege('authenticated', 'public.' || table_name, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
      raise exception 'Private table still exposed: %', table_name;
    end if;
    foreach privilege_name in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      if not has_table_privilege('service_role', 'public.' || table_name, privilege_name) then
        raise exception 'Service role missing % on %', privilege_name, table_name;
      end if;
    end loop;
  end loop;

  foreach signature in array array[
    'public.allocate_nex_order_number(uuid)',
    'public.save_customer_vehicle_v5(uuid,text,integer,text,text,boolean)',
    'public.upsert_partial_wiper_configuration(smallint,smallint,smallint)',
    'public.upsert_wiper_configuration(smallint,smallint,smallint)'
  ] loop
    function_oid := to_regprocedure(signature);
    if function_oid is null then raise exception 'Missing internal function: %', signature; end if;
    execute format('revoke execute on function %s from PUBLIC, anon, authenticated', signature);
    execute format('alter function %s set search_path to public, pg_temp', signature);
    if has_function_privilege('anon', function_oid, 'EXECUTE')
       or has_function_privilege('authenticated', function_oid, 'EXECUTE')
       or not has_function_privilege('service_role', function_oid, 'EXECUTE') then
      raise exception 'Unexpected internal function privileges: %', signature;
    end if;
  end loop;
end;
$hardening$;
commit;
