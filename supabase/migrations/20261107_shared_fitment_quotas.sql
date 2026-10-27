-- Shared request and distinct-vehicle quotas. No customer or order records.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create table if not exists public.fitment_quota_buckets (
  subject_hash text not null check(subject_hash ~ '^[a-f0-9]{64}$'),
  scope text not null check(scope in ('api','page','total','vehicles')),
  window_seconds integer not null check(window_seconds in (60,900,3600,86400)),
  window_start bigint not null,
  request_count integer not null default 0 check(request_count>=0),
  vehicle_count integer not null default 0 check(vehicle_count>=0),
  expires_at timestamptz not null,
  primary key(subject_hash,scope,window_seconds,window_start)
);
create index if not exists fitment_quota_buckets_expiry_idx on public.fitment_quota_buckets(expires_at);
create table if not exists public.fitment_quota_vehicles (
  subject_hash text not null check(subject_hash ~ '^[a-f0-9]{64}$'),
  window_seconds integer not null check(window_seconds in (900,86400)),
  window_start bigint not null,
  vehicle_hash text not null check(vehicle_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  primary key(subject_hash,window_seconds,window_start,vehicle_hash)
);
create index if not exists fitment_quota_vehicles_expiry_idx on public.fitment_quota_vehicles(expires_at);
alter table public.fitment_quota_buckets enable row level security;
alter table public.fitment_quota_vehicles enable row level security;
revoke all on public.fitment_quota_buckets,public.fitment_quota_vehicles from PUBLIC,anon,authenticated;
grant select,insert,update,delete on public.fitment_quota_buckets,public.fitment_quota_vehicles to service_role;

create or replace function public.consume_fitment_quota(
  p_network_hash text,p_session_hash text,p_vehicle_hash text default null,p_request_class text default 'api'
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $quota$
declare
  now_epoch bigint:=floor(extract(epoch from clock_timestamp()))::bigint;
  subject text; seconds integer; start_epoch bigint; bucket_scope text; idx integer;
  requests integer; vehicles integer; delta integer; ceiling integer;
  request_limit integer:=case when p_request_class='page' then 240 else 90 end;
  remaining integer:=2147483647; vehicle_remaining integer:=2147483647; daily_remaining integer:=2147483647;
  retry_after integer:=0; reason text:=null; plans jsonb:='[]'::jsonb; plan jsonb;
begin
  if p_network_hash is null or p_network_hash !~ '^[a-f0-9]{64}$'
    or p_session_hash is null or p_session_hash !~ '^[a-f0-9]{64}$'
    or (p_vehicle_hash is not null and p_vehicle_hash !~ '^[a-f0-9]{64}$')
    or p_request_class is null or p_request_class not in ('api','page') then raise exception 'Invalid quota input' using errcode='22023'; end if;
  -- Fixed lock order; every instance/host uses the same keys and database clock.
  perform pg_advisory_xact_lock(hashtextextended('fitment-network:'||p_network_hash,0));
  perform pg_advisory_xact_lock(hashtextextended('fitment-session:'||p_session_hash,0));
  for idx in 1..2 loop
    subject:=case when idx=1 then p_network_hash else p_session_hash end;
    foreach seconds in array array[60,3600,900,86400] loop
      start_epoch:=(now_epoch/seconds)*seconds;
      bucket_scope:=case when seconds=60 then p_request_class when seconds=3600 then 'total' else 'vehicles' end;
      select b.request_count,b.vehicle_count into requests,vehicles from public.fitment_quota_buckets b
        where b.subject_hash=subject and b.scope=bucket_scope and b.window_seconds=seconds and b.window_start=start_epoch;
      requests:=coalesce(requests,0); vehicles:=coalesce(vehicles,0); delta:=0;
      if seconds in (60,3600) then
        ceiling:=case when seconds=3600 then case when idx=1 then 24000 else 2400 end
          when idx=1 then case when p_request_class='page' then 6000 else 1800 end else request_limit end;
        if seconds=60 then remaining:=least(remaining,greatest(0,ceiling-requests-1)); end if;
        if requests>=ceiling then
          reason:='request_rate'; retry_after:=greatest(retry_after,(start_epoch+seconds-now_epoch)::integer);
        end if;
      else
        if p_vehicle_hash is not null and not exists(select 1 from public.fitment_quota_vehicles v where v.subject_hash=subject
          and v.window_seconds=seconds and v.window_start=start_epoch and v.vehicle_hash=p_vehicle_hash) then delta:=1; end if;
        ceiling:=case when seconds=900 then case when idx=1 then 300 else 24 end else case when idx=1 then 2000 else 80 end end;
        if seconds=900 then vehicle_remaining:=least(vehicle_remaining,greatest(0,ceiling-vehicles-delta));
        else daily_remaining:=least(daily_remaining,greatest(0,ceiling-vehicles-delta)); end if;
        if vehicles+delta>ceiling then
          reason:=coalesce(reason,'vehicle_quota'); retry_after:=greatest(retry_after,(start_epoch+seconds-now_epoch)::integer);
        end if;
      end if;
      plans:=plans||jsonb_build_array(jsonb_build_object('subject',subject,'scope',bucket_scope,'seconds',seconds,'start',start_epoch,'delta',delta));
    end loop;
  end loop;
  -- No partial consumption if any rule rejects. Repeated known vehicles remain allowed.
  if reason is null then
    for plan in select value from jsonb_array_elements(plans) loop
      if plan->>'scope' <> 'vehicles' or (plan->>'delta')::integer=1 then
        insert into public.fitment_quota_buckets(subject_hash,scope,window_seconds,window_start,request_count,vehicle_count,expires_at)
        values(plan->>'subject',plan->>'scope',(plan->>'seconds')::integer,(plan->>'start')::bigint,
          case when plan->>'scope'='vehicles' then 0 else 1 end,(plan->>'delta')::integer,
          to_timestamp((plan->>'start')::bigint+(plan->>'seconds')::integer+3600))
        on conflict(subject_hash,scope,window_seconds,window_start) do update set
          request_count=public.fitment_quota_buckets.request_count+excluded.request_count,
          vehicle_count=public.fitment_quota_buckets.vehicle_count+excluded.vehicle_count;
      end if;
      if (plan->>'delta')::integer=1 then
        insert into public.fitment_quota_vehicles values(plan->>'subject',(plan->>'seconds')::integer,
          (plan->>'start')::bigint,p_vehicle_hash,to_timestamp((plan->>'start')::bigint+(plan->>'seconds')::integer+3600))
          on conflict do nothing;
      end if;
    end loop;
    -- Bounded opportunistic TTL cleanup; never scans or touches business tables.
    delete from public.fitment_quota_vehicles where ctid in
      (select ctid from public.fitment_quota_vehicles where expires_at<clock_timestamp() limit 100 for update skip locked);
    delete from public.fitment_quota_buckets where ctid in
      (select ctid from public.fitment_quota_buckets where expires_at<clock_timestamp() limit 100 for update skip locked);
  end if;
  return jsonb_build_object('allowed',reason is null,'reason',reason,'retry_after',greatest(1,retry_after),
    'request_limit',request_limit,'remaining',remaining,'reset_after',60-(now_epoch%60),
    'vehicle_limit',24,'vehicle_remaining',case when vehicle_remaining=2147483647 then 24 else vehicle_remaining end,
    'daily_vehicle_limit',80,'daily_vehicle_remaining',case when daily_remaining=2147483647 then 80 else daily_remaining end);
end;
$quota$;
revoke all on function public.consume_fitment_quota(text,text,text,text) from PUBLIC,anon,authenticated;
grant execute on function public.consume_fitment_quota(text,text,text,text) to service_role;
commit;
