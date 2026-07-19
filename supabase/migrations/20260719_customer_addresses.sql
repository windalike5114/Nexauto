create extension if not exists pgcrypto;

create table if not exists public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  customer_profile_id uuid not null references public.customer_profiles(id) on delete cascade,
  label text,
  recipient_name text not null,
  company text,
  phone text,
  line1 text not null,
  line2 text,
  suburb text,
  city text not null,
  region text,
  postcode text,
  country text not null default 'NZ',
  is_default_shipping boolean not null default false,
  legacy_import_fingerprint text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_addresses_country_check check (country = 'NZ')
);

create index if not exists customer_addresses_profile_idx
  on public.customer_addresses(customer_profile_id);

create index if not exists customer_addresses_profile_default_idx
  on public.customer_addresses(customer_profile_id, is_default_shipping);

create unique index if not exists customer_addresses_one_default_uidx
  on public.customer_addresses(customer_profile_id)
  where is_default_shipping = true;

create unique index if not exists customer_addresses_legacy_import_uidx
  on public.customer_addresses(customer_profile_id, legacy_import_fingerprint)
  where legacy_import_fingerprint is not null;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists customer_addresses_set_updated_at on public.customer_addresses;
create trigger customer_addresses_set_updated_at
before update on public.customer_addresses
for each row
execute function public.set_updated_at();

create or replace function public.create_customer_address(
  p_auth_user_id uuid,
  p_label text,
  p_recipient_name text,
  p_company text,
  p_phone text,
  p_line1 text,
  p_line2 text,
  p_suburb text,
  p_city text,
  p_region text,
  p_postcode text,
  p_country text,
  p_is_default_shipping boolean default false,
  p_legacy_import_fingerprint text default null
)
returns public.customer_addresses
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_should_default boolean;
  v_address public.customer_addresses%rowtype;
begin
  select id into v_profile_id
  from public.customer_profiles
  where auth_user_id = p_auth_user_id;

  if v_profile_id is null then
    raise exception 'customer_profile_not_found';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_profile_id::text));

  select (p_is_default_shipping or not exists (
    select 1 from public.customer_addresses
    where customer_profile_id = v_profile_id
  )) into v_should_default;

  if v_should_default then
    update public.customer_addresses
    set is_default_shipping = false
    where customer_profile_id = v_profile_id
      and is_default_shipping = true;
  end if;

  insert into public.customer_addresses (
    customer_profile_id,
    label,
    recipient_name,
    company,
    phone,
    line1,
    line2,
    suburb,
    city,
    region,
    postcode,
    country,
    is_default_shipping,
    legacy_import_fingerprint
  )
  values (
    v_profile_id,
    p_label,
    p_recipient_name,
    p_company,
    p_phone,
    p_line1,
    p_line2,
    p_suburb,
    p_city,
    p_region,
    p_postcode,
    coalesce(p_country, 'NZ'),
    v_should_default,
    p_legacy_import_fingerprint
  )
  returning * into v_address;

  return v_address;
end;
$$;

create or replace function public.set_default_customer_address(
  p_auth_user_id uuid,
  p_address_id uuid
)
returns public.customer_addresses
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_address public.customer_addresses%rowtype;
begin
  select id into v_profile_id
  from public.customer_profiles
  where auth_user_id = p_auth_user_id;

  if v_profile_id is null then
    raise exception 'customer_profile_not_found';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_profile_id::text));

  select * into v_address
  from public.customer_addresses
  where id = p_address_id
    and customer_profile_id = v_profile_id;

  if v_address.id is null then
    raise exception 'address_not_found';
  end if;

  update public.customer_addresses
  set is_default_shipping = false
  where customer_profile_id = v_profile_id
    and is_default_shipping = true
    and id <> p_address_id;

  update public.customer_addresses
  set is_default_shipping = true
  where id = p_address_id
  returning * into v_address;

  return v_address;
end;
$$;

create or replace function public.delete_customer_address(
  p_auth_user_id uuid,
  p_address_id uuid
)
returns table (
  deleted_address_id uuid,
  replacement_default_address_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_was_default boolean;
  v_replacement_id uuid;
begin
  select id into v_profile_id
  from public.customer_profiles
  where auth_user_id = p_auth_user_id;

  if v_profile_id is null then
    raise exception 'customer_profile_not_found';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_profile_id::text));

  select is_default_shipping into v_was_default
  from public.customer_addresses
  where id = p_address_id
    and customer_profile_id = v_profile_id;

  if v_was_default is null then
    raise exception 'address_not_found';
  end if;

  delete from public.customer_addresses
  where id = p_address_id
    and customer_profile_id = v_profile_id;

  if v_was_default then
    select id into v_replacement_id
    from public.customer_addresses
    where customer_profile_id = v_profile_id
    order by updated_at desc, created_at desc, id desc
    limit 1;

    if v_replacement_id is not null then
      update public.customer_addresses
      set is_default_shipping = true
      where id = v_replacement_id;
    end if;
  end if;

  return query select p_address_id, v_replacement_id;
end;
$$;

alter table public.customer_addresses enable row level security;

drop policy if exists "Customers can read own addresses" on public.customer_addresses;
create policy "Customers can read own addresses"
  on public.customer_addresses for select
  to authenticated
  using (
    exists (
      select 1 from public.customer_profiles
      where public.customer_profiles.id = public.customer_addresses.customer_profile_id
        and public.customer_profiles.auth_user_id = auth.uid()
    )
  );

drop policy if exists "Customers can insert own addresses" on public.customer_addresses;
create policy "Customers can insert own addresses"
  on public.customer_addresses for insert
  to authenticated
  with check (
    exists (
      select 1 from public.customer_profiles
      where public.customer_profiles.id = public.customer_addresses.customer_profile_id
        and public.customer_profiles.auth_user_id = auth.uid()
    )
  );

drop policy if exists "Customers can update own addresses" on public.customer_addresses;
create policy "Customers can update own addresses"
  on public.customer_addresses for update
  to authenticated
  using (
    exists (
      select 1 from public.customer_profiles
      where public.customer_profiles.id = public.customer_addresses.customer_profile_id
        and public.customer_profiles.auth_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.customer_profiles
      where public.customer_profiles.id = public.customer_addresses.customer_profile_id
        and public.customer_profiles.auth_user_id = auth.uid()
    )
  );

drop policy if exists "Customers can delete own addresses" on public.customer_addresses;
create policy "Customers can delete own addresses"
  on public.customer_addresses for delete
  to authenticated
  using (
    exists (
      select 1 from public.customer_profiles
      where public.customer_profiles.id = public.customer_addresses.customer_profile_id
        and public.customer_profiles.auth_user_id = auth.uid()
    )
  );

revoke all on function public.create_customer_address(uuid, text, text, text, text, text, text, text, text, text, text, text, boolean, text) from public;
revoke all on function public.create_customer_address(uuid, text, text, text, text, text, text, text, text, text, text, text, boolean, text) from anon;
revoke all on function public.create_customer_address(uuid, text, text, text, text, text, text, text, text, text, text, text, boolean, text) from authenticated;
grant execute on function public.create_customer_address(uuid, text, text, text, text, text, text, text, text, text, text, text, boolean, text) to service_role;

revoke all on function public.set_default_customer_address(uuid, uuid) from public;
revoke all on function public.set_default_customer_address(uuid, uuid) from anon;
revoke all on function public.set_default_customer_address(uuid, uuid) from authenticated;
grant execute on function public.set_default_customer_address(uuid, uuid) to service_role;

revoke all on function public.delete_customer_address(uuid, uuid) from public;
revoke all on function public.delete_customer_address(uuid, uuid) from anon;
revoke all on function public.delete_customer_address(uuid, uuid) from authenticated;
grant execute on function public.delete_customer_address(uuid, uuid) to service_role;

revoke all on table public.customer_addresses from anon;
