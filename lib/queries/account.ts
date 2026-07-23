import type { User } from "@supabase/supabase-js";
import { getOrderNumberFromSnapshot } from "@/lib/order-number";
import { normalizeClaimEmail } from "@/lib/domain/account/order-claim.schema";
import type { OrderOwnershipSource } from "@/lib/domain/account/order-claim.types";
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
  label: string | null;
  make: string;
  model: string;
  year: number;
  source: string;
  isDefault: boolean;
  lastUsedAt: string;
};

export type CustomerOrder = {
  id: string;
  orderNumber: string;
  orderDate: string;
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string | null;
  statusDescription: string;
  vehicle: string | null;
  products: string[];
  total: number;
  ownershipSource?: OrderOwnershipSource;
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
  label?: string | null;
  make_snapshot: string;
  model_snapshot: string;
  year: number;
  source: string;
  is_default?: boolean;
  last_used_at: string;
};

type CustomerOrderRow = {
  id: string;
  subtotal: string | number;
  status: string;
  created_at: string;
  items_snapshot: unknown;
  customer_profile_id?: string | null;
  ownership_source?: OrderOwnershipSource;
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

type CustomerOrderFulfillmentRow = {
  order_id: string;
  connector_status: string;
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
    .select("id,vehicle_application_id,label,make_snapshot,model_snapshot,year,source,is_default,last_used_at")
    .eq("customer_profile_id", profileId)
    .order("is_default", { ascending: false })
    .order("last_used_at", { ascending: false });

  if (error) throw error;
  return (data as CustomerVehicleRow[]).map(mapVehicle);
}

export async function listCustomerOrders(emailInput: string) {
  const email = normalizeClaimEmail(emailInput);
  const supabase = getAdminOrThrow();
  const { data, error } = await supabase
    .from("orders")
    .select("id,subtotal,status,created_at,items_snapshot")
    .eq("email", email)
    .neq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw error;

  const orders = (data ?? []) as CustomerOrderRow[];
  const orderIds = orders.map((order) => order.id);

  if (!orderIds.length) return [];

  const [itemsResult, vehiclesResult, fulfillmentsResult] = await Promise.all([
    supabase
      .from("order_items")
      .select("order_id,product_name,sku,qty")
      .in("order_id", orderIds)
      .order("created_at", { ascending: true }),
    supabase
      .from("order_vehicle_snapshots")
      .select("order_id,make_snapshot,model_snapshot,year")
      .in("order_id", orderIds),
    supabase
      .from("order_wiper_fulfillment")
      .select("order_id,connector_status")
      .in("order_id", orderIds)
  ]);

  if (itemsResult.error) throw itemsResult.error;
  if (vehiclesResult.error) throw vehiclesResult.error;
  if (fulfillmentsResult.error) throw fulfillmentsResult.error;

  const itemsByOrder = groupBy((itemsResult.data ?? []) as CustomerOrderItemRow[], (item) => item.order_id);
  const vehicleByOrder = new Map(
    ((vehiclesResult.data ?? []) as CustomerOrderVehicleRow[]).map((vehicle) => [
      vehicle.order_id,
      `${vehicle.make_snapshot} ${vehicle.model_snapshot} ${vehicle.year}`
    ])
  );
  const fulfillmentByOrder = new Map(
    ((fulfillmentsResult.data ?? []) as CustomerOrderFulfillmentRow[]).map((fulfillment) => [
      fulfillment.order_id,
      fulfillment.connector_status
    ])
  );

  return orders.map((order): CustomerOrder => {
    const fulfillmentStatus = fulfillmentByOrder.get(order.id) ?? null;
    const customerStatus = getCustomerOrderStatus(order.status, fulfillmentStatus);

    return {
      id: order.id,
      orderNumber: getOrderNumberFromSnapshot(order.id, order.items_snapshot),
      orderDate: order.created_at,
      status: customerStatus.label,
      paymentStatus: order.status,
      fulfillmentStatus,
      statusDescription: customerStatus.description,
      vehicle: vehicleByOrder.get(order.id) ?? null,
      products: (itemsByOrder.get(order.id) ?? []).map((item) => `${item.product_name} x${item.qty}`),
      total: Number(order.subtotal),
      ownershipSource: order.ownership_source
    };
  });
}

export async function listCustomerOrdersForProfile(profileId: string, emailInput: string) {
  const email = normalizeClaimEmail(emailInput);
  const supabase = getAdminOrThrow();
  const [ownedResult, legacyResult] = await Promise.all([
    supabase
      .from("orders")
      .select("id,subtotal,status,created_at,items_snapshot,customer_profile_id")
      .eq("customer_profile_id", profileId)
      .neq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("orders")
      .select("id,subtotal,status,created_at,items_snapshot,customer_profile_id")
      .is("customer_profile_id", null)
      .eq("email", email)
      .in("status", ["paid", "refunded"])
      .order("created_at", { ascending: false })
      .limit(50)
  ]);

  if (ownedResult.error) throw ownedResult.error;
  if (legacyResult.error) throw legacyResult.error;

  const rowsById = new Map<string, CustomerOrderRow>();
  for (const row of (ownedResult.data ?? []) as CustomerOrderRow[]) {
    rowsById.set(row.id, { ...row, ownership_source: "profile" });
  }
  for (const row of (legacyResult.data ?? []) as CustomerOrderRow[]) {
    if (!rowsById.has(row.id)) rowsById.set(row.id, { ...row, ownership_source: "legacy_email" });
  }

  const orders = [...rowsById.values()].sort(
    (left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
  );
  return hydrateCustomerOrders(supabase, orders);
}

async function hydrateCustomerOrders(supabase: ReturnType<typeof getAdminOrThrow>, orders: CustomerOrderRow[]) {
  const orderIds = orders.map((order) => order.id);

  if (!orderIds.length) return [];

  const [itemsResult, vehiclesResult, fulfillmentsResult] = await Promise.all([
    supabase
      .from("order_items")
      .select("order_id,product_name,sku,qty")
      .in("order_id", orderIds)
      .order("created_at", { ascending: true }),
    supabase
      .from("order_vehicle_snapshots")
      .select("order_id,make_snapshot,model_snapshot,year")
      .in("order_id", orderIds),
    supabase
      .from("order_wiper_fulfillment")
      .select("order_id,connector_status")
      .in("order_id", orderIds)
  ]);

  if (itemsResult.error) throw itemsResult.error;
  if (vehiclesResult.error) throw vehiclesResult.error;
  if (fulfillmentsResult.error) throw fulfillmentsResult.error;

  const itemsByOrder = groupBy((itemsResult.data ?? []) as CustomerOrderItemRow[], (item) => item.order_id);
  const vehicleByOrder = new Map(
    ((vehiclesResult.data ?? []) as CustomerOrderVehicleRow[]).map((vehicle) => [
      vehicle.order_id,
      `${vehicle.make_snapshot} ${vehicle.model_snapshot} ${vehicle.year}`
    ])
  );
  const fulfillmentByOrder = new Map(
    ((fulfillmentsResult.data ?? []) as CustomerOrderFulfillmentRow[]).map((fulfillment) => [
      fulfillment.order_id,
      fulfillment.connector_status
    ])
  );

  return orders.map((order): CustomerOrder => {
    const fulfillmentStatus = fulfillmentByOrder.get(order.id) ?? null;
    const customerStatus = getCustomerOrderStatus(order.status, fulfillmentStatus);

    return {
      id: order.id,
      orderNumber: getOrderNumberFromSnapshot(order.id, order.items_snapshot),
      orderDate: order.created_at,
      status: customerStatus.label,
      paymentStatus: order.status,
      fulfillmentStatus,
      statusDescription: customerStatus.description,
      vehicle: vehicleByOrder.get(order.id) ?? null,
      products: (itemsByOrder.get(order.id) ?? []).map((item) => `${item.product_name} x${item.qty}`),
      total: Number(order.subtotal),
      ownershipSource: order.ownership_source
    };
  });
}

function getCustomerOrderStatus(paymentStatus: string, fulfillmentStatus: string | null) {
  if (paymentStatus === "cancelled") {
    return {
      label: "Cancelled",
      description: "This order has been cancelled."
    };
  }

  if (paymentStatus === "refunded") {
    return {
      label: "Refunded",
      description: "This order has been refunded."
    };
  }

  if (paymentStatus === "failed") {
    return {
      label: "Payment failed",
      description: "Payment was not completed for this order."
    };
  }

  if (paymentStatus === "pending") {
    return {
      label: "Order placed",
      description: "We are waiting for payment confirmation."
    };
  }

  if (fulfillmentStatus === "fulfilled") {
    return {
      label: "Delivered",
      description: "This order has been marked as completed."
    };
  }

  if (fulfillmentStatus === "packed") {
    return {
      label: "Shipped",
      description: "Your order has been packed and is ready for delivery or dispatch."
    };
  }

  if (fulfillmentStatus === "selected") {
    return {
      label: "Preparing order",
      description: "The correct adapter has been selected and your order is being prepared."
    };
  }

  return {
    label: "Order placed",
    description: "Payment has been received and your order is waiting to be prepared."
  };
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
    label: row.label ?? null,
    make: row.make_snapshot,
    model: row.model_snapshot,
    year: row.year,
    source: row.source,
    isDefault: row.is_default ?? false,
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
