import type { User } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase";

export type CustomerVehicleInput = {
  applicationId: string;
  make: string;
  model: string;
  year: number;
};

export type CustomerProfile = {
  id: string;
  authUserId: string | null;
  email: string;
  name: string | null;
};

export type CustomerVehicle = {
  id: string;
  applicationId: string | null;
  make: string;
  model: string;
  year: number;
  source: string;
  lastUsedAt: string;
};

type CustomerProfileRow = {
  id: string;
  auth_user_id: string | null;
  email: string;
  name: string | null;
};

type CustomerVehicleRow = {
  id: string;
  vehicle_application_id: string | null;
  make_snapshot: string;
  model_snapshot: string;
  year: number;
  source: string;
  last_used_at: string;
};

function getAdminOrThrow() {
  const supabase = createSupabaseAdminClient();

  if (!supabase) {
    throw new Error("Supabase service role key is required for account data.");
  }

  return supabase;
}

export async function getOrCreateCustomerProfile(user: User) {
  const email = user.email?.toLowerCase();

  if (!email) {
    throw new Error("Authenticated user email is required.");
  }

  const supabase = getAdminOrThrow();
  const { data, error } = await supabase
    .from("customer_profiles")
    .upsert(
      {
        auth_user_id: user.id,
        email,
        name: user.user_metadata?.name ?? user.user_metadata?.full_name ?? null,
        updated_at: new Date().toISOString()
      },
      { onConflict: "email" }
    )
    .select("id,auth_user_id,email,name")
    .single();

  if (error) throw error;
  return mapProfile(data as CustomerProfileRow);
}

export async function listCustomerVehicles(profileId: string) {
  const supabase = getAdminOrThrow();
  const { data, error } = await supabase
    .from("customer_vehicles")
    .select("id,vehicle_application_id,make_snapshot,model_snapshot,year,source,last_used_at")
    .eq("customer_profile_id", profileId)
    .order("last_used_at", { ascending: false });

  if (error) throw error;
  return (data as CustomerVehicleRow[]).map(mapVehicle);
}

export async function saveCustomerVehicle(user: User, vehicle: CustomerVehicleInput) {
  const profile = await getOrCreateCustomerProfile(user);
  const supabase = getAdminOrThrow();
  const email = profile.email.toLowerCase();

  const { data, error } = await supabase
    .from("customer_vehicles")
    .upsert(
      {
        customer_profile_id: profile.id,
        auth_user_id: user.id,
        email,
        vehicle_application_id: vehicle.applicationId,
        make_snapshot: vehicle.make,
        model_snapshot: vehicle.model,
        year: vehicle.year,
        source: "fitment_lookup",
        last_used_at: new Date().toISOString()
      },
      { onConflict: "email,vehicle_application_id,year" }
    )
    .select("id,vehicle_application_id,make_snapshot,model_snapshot,year,source,last_used_at")
    .single();

  if (error) throw error;

  return {
    profile,
    vehicle: mapVehicle(data as CustomerVehicleRow)
  };
}

function mapProfile(row: CustomerProfileRow): CustomerProfile {
  return {
    id: row.id,
    authUserId: row.auth_user_id,
    email: row.email,
    name: row.name
  };
}

function mapVehicle(row: CustomerVehicleRow): CustomerVehicle {
  return {
    id: row.id,
    applicationId: row.vehicle_application_id,
    make: row.make_snapshot,
    model: row.model_snapshot,
    year: row.year,
    source: row.source,
    lastUsedAt: row.last_used_at
  };
}
