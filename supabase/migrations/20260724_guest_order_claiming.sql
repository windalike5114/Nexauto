alter table public.orders
  add column if not exists customer_profile_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_customer_profile_id_fkey'
  ) then
    alter table public.orders
      add constraint orders_customer_profile_id_fkey
      foreign key (customer_profile_id)
      references public.customer_profiles(id)
      on delete set null;
  end if;
end $$;

create index if not exists orders_customer_profile_id_idx
  on public.orders(customer_profile_id);

create index if not exists orders_normalized_email_status_unowned_idx
  on public.orders(lower(btrim(email)), status, created_at desc)
  where customer_profile_id is null
    and email is not null
    and btrim(email) <> '';

create table if not exists public.order_claim_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  customer_profile_id uuid references public.customer_profiles(id) on delete set null,
  auth_user_id uuid,
  normalized_email text not null,
  claim_method text not null,
  status text not null,
  reason text,
  source text not null default 'account_initialization',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint order_claim_events_method_check check (
    claim_method in (
      'authenticated_checkout',
      'verified_email_claim',
      'admin_manual_claim',
      'migration_backfill'
    )
  ),
  constraint order_claim_events_status_check check (
    status in (
      'claimed',
      'already_owned',
      'skipped_ineligible',
      'conflict',
      'failed'
    )
  )
);

create index if not exists order_claim_events_order_idx
  on public.order_claim_events(order_id, created_at desc);

create index if not exists order_claim_events_profile_idx
  on public.order_claim_events(customer_profile_id, created_at desc);

create unique index if not exists order_claim_events_result_uidx
  on public.order_claim_events (
    order_id,
    customer_profile_id,
    claim_method,
    status,
    reason
  )
  where status in (
    'claimed',
    'already_owned',
    'conflict',
    'skipped_ineligible'
  );

create or replace function public.claim_customer_orders_for_verified_user(
  p_auth_user_id uuid,
  p_verified_email text
)
returns table (
  claimed_count integer,
  already_owned_count integer,
  conflict_count integer,
  skipped_count integer,
  claimed_order_ids uuid[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.customer_profiles%rowtype;
  v_profile_count integer;
  v_profile_email text;
  v_verified_email text;
  v_claimed_ids uuid[] := '{}';
  v_claimed_count integer := 0;
  v_already_owned_count integer := 0;
  v_conflict_count integer := 0;
  v_skipped_count integer := 0;
begin
  if p_auth_user_id is null then
    raise exception 'auth_user_required';
  end if;

  v_verified_email := lower(btrim(coalesce(p_verified_email, '')));

  if v_verified_email = '' then
    raise exception 'verified_email_required';
  end if;

  select count(*)
  into v_profile_count
  from public.customer_profiles
  where auth_user_id = p_auth_user_id;

  if v_profile_count = 0 then
    raise exception 'customer_profile_not_found';
  end if;

  if v_profile_count > 1 then
    raise exception 'duplicate_customer_profile';
  end if;

  select *
  into v_profile
  from public.customer_profiles
  where auth_user_id = p_auth_user_id
  limit 1;

  v_profile_email := lower(btrim(coalesce(v_profile.email, '')));

  if v_profile_email = '' then
    raise exception 'customer_profile_email_missing';
  end if;

  if v_verified_email <> v_profile_email then
    raise exception 'customer_profile_email_mismatch';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('order_claim:' || v_profile.id::text, 0)
  );

  select count(*)
  into v_already_owned_count
  from public.orders o
  where lower(btrim(o.email)) = v_verified_email
    and o.status in ('paid', 'refunded')
    and o.customer_profile_id = v_profile.id;

  select count(*)
  into v_conflict_count
  from public.orders o
  where lower(btrim(o.email)) = v_verified_email
    and o.status in ('paid', 'refunded')
    and o.customer_profile_id is not null
    and o.customer_profile_id <> v_profile.id;

  select count(*)
  into v_skipped_count
  from public.orders o
  where lower(btrim(o.email)) = v_verified_email
    and o.status in ('pending', 'failed', 'cancelled')
    and o.customer_profile_id is null;

  with matching_unowned as (
    select o.id
    from public.orders o
    where lower(btrim(o.email)) = v_verified_email
      and o.status in ('paid', 'refunded')
      and o.customer_profile_id is null
    for update
  ),
  updated as (
    update public.orders o
    set
      customer_profile_id = v_profile.id,
      updated_at = now()
    from matching_unowned m
    where o.id = m.id
    returning o.id
  ),
  inserted_claims as (
    insert into public.order_claim_events (
      order_id,
      customer_profile_id,
      auth_user_id,
      normalized_email,
      claim_method,
      status,
      reason,
      source
    )
    select
      u.id,
      v_profile.id,
      p_auth_user_id,
      v_verified_email,
      'verified_email_claim',
      'claimed',
      'matched_verified_email',
      'account_initialization'
    from updated u
    on conflict do nothing
    returning order_id
  )
  select
    coalesce(array_agg(order_id), '{}'),
    count(*)::integer
  into v_claimed_ids, v_claimed_count
  from inserted_claims;

  insert into public.order_claim_events (
    order_id,
    customer_profile_id,
    auth_user_id,
    normalized_email,
    claim_method,
    status,
    reason,
    source
  )
  select
    o.id,
    v_profile.id,
    p_auth_user_id,
    v_verified_email,
    'verified_email_claim',
    'already_owned',
    'order_already_owned_by_profile',
    'account_initialization'
  from public.orders o
  where lower(btrim(o.email)) = v_verified_email
    and o.status in ('paid', 'refunded')
    and o.customer_profile_id = v_profile.id
    and not (o.id = any(v_claimed_ids))
  on conflict do nothing;

  insert into public.order_claim_events (
    order_id,
    customer_profile_id,
    auth_user_id,
    normalized_email,
    claim_method,
    status,
    reason,
    source
  )
  select
    o.id,
    v_profile.id,
    p_auth_user_id,
    v_verified_email,
    'verified_email_claim',
    'conflict',
    'order_owned_by_another_profile',
    'account_initialization'
  from public.orders o
  where lower(btrim(o.email)) = v_verified_email
    and o.status in ('paid', 'refunded')
    and o.customer_profile_id is not null
    and o.customer_profile_id <> v_profile.id
  on conflict do nothing;

  insert into public.order_claim_events (
    order_id,
    customer_profile_id,
    auth_user_id,
    normalized_email,
    claim_method,
    status,
    reason,
    source
  )
  select
    o.id,
    v_profile.id,
    p_auth_user_id,
    v_verified_email,
    'verified_email_claim',
    'skipped_ineligible',
    'order_status_not_eligible',
    'account_initialization'
  from public.orders o
  where lower(btrim(o.email)) = v_verified_email
    and o.status in ('pending', 'failed', 'cancelled')
    and o.customer_profile_id is null
  on conflict do nothing;

  return query select
    v_claimed_count,
    v_already_owned_count,
    v_conflict_count,
    v_skipped_count,
    v_claimed_ids;
end;
$$;

revoke execute on function public.claim_customer_orders_for_verified_user(uuid, text)
  from public, anon, authenticated;

grant execute on function public.claim_customer_orders_for_verified_user(uuid, text)
  to service_role;
