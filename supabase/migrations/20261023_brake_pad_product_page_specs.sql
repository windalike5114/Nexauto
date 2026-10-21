-- Structured brake-pad specifications for reusable, batch-generated product pages.
-- Missing values stay null and must be omitted from the storefront rather than inferred.

create table if not exists public.brake_pad_variant_specs (
  product_variant_id uuid primary key references public.product_variants(id) on delete cascade,
  part_number text not null,
  axle_position text,
  friction_material text,
  length_mm numeric(8, 2),
  width_mm numeric(8, 2),
  thickness_mm numeric(8, 2),
  pack_description text not null default '1 Set',
  driving_use text,
  wear_sensor_included boolean,
  shims_included boolean,
  hardware_included boolean,
  verification_status text not null default 'generated',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brake_pad_variant_specs_part_number_check check (btrim(part_number) <> ''),
  constraint brake_pad_variant_specs_axle_position_check check (
    axle_position is null or axle_position in ('front', 'rear')
  ),
  constraint brake_pad_variant_specs_length_check check (length_mm is null or length_mm > 0),
  constraint brake_pad_variant_specs_width_check check (width_mm is null or width_mm > 0),
  constraint brake_pad_variant_specs_thickness_check check (thickness_mm is null or thickness_mm > 0),
  constraint brake_pad_variant_specs_pack_check check (btrim(pack_description) <> ''),
  constraint brake_pad_variant_specs_verification_check check (
    verification_status in ('generated', 'review', 'verified', 'rejected')
  ),
  constraint brake_pad_variant_specs_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);

alter table public.brake_pad_variant_specs enable row level security;

drop policy if exists "Public can read visible brake pad specifications" on public.brake_pad_variant_specs;
create policy "Public can read visible brake pad specifications"
  on public.brake_pad_variant_specs for select
  using (
    exists (
      select 1
      from public.product_variants variants
      join public.products products on products.id = variants.product_id
      where variants.id = brake_pad_variant_specs.product_variant_id
        and variants.active = true
        and products.active = true
        and products.visibility_status = 'public'
    )
  );

grant select on public.brake_pad_variant_specs to anon, authenticated, service_role;

comment on table public.brake_pad_variant_specs is
  'Type-specific brake-pad dimensions and pack details used by batch-generated product pages.';
