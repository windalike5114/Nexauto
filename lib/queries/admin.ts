import { createSupabaseAdminClient } from "@/lib/supabase";
import { createClient } from "@/utils/supabase/server";

export type AdminCheck =
  | { ok: true; email: string }
  | { ok: false; reason: "signed_out" | "forbidden" | "not_configured"; email?: string };

export type AdminOrder = {
  id: string;
  email: string | null;
  customerName: string | null;
  subtotal: number;
  currency: string;
  status: string;
  createdAt: string;
  stripeSessionId: string | null;
  stripePaymentIntentId: string | null;
  shippingAddress: Record<string, unknown>;
  billingAddress: Record<string, unknown>;
  itemsSnapshot: unknown;
  items: AdminOrderItem[];
  vehicle: AdminVehicleSnapshot | null;
  fulfillment: AdminWiperFulfillment | null;
};

export type AdminOrderItem = {
  id: string;
  orderId: string;
  sku: string;
  productName: string;
  attributes: Record<string, unknown>;
  qty: number;
  unitPrice: number;
  lineTotal: number;
};

export type AdminVehicleSnapshot = {
  id: string;
  orderId: string;
  make: string;
  model: string;
  year: number;
};

export type AdminWiperFulfillment = {
  id: string;
  orderId: string;
  orderItemId: string | null;
  wiperSetId: string | null;
  driverLengthIn: number | null;
  passengerLengthIn: number | null;
  rearLengthIn: number | null;
  driverConnector: string | null;
  passengerConnector: string | null;
  rearConnector: string | null;
  connectorStatus: string;
  adminNote: string | null;
};

export type AdminProduct = {
  id: string;
  slug: string;
  name: string;
  category: string;
  price: number;
  description: string;
  active: boolean;
  videoUrl: string | null;
  detailSections: unknown[];
};

export type AdminVariant = {
  id: string;
  productId: string;
  sku: string;
  price: number;
  stock: number;
  active: boolean;
  productName: string;
};

export type AdminWiperSet = {
  id: string;
  sku: string;
  name: string;
  driverLengthIn: number;
  passengerLengthIn: number;
  price: number;
  compareAtPrice: number | null;
  active: boolean;
};

export type AdminRearAddon = {
  id: string;
  name: string;
  rearLengthIn: number;
  price: number;
  active: boolean;
};

export type AdminProductsData = {
  variants: AdminVariant[];
  wiperSets: AdminWiperSet[];
  rearAddons: AdminRearAddon[];
};

export type AdminOverviewData = {
  orders: AdminOrder[];
  variants: AdminVariant[];
  emailEvents: AdminEmailEvent[];
  customers: AdminCustomer[];
  enquiries: AdminEnquiry[];
};

export type AdminEmailEvent = {
  id: string;
  type: string;
  recipient: string;
  subject: string | null;
  status: string;
  errorCode: string | null;
  resendEmailId: string | null;
  orderId: string | null;
  createdAt: string;
  sentAt: string | null;
  updatedAt: string;
};

export type AdminCustomer = {
  id: string;
  email: string;
  name: string | null;
  orderCount: number;
  totalSpent: number;
  joinedAt: string;
};

export type AdminEnquiry = {
  id: string;
  name: string;
  email: string;
  partOrSku: string | null;
  message: string;
  sourcePage: string | null;
  sourceUrl: string | null;
  productName: string | null;
  productSku: string | null;
  status: string;
  adminNote: string | null;
  createdAt: string;
  updatedAt: string;
};

type OrderRow = {
  id: string;
  email: string | null;
  customer_name: string | null;
  subtotal: string | number;
  currency: string;
  status: string;
  created_at: string;
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
  shipping_address: Record<string, unknown>;
  billing_address: Record<string, unknown>;
  items_snapshot: unknown;
};

type OrderItemRow = {
  id: string;
  order_id: string;
  sku: string;
  product_name: string;
  attributes: Record<string, unknown>;
  qty: number;
  unit_price: string | number;
  line_total: string | number;
};

type VehicleSnapshotRow = {
  id: string;
  order_id: string;
  make_snapshot: string;
  model_snapshot: string;
  year: number;
};

type FulfillmentRow = {
  id: string;
  order_id: string;
  order_item_id: string | null;
  wiper_set_id: string | null;
  driver_length_in: string | number | null;
  passenger_length_in: string | number | null;
  rear_length_in: string | number | null;
  driver_connector: string | null;
  passenger_connector: string | null;
  rear_connector: string | null;
  connector_status: string;
  admin_note: string | null;
};

type ProductRow = {
  id: string;
  slug: string;
  name: string;
  category_slug: string;
  price: string | number;
  description: string | null;
  active: boolean;
  video_url?: string | null;
  detail_sections?: unknown[] | null;
};

type VariantRow = {
  id: string;
  product_id: string;
  sku: string;
  price: string | number;
  stock: number;
  active: boolean;
  products: { name: string } | Array<{ name: string }> | null;
};

type WiperSetRow = {
  id: string;
  sku: string;
  name: string;
  driver_length_in: string | number;
  passenger_length_in: string | number;
  price: string | number;
  compare_at_price: string | number | null;
  active: boolean;
};

type RearAddonRow = {
  id: string;
  name: string;
  rear_length_in: string | number;
  price: string | number;
  active: boolean;
};

type EmailEventRow = {
  id: string;
  type: string;
  recipient: string;
  subject: string | null;
  status: string;
  error_code: string | null;
  resend_email_id: string | null;
  order_id: string | null;
  created_at: string;
  sent_at: string | null;
  updated_at: string;
};

type CustomerRow = {
  id: string;
  email: string;
  name: string | null;
  created_at: string;
};

type EnquiryRow = {
  id: string;
  name: string;
  email: string;
  part_or_sku: string | null;
  message: string;
  source_page: string | null;
  source_url: string | null;
  product_name: string | null;
  product_sku: string | null;
  status: string;
  admin_note: string | null;
  created_at: string;
  updated_at: string;
};

export async function checkAdminAccess(): Promise<AdminCheck> {
  const allowedEmails = getAllowedAdminEmails();

  if (!allowedEmails.length) {
    return { ok: false, reason: "not_configured" };
  }

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  const email = user?.email?.toLowerCase();

  if (!email) {
    return { ok: false, reason: "signed_out" };
  }

  if (!allowedEmails.includes(email)) {
    return { ok: false, reason: "forbidden", email };
  }

  return { ok: true, email };
}

export async function requireAdminAccess() {
  const access = await checkAdminAccess();
  if (!access.ok) throw new Error("Admin access denied.");
  return access;
}

export async function loadAdminDashboardData() {
  await requireAdminAccess();
  const [orders, productsData, products, emailEvents, customers, enquiries] = await Promise.all([
    loadAdminOrdersDataInternal(),
    loadAdminProductsDataInternal(),
    listAdminProducts(),
    listAdminEmailEvents(),
    listAdminCustomers(),
    listAdminEnquiries()
  ]);

  return {
    orders,
    products,
    variants: productsData.variants,
    wiperSets: productsData.wiperSets,
    rearAddons: productsData.rearAddons,
    emailEvents,
    customers,
    enquiries
  };
}

export async function loadAdminOverviewData(): Promise<AdminOverviewData> {
  await requireAdminAccess();
  const [orders, variants, emailEvents, customers, enquiries] = await Promise.all([
    loadAdminOrdersDataInternal(),
    listAdminVariants(),
    listAdminEmailEvents(),
    listAdminCustomers(),
    listAdminEnquiries()
  ]);

  return { orders, variants, emailEvents, customers, enquiries };
}

export async function loadAdminOrdersData() {
  await requireAdminAccess();
  return loadAdminOrdersDataInternal();
}

export async function loadAdminOrderDetailData(orderId: string) {
  await requireAdminAccess();
  const supabase = getAdminOrThrow();
  const { data, error } = await supabase
    .from("orders")
    .select("id,email,customer_name,subtotal,currency,status,created_at,stripe_session_id,stripe_payment_intent_id,shipping_address,billing_address,items_snapshot")
    .eq("id", orderId)
    .single();

  if (error) throw error;

  const [items, vehicles, fulfillments] = await Promise.all([
    listOrderItems([orderId]),
    listOrderVehicles([orderId]),
    listFulfillments([orderId])
  ]);

  return mapAdminOrders([data as OrderRow], items, vehicles, fulfillments)[0];
}

export async function loadAdminProductsData(): Promise<AdminProductsData> {
  await requireAdminAccess();
  return loadAdminProductsDataInternal();
}

export async function loadAdminContentData() {
  await requireAdminAccess();
  return listAdminProducts();
}

export async function loadAdminEmailEventsData() {
  await requireAdminAccess();
  return listAdminEmailEvents();
}

export async function loadAdminCustomersData() {
  await requireAdminAccess();
  return listAdminCustomers();
}

export async function loadAdminEnquiriesData() {
  await requireAdminAccess();
  return listAdminEnquiries();
}

async function loadAdminOrdersDataInternal() {
  const orders = await listAdminOrderRows();
  const orderIds = orders.map((order) => order.id);
  const [items, vehicles, fulfillments] = await Promise.all([
    listOrderItems(orderIds),
    listOrderVehicles(orderIds),
    listFulfillments(orderIds)
  ]);

  return mapAdminOrders(orders, items, vehicles, fulfillments);
}

async function loadAdminProductsDataInternal(): Promise<AdminProductsData> {
  const [variants, wiperSets, rearAddons] = await Promise.all([
    listAdminVariants(),
    listAdminWiperSets(),
    listAdminRearAddons()
  ]);

  return { variants, wiperSets, rearAddons };
}

async function listAdminOrderRows() {

  const supabase = getAdminOrThrow();
  const { data: ordersData, error: ordersError } = await supabase
    .from("orders")
    .select("id,email,customer_name,subtotal,currency,status,created_at,stripe_session_id,stripe_payment_intent_id,shipping_address,billing_address,items_snapshot")
    .order("created_at", { ascending: false })
    .limit(50);

  if (ordersError) throw ordersError;

  return (ordersData ?? []) as OrderRow[];
}

function mapAdminOrders(
  orders: OrderRow[],
  items: AdminOrderItem[],
  vehicles: AdminVehicleSnapshot[],
  fulfillments: AdminWiperFulfillment[]
) {
  const itemsByOrder = groupBy(items, (item) => item.orderId);
  const vehicleByOrder = new Map(vehicles.map((vehicle) => [vehicle.orderId, vehicle]));
  const fulfillmentByOrder = new Map(fulfillments.map((fulfillment) => [fulfillment.orderId, fulfillment]));
  return orders.map((order): AdminOrder => ({
    id: order.id,
    email: order.email,
    customerName: order.customer_name,
    subtotal: Number(order.subtotal),
    currency: order.currency,
    status: order.status,
    createdAt: order.created_at,
    stripeSessionId: order.stripe_session_id,
    stripePaymentIntentId: order.stripe_payment_intent_id,
    shippingAddress: order.shipping_address ?? {},
    billingAddress: order.billing_address ?? {},
    itemsSnapshot: order.items_snapshot,
    items: itemsByOrder.get(order.id) ?? [],
    vehicle: vehicleByOrder.get(order.id) ?? null,
    fulfillment: fulfillmentByOrder.get(order.id) ?? null
  }));
}

async function listOrderItems(orderIds: string[]) {
  if (!orderIds.length) return [];

  const supabase = getAdminOrThrow();
  const { data, error } = await supabase
    .from("order_items")
    .select("id,order_id,sku,product_name,attributes,qty,unit_price,line_total")
    .in("order_id", orderIds)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return ((data ?? []) as OrderItemRow[]).map((row): AdminOrderItem => ({
    id: row.id,
    orderId: row.order_id,
    sku: row.sku,
    productName: row.product_name,
    attributes: row.attributes ?? {},
    qty: row.qty,
    unitPrice: Number(row.unit_price),
    lineTotal: Number(row.line_total)
  }));
}

async function listOrderVehicles(orderIds: string[]) {
  if (!orderIds.length) return [];

  const supabase = getAdminOrThrow();
  const { data, error } = await supabase
    .from("order_vehicle_snapshots")
    .select("id,order_id,make_snapshot,model_snapshot,year")
    .in("order_id", orderIds);

  if (error) throw error;
  return ((data ?? []) as VehicleSnapshotRow[]).map((row): AdminVehicleSnapshot => ({
    id: row.id,
    orderId: row.order_id,
    make: row.make_snapshot,
    model: row.model_snapshot,
    year: row.year
  }));
}

async function listFulfillments(orderIds: string[]) {
  if (!orderIds.length) return [];

  const supabase = getAdminOrThrow();
  const { data, error } = await supabase
    .from("order_wiper_fulfillment")
    .select("id,order_id,order_item_id,wiper_set_id,driver_length_in,passenger_length_in,rear_length_in,driver_connector,passenger_connector,rear_connector,connector_status,admin_note")
    .in("order_id", orderIds);

  if (error) throw error;
  return ((data ?? []) as FulfillmentRow[]).map((row): AdminWiperFulfillment => ({
    id: row.id,
    orderId: row.order_id,
    orderItemId: row.order_item_id,
    wiperSetId: row.wiper_set_id,
    driverLengthIn: toNullableNumber(row.driver_length_in),
    passengerLengthIn: toNullableNumber(row.passenger_length_in),
    rearLengthIn: toNullableNumber(row.rear_length_in),
    driverConnector: row.driver_connector,
    passengerConnector: row.passenger_connector,
    rearConnector: row.rear_connector,
    connectorStatus: row.connector_status,
    adminNote: row.admin_note
  }));
}

async function listAdminProducts() {
  const supabase = getAdminOrThrow();
  const result = await supabase
    .from("products")
    .select("id,slug,name,category_slug,price,description,active,video_url,detail_sections")
    .order("created_at", { ascending: false });
  let data: unknown[] | null = result.data;
  let error = result.error;

  if (isMissingOptionalProductContentColumn(error)) {
    const fallback = await supabase
      .from("products")
      .select("id,slug,name,category_slug,price,description,active")
      .order("created_at", { ascending: false });
    data = fallback.data;
    error = fallback.error;
  }

  if (error) throw error;
  return ((data ?? []) as ProductRow[]).map((row): AdminProduct => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    category: row.category_slug,
    price: Number(row.price),
    description: row.description ?? "",
    active: row.active,
    videoUrl: row.video_url ?? null,
    detailSections: row.detail_sections ?? []
  }));
}

async function listAdminVariants() {
  const supabase = getAdminOrThrow();
  const { data, error } = await supabase
    .from("product_variants")
    .select("id,product_id,sku,price,stock,active,products(name)")
    .order("sku");

  if (error) throw error;
  return ((data ?? []) as unknown as VariantRow[]).map((row): AdminVariant => ({
    id: row.id,
    productId: row.product_id,
    sku: row.sku,
    price: Number(row.price),
    stock: row.stock,
    active: row.active,
    productName: getProductName(row.products) ?? row.product_id
  }));
}

async function listAdminWiperSets() {
  const supabase = getAdminOrThrow();
  const { data, error } = await supabase
    .from("wiper_sets")
    .select("id,sku,name,driver_length_in,passenger_length_in,price,compare_at_price,active")
    .order("driver_length_in")
    .order("passenger_length_in");

  if (error) throw error;
  return ((data ?? []) as WiperSetRow[]).map((row): AdminWiperSet => ({
    id: row.id,
    sku: row.sku,
    name: row.name,
    driverLengthIn: Number(row.driver_length_in),
    passengerLengthIn: Number(row.passenger_length_in),
    price: Number(row.price),
    compareAtPrice: row.compare_at_price === null ? null : Number(row.compare_at_price),
    active: row.active
  }));
}

async function listAdminRearAddons() {
  const supabase = getAdminOrThrow();
  const { data, error } = await supabase
    .from("wiper_rear_addons")
    .select("id,name,rear_length_in,price,active")
    .order("rear_length_in");

  if (error) throw error;
  return ((data ?? []) as RearAddonRow[]).map((row): AdminRearAddon => ({
    id: row.id,
    name: row.name,
    rearLengthIn: Number(row.rear_length_in),
    price: Number(row.price),
    active: row.active
  }));
}

async function listAdminEmailEvents() {
  const supabase = getAdminOrThrow();
  const { data, error } = await supabase
    .from("email_events")
    .select("id,type,recipient,subject,status,error_code,resend_email_id,order_id,created_at,sent_at,updated_at")
    .order("created_at", { ascending: false })
    .limit(100);

  if (isMissingEmailEventsTable(error)) return [];
  if (error) throw error;

  return ((data ?? []) as EmailEventRow[]).map((row): AdminEmailEvent => ({
    id: row.id,
    type: row.type,
    recipient: row.recipient,
    subject: row.subject,
    status: row.status,
    errorCode: row.error_code,
    resendEmailId: row.resend_email_id,
    orderId: row.order_id,
    createdAt: row.created_at,
    sentAt: row.sent_at,
    updatedAt: row.updated_at
  }));
}

async function listAdminCustomers() {
  const supabase = getAdminOrThrow();
  const [{ data, error }, { data: ordersData, error: ordersError }] = await Promise.all([
    supabase
    .from("customer_profiles")
    .select("id,email,name,created_at")
    .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("orders")
      .select("email,subtotal")
      .not("email", "is", null)
      .limit(500)
  ]);

  if (isMissingTable(error, "customer_profiles")) return [];
  if (error) throw error;
  if (ordersError) throw ordersError;

  const totalsByEmail = new Map<string, { orderCount: number; totalSpent: number }>();
  for (const order of (ordersData ?? []) as Array<{ email: string | null; subtotal: string | number }>) {
    const email = order.email?.toLowerCase();
    if (!email) continue;
    const current = totalsByEmail.get(email) ?? { orderCount: 0, totalSpent: 0 };
    current.orderCount += 1;
    current.totalSpent += Number(order.subtotal);
    totalsByEmail.set(email, current);
  }

  return ((data ?? []) as CustomerRow[]).map((row): AdminCustomer => {
    const totals = totalsByEmail.get(row.email.toLowerCase()) ?? { orderCount: 0, totalSpent: 0 };
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      orderCount: totals.orderCount,
      totalSpent: totals.totalSpent,
      joinedAt: row.created_at
    };
  });
}

async function listAdminEnquiries() {
  const supabase = getAdminOrThrow();
  const { data, error } = await supabase
    .from("contact_enquiries")
    .select("id,name,email,part_or_sku,message,source_page,source_url,product_name,product_sku,status,admin_note,created_at,updated_at")
    .order("created_at", { ascending: false })
    .limit(100);

  if (isMissingTable(error, "contact_enquiries")) return [];
  if (error) throw error;

  return ((data ?? []) as EnquiryRow[]).map((row): AdminEnquiry => ({
    id: row.id,
    name: row.name,
    email: row.email,
    partOrSku: row.part_or_sku,
    message: row.message,
    sourcePage: row.source_page,
    sourceUrl: row.source_url,
    productName: row.product_name,
    productSku: row.product_sku,
    status: row.status,
    adminNote: row.admin_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

function getAllowedAdminEmails() {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function getAdminOrThrow() {
  const supabase = createSupabaseAdminClient();
  if (!supabase) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for admin.");
  return supabase;
}

function groupBy<T>(items: T[], getKey: (item: T) => string) {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = getKey(item);
    map.set(key, [...(map.get(key) ?? []), item]);
  }
  return map;
}

function getProductName(value: unknown) {
  if (!value) return null;
  if (Array.isArray(value)) return getProductName(value[0]);
  if (typeof value === "object" && "name" in value) {
    return String((value as { name: string }).name);
  }
  return null;
}

function isMissingOptionalProductContentColumn(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  return error.code === "42703" && (error.message?.includes("detail_sections") || error.message?.includes("video_url"));
}

function isMissingEmailEventsTable(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  return error.code === "42P01" || error.message?.includes("email_events");
}

function isMissingTable(error: { code?: string; message?: string } | null, table: string) {
  if (!error) return false;
  return error.code === "42P01" || Boolean(error.message?.includes(table));
}

function toNullableNumber(value: string | number | null) {
  if (value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
