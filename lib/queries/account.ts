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

export type CustomerOrder = {
  id: string;
  orderNumber: string;
  orderDate: string;
  status: string;
  vehicle: string | null;
  products: string[];
  total: number;
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

type CustomerOrderRow = {
  id: string;
  subtotal: string | number;
  status: string;
  created_at: string;
};

type CustomerOrderItemRow = {
  order_id: string;
  product_name: string;
  sku: string;
  qty: number;
};

type CustomerOrderVehicleRow = {
  order_id: string;
  make_snapshot: string;
  model_snapshot: string;
  year: number;
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

export async function getOrCreateCustomerProfileByEmail(emailInput: string, name: string | null = null) {
  const email = emailInput.toLowerCase();
  const supabase = getAdminOrThrow();
  const { data, error } = await supabase
    .from("customer_profiles")
    .upsert(
      {
        email,
        name,
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

export async function listCustomerOrders(emailInput: string) {
  const email = emailInput.toLowerCase();
  const supabase = getAdminOrThrow();
  const { data, error } = await supabase
    .from("orders")
    .select("id,subtotal,status,created_at")
    .eq("email", email)
    .neq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw error;

  const orders = (data ?? []) as CustomerOrderRow[];
  const orderIds = orders.map((order) => order.id);

  if (!orderIds.length) return [];

  const [itemsResult, vehiclesResult] = await Promise.all([
    supabase
      .from("order_items")
      .select("order_id,product_name,sku,qty")
      .in("order_id", orderIds)
      .order("created_at", { ascending: true }),
    supabase
      .from("order_vehicle_snapshots")
      .select("order_id,make_snapshot,model_snapshot,year")
      .in("order_id", orderIds)
  ]);

  if (itemsResult.error) throw itemsResult.error;
  if (vehiclesResult.error) throw vehiclesResult.error;

  const itemsByOrder = groupBy((itemsResult.data ?? []) as CustomerOrderItemRow[], (item) => item.order_id);
  const vehicleByOrder = new Map(
    ((vehiclesResult.data ?? []) as CustomerOrderVehicleRow[]).map((vehicle) => [
      vehicle.order_id,
      `${vehicle.make_snapshot} ${vehicle.model_snapshot} ${vehicle.year}`
    ])
  );

  return orders.map((order): CustomerOrder => ({
    id: order.id,
    orderNumber: `NXA${order.id.replace(/-/g, "").slice(0, 8).toUpperCase()}`,
    orderDate: order.created_at,
    status: order.status,
    vehicle: vehicleByOrder.get(order.id) ?? null,
    products: (itemsByOrder.get(order.id) ?? []).map((item) => `${item.product_name} x${item.qty}`),
    total: Number(order.subtotal)
  }));
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

export async function removeCustomerVehicle(user: User, vehicleId: string) {
  const profile = await getOrCreateCustomerProfile(user);
  const supabase = getAdminOrThrow();
  const { error } = await supabase
    .from("customer_vehicles")
    .delete()
    .eq("id", vehicleId)
    .eq("customer_profile_id", profile.id);

  if (error) throw error;

  return { ok: true };
}

export async function saveCustomerVehicleByEmail(emailInput: string, vehicle: CustomerVehicleInput, name: string | null = null) {
  const profile = await getOrCreateCustomerProfileByEmail(emailInput, name);
  const supabase = getAdminOrThrow();
  const email = profile.email.toLowerCase();

  const { data, error } = await supabase
    .from("customer_vehicles")
    .upsert(
      {
        customer_profile_id: profile.id,
        auth_user_id: profile.authUserId,
        email,
        vehicle_application_id: vehicle.applicationId,
        make_snapshot: vehicle.make,
        model_snapshot: vehicle.model,
        year: vehicle.year,
        source: "checkout",
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

function groupBy<T>(items: T[], getKey: (item: T) => string) {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = getKey(item);
    map.set(key, [...(map.get(key) ?? []), item]);
  }
  return map;
}
