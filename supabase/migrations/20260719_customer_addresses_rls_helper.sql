create or replace function public.customer_profile_belongs_to_auth_user(
  p_customer_profile_id uuid,
  p_auth_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.customer_profiles
    where id = p_customer_profile_id
      and auth_user_id = p_auth_user_id
  );
$$;

revoke all on function public.customer_profile_belongs_to_auth_user(uuid, uuid) from public;
revoke all on function public.customer_profile_belongs_to_auth_user(uuid, uuid) from anon;
grant execute on function public.customer_profile_belongs_to_auth_user(uuid, uuid) to authenticated;
grant execute on function public.customer_profile_belongs_to_auth_user(uuid, uuid) to service_role;

drop policy if exists "Customers can read own addresses" on public.customer_addresses;
create policy "Customers can read own addresses"
  on public.customer_addresses for select
  to authenticated
  using (
    public.customer_profile_belongs_to_auth_user(customer_profile_id, auth.uid())
  );

drop policy if exists "Customers can insert own addresses" on public.customer_addresses;
create policy "Customers can insert own addresses"
  on public.customer_addresses for insert
  to authenticated
  with check (
    public.customer_profile_belongs_to_auth_user(customer_profile_id, auth.uid())
  );

drop policy if exists "Customers can update own addresses" on public.customer_addresses;
create policy "Customers can update own addresses"
  on public.customer_addresses for update
  to authenticated
  using (
    public.customer_profile_belongs_to_auth_user(customer_profile_id, auth.uid())
  )
  with check (
    public.customer_profile_belongs_to_auth_user(customer_profile_id, auth.uid())
  );

drop policy if exists "Customers can delete own addresses" on public.customer_addresses;
create policy "Customers can delete own addresses"
  on public.customer_addresses for delete
  to authenticated
  using (
    public.customer_profile_belongs_to_auth_user(customer_profile_id, auth.uid())
  );
