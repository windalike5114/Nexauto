-- All raw vehicle catalogue objects are served through validated server queries.
-- Keep current policies for rollback evidence; table/view ACL is the outer boundary.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
do $catalog_access$
declare
  target record;
  object_count integer := 0;
begin
  for target in
    select c.oid, c.relname, c.relkind
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','p','v','m')
      and c.relname ~ '^vehicle_catalog_'
  loop
    object_count := object_count + 1;
    if target.relkind in ('r','p') then
      execute format('alter table public.%I enable row level security', target.relname);
    end if;
    execute format('revoke all privileges on table public.%I from PUBLIC, anon, authenticated', target.relname);
    if has_table_privilege('anon', target.oid, 'SELECT,INSERT,UPDATE,DELETE')
       or has_table_privilege('authenticated', target.oid, 'SELECT,INSERT,UPDATE,DELETE')
       or not has_table_privilege('service_role', target.oid, 'SELECT') then
      raise exception 'Unexpected catalogue privileges: %', target.relname;
    end if;
  end loop;
  if object_count < 19 then raise exception 'Unexpectedly small catalogue object set: %', object_count; end if;
end;
$catalog_access$;
commit;
