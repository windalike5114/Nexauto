import type {
  AdminCustomerDetailAddressRow,
  AdminCustomerDetailClaimEventRow,
  AdminCustomerDetailOrderRow,
  AdminCustomerDetailProfileRow,
  AdminCustomerDetailRepository,
  AdminCustomerDetailVehicleRow,
  AdminCustomerDetailVehicleSnapshotRow
} from "@/lib/application/admin/admin-customer-detail.types";
import { getOrderNumberFromSnapshot } from "@/lib/order-number";
import { createSupabaseAdminClient } from "@/lib/supabase";

type CustomerProfileRow = {
  id: string;
  auth_user_id: string | null;
  email: string;
  name: string | null;
  created_at: string;
  updated_at: string;
};

type OrderRow = {
  id: string;
  order_number?: string | null;
  items_snapshot?: unknown;
  email: string | null;
  customer_name: string | null;
  subtotal: string | number;
  currency: string;
  status: string;
  created_at: string;
};

type VehicleRow = {
  id: string;
  vehicle_application_id: string | null;
  label: string | null;
  make_snapshot: string;
  model_snapshot: string;
  year: number;
  source: string;
  is_default: boolean | null;
  last_used_at: string;
  created_at: string;
};

type AddressRow = {
  id: string;
  label: string | null;
  recipient_name: string;
  company: string | null;
  phone: string | null;
  line1: string;
  line2: string | null;
  suburb: string | null;
  city: string;
  region: string | null;
  postcode: string | null;
  country: string;
  is_default_shipping: boolean;
  created_at: string;
  updated_at: string;
};

type VehicleSnapshotRow = {
  id: string;
  order_id: string;
  vehicle_application_id: string | null;
  customer_vehicle_id: string | null;
  make_snapshot: string;
  model_snapshot: string;
  year: number;
  created_at: string;
};

type ClaimEventRow = {
  id: string;
  order_id: string | null;
  claim_method: string;
  status: string;
  created_at: string;
};

const orderSelect = "id,order_number,email,customer_name,subtotal,currency,status,created_at";
const legacyOrderSelect = "id,items_snapshot,email,customer_name,subtotal,currency,status,created_at";

export function createAdminCustomerDetailRepository(): AdminCustomerDetailRepository {
  return {
    async loadCustomerDetail(customerProfileId) {
      const supabase = getAdminOrThrow();
      const { data: profileData, error: profileError } = await supabase
        .from("customer_profiles")
        .select("id,auth_user_id,email,name,created_at,updated_at")
        .eq("id", customerProfileId)
        .maybeSingle();

      if (profileError) throw profileError;
      if (!profileData) {
        return { profile: null, orders: [], vehicles: [], addresses: [], vehicleSnapshots: [], claimEvents: [] };
      }

      const profile = mapProfile(profileData as CustomerProfileRow);
      const [orders, vehiclesResult, addressesResult, claimEventsResult] = await Promise.all([
        listOrdersForProfile(customerProfileId, profile.email),
        supabase
          .from("customer_vehicles")
          .select("id,vehicle_application_id,label,make_snapshot,model_snapshot,year,source,is_default,last_used_at,created_at")
          .eq("customer_profile_id", customerProfileId)
          .order("is_default", { ascending: false })
          .order("last_used_at", { ascending: false })
          .limit(50),
        supabase
          .from("customer_addresses")
          .select("id,label,recipient_name,company,phone,line1,line2,suburb,city,region,postcode,country,is_default_shipping,created_at,updated_at")
          .eq("customer_profile_id", customerProfileId)
          .order("is_default_shipping", { ascending: false })
          .order("updated_at", { ascending: false })
          .limit(50),
        supabase
          .from("order_claim_events")
          .select("id,order_id,claim_method,status,created_at")
          .eq("customer_profile_id", customerProfileId)
          .order("created_at", { ascending: false })
          .limit(50)
      ]);

      if (vehiclesResult.error) throw vehiclesResult.error;
      if (addressesResult.error) throw addressesResult.error;
      if (claimEventsResult.error) throw claimEventsResult.error;

      const orderIds = orders.map((order) => order.id);
      const vehicleSnapshots = await listVehicleSnapshots(orderIds);

      return {
        profile,
        orders,
        vehicles: ((vehiclesResult.data ?? []) as VehicleRow[]).map(mapVehicle),
        addresses: ((addressesResult.data ?? []) as AddressRow[]).map(mapAddress),
        vehicleSnapshots,
        claimEvents: ((claimEventsResult.data ?? []) as ClaimEventRow[]).map(mapClaimEvent)
      };
    }
  };
}

async function listOrdersForProfile(customerProfileId: string, email: string) {
  const supabase = getAdminOrThrow();
  let result: { data: unknown[] | null; error: unknown } = await supabase
    .from("orders")
    .select(orderSelect)
    .or(`customer_profile_id.eq.${customerProfileId},email.eq.${email}`)
    .neq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(50);

  if (isMissingOrderNumberColumnError(result.error)) {
    result = await supabase
      .from("orders")
      .select(legacyOrderSelect)
      .or(`customer_profile_id.eq.${customerProfileId},email.eq.${email}`)
      .neq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(50);
  }

  if (result.error) throw result.error;
  return ((result.data ?? []) as OrderRow[]).map(mapOrder);
}

async function listVehicleSnapshots(orderIds: string[]) {
  if (!orderIds.length) return [];
  const { data, error } = await getAdminOrThrow()
    .from("order_vehicle_snapshots")
    .select("id,order_id,vehicle_application_id,customer_vehicle_id,make_snapshot,model_snapshot,year,created_at")
    .in("order_id", orderIds)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return ((data ?? []) as VehicleSnapshotRow[]).map(mapVehicleSnapshot);
}

function mapProfile(row: CustomerProfileRow): AdminCustomerDetailProfileRow {
  return {
    id: row.id,
    authUserId: row.auth_user_id,
    email: row.email,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapOrder(row: OrderRow): AdminCustomerDetailOrderRow {
  return {
    id: row.id,
    orderNumber: row.order_number ?? getOrderNumberFromSnapshot(row.items_snapshot ?? null) ?? "Order number pending",
    email: row.email,
    customerName: row.customer_name,
    subtotal: Number(row.subtotal),
    currency: row.currency,
    status: row.status,
    createdAt: row.created_at
  };
}

function mapVehicle(row: VehicleRow): AdminCustomerDetailVehicleRow {
  return {
    id: row.id,
    applicationId: row.vehicle_application_id,
    label: row.label,
    make: row.make_snapshot,
    model: row.model_snapshot,
    year: row.year,
    source: row.source,
    isDefault: Boolean(row.is_default),
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at
  };
}

function mapAddress(row: AddressRow): AdminCustomerDetailAddressRow {
  return {
    id: row.id,
    label: row.label,
    recipientName: row.recipient_name,
    company: row.company,
    phone: row.phone,
    line1: row.line1,
    line2: row.line2,
    suburb: row.suburb,
    city: row.city,
    region: row.region,
    postcode: row.postcode,
    country: row.country,
    isDefaultShipping: row.is_default_shipping,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapVehicleSnapshot(row: VehicleSnapshotRow): AdminCustomerDetailVehicleSnapshotRow {
  return {
    id: row.id,
    orderId: row.order_id,
    vehicleApplicationId: row.vehicle_application_id,
    customerVehicleId: row.customer_vehicle_id,
    make: row.make_snapshot,
    model: row.model_snapshot,
    year: row.year,
    createdAt: row.created_at
  };
}

function mapClaimEvent(row: ClaimEventRow): AdminCustomerDetailClaimEventRow {
  return {
    id: row.id,
    orderId: row.order_id,
    method: row.claim_method,
    status: row.status,
    createdAt: row.created_at
  };
}

function isMissingOrderNumberColumnError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return candidate.code === "42703" && typeof candidate.message === "string" && candidate.message.includes("order_number");
}

function getAdminOrThrow() {
  const supabase = createSupabaseAdminClient();
  if (!supabase) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for admin customer detail.");
  return supabase;
}
