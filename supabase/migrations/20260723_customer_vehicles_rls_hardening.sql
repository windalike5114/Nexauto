alter table public.customer_vehicles enable row level security;

revoke all on table public.customer_vehicles from anon;

drop policy if exists "Customers can read own vehicles" on public.customer_vehicles;
create policy "Customers can read own vehicles"
  on public.customer_vehicles for select
  to authenticated
  using (
    public.customer_profile_belongs_to_auth_user(customer_profile_id, auth.uid())
  );

drop policy if exists "Customers can insert own vehicles" on public.customer_vehicles;
create policy "Customers can insert own vehicles"
  on public.customer_vehicles for insert
  to authenticated
  with check (
    public.customer_profile_belongs_to_auth_user(customer_profile_id, auth.uid())
  );

drop policy if exists "Customers can update own vehicles" on public.customer_vehicles;
create policy "Customers can update own vehicles"
  on public.customer_vehicles for update
  to authenticated
  using (
    public.customer_profile_belongs_to_auth_user(customer_profile_id, auth.uid())
  )
  with check (
    public.customer_profile_belongs_to_auth_user(customer_profile_id, auth.uid())
  );

drop policy if exists "Customers can delete own vehicles" on public.customer_vehicles;
create policy "Customers can delete own vehicles"
  on public.customer_vehicles for delete
  to authenticated
  using (
    public.customer_profile_belongs_to_auth_user(customer_profile_id, auth.uid())
  );
