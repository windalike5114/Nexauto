import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createSupabaseAdminClient } from "@/lib/supabase";
import { getOrCreateCustomerProfileByEmail, saveCustomerVehicleByEmail } from "@/lib/queries/account";
import { sendOrderConfirmationEmail } from "@/lib/email/templates/order-confirmation";

type CheckoutMetadataItem = {
  p?: string;
  v?: string;
  s?: string;
  q?: number;
  pr?: number;
  product_id: string;
  variant_id: string;
  sku: string;
  name?: string;
  attributes?: Record<string, string | number>;
  qty: number;
  price: number;
};

type PreparedOrderItem = {
  logical_product_id: string;
  logical_variant_id: string;
  product_id: string | null;
  variant_id: string | null;
  sku: string;
  product_name: string;
  attributes: Record<string, string | number>;
  qty: number;
  unit_price: number;
  line_total: number;
};

type VehicleContext = {
  applicationId: string;
  make: string;
  model: string;
  year: number;
};

export async function POST(request: Request) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secretKey || !webhookSecret) {
    return NextResponse.json({ error: "Stripe webhook is not configured." }, { status: 500 });
  }

  const stripe = new Stripe(secretKey);
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing Stripe signature." }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch {
    return NextResponse.json({ error: "Invalid Stripe signature." }, { status: 400 });
  }

  if (event.type !== "checkout.session.completed") {
    return NextResponse.json({ received: true });
  }

  const session = event.data.object;

  if (session.payment_status !== "paid") {
    return NextResponse.json({ received: true });
  }

  const supabase = createSupabaseAdminClient();

  if (!supabase) {
    return NextResponse.json({ error: "Supabase service role key is not configured." }, { status: 500 });
  }

  const metadataItems = parseMetadataItems(session.metadata?.items);
  const metadataVehicle = parseMetadataVehicle(session.metadata?.vehicle);
  const standardVariantIds = metadataItems
    .filter((item) => item.product_id !== "wiper_set" && item.product_id !== "wiper_rear_addon")
    .map((item) => item.variant_id);
  const wiperSetIds = metadataItems.filter((item) => item.product_id === "wiper_set").map((item) => item.variant_id);
  const rearAddonIds = metadataItems.filter((item) => item.product_id === "wiper_rear_addon").map((item) => item.variant_id);
  const [variants, wiperSets, rearAddons] = await Promise.all([
    loadVariantsByIds(supabase, standardVariantIds),
    loadWiperSetsByIds(supabase, wiperSetIds),
    loadRearAddonsByIds(supabase, rearAddonIds)
  ]);
  const variantsById = new Map(variants.map((variant) => [variant.id as string, variant]));
  const wiperSetsById = new Map(wiperSets.map((wiperSet) => [wiperSet.id as string, wiperSet]));
  const rearAddonsById = new Map(rearAddons.map((rearAddon) => [rearAddon.id as string, rearAddon]));
  const orderItems = metadataItems.map((item) => prepareOrderItem(item, variantsById, wiperSetsById, rearAddonsById, metadataVehicle));
  const subtotal = orderItems.reduce((sum, item) => sum + item.line_total, 0);
  const email = session.customer_details?.email ?? session.customer_email ?? null;
  const customerName = session.customer_details?.name ?? null;

  if (email) {
    await getOrCreateCustomerProfileByEmail(email, customerName);
  }

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      email,
      customer_name: customerName,
      shipping_address: session.shipping_details?.address ?? {},
      billing_address: session.customer_details?.address ?? {},
      items_snapshot: orderItems.map((item) => ({
        product_id: item.logical_product_id,
        variant_id: item.logical_variant_id,
        sku: item.sku,
        product_name: item.product_name,
        attributes: item.attributes,
        qty: item.qty,
        unit_price: item.unit_price,
        line_total: item.line_total
      })),
      subtotal,
      currency: session.currency ?? "nzd",
      status: "paid",
      stripe_session_id: session.id,
      stripe_payment_intent_id:
        typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id
    })
    .select("id")
    .single();

  if (orderError) {
    if (orderError.code === "23505") {
      return NextResponse.json({ received: true });
    }

    return NextResponse.json({ error: orderError.message }, { status: 500 });
  }

  const { data: insertedItems, error: itemsError } = await supabase
    .from("order_items")
    .insert(
      orderItems.map((item) => ({
        product_id: item.product_id,
        variant_id: item.variant_id,
        sku: item.sku,
        product_name: item.product_name,
        attributes: {
          ...item.attributes,
          logical_product_id: item.logical_product_id,
          logical_variant_id: item.logical_variant_id
        },
        qty: item.qty,
        unit_price: item.unit_price,
        line_total: item.line_total,
        order_id: order.id
      }))
    )
    .select("id,sku,attributes");

  if (itemsError) {
    return NextResponse.json({ error: itemsError.message }, { status: 500 });
  }

  const vehicleContext = metadataVehicle ?? extractVehicleContext(orderItems);
  let customerVehicleId: string | null = null;

  if (email && vehicleContext) {
    const saved = await saveCustomerVehicleByEmail(
      email,
      {
        applicationId: vehicleContext.applicationId,
        make: vehicleContext.make,
        model: vehicleContext.model,
        year: vehicleContext.year
      },
      customerName
    );
    customerVehicleId = saved.vehicle.id;

    const { error: vehicleSnapshotError } = await supabase.from("order_vehicle_snapshots").insert({
      order_id: order.id,
      vehicle_application_id: vehicleContext.applicationId,
      customer_vehicle_id: customerVehicleId,
      make_snapshot: vehicleContext.make,
      model_snapshot: vehicleContext.model,
      year: vehicleContext.year
    });

    if (vehicleSnapshotError) {
      return NextResponse.json({ error: vehicleSnapshotError.message }, { status: 500 });
    }
  }

  const fulfillmentRows = buildWiperFulfillmentRows(order.id as string, orderItems, insertedItems ?? [], vehicleContext, customerVehicleId);
  if (fulfillmentRows.length) {
    const { error: fulfillmentError } = await supabase.from("order_wiper_fulfillment").insert(fulfillmentRows);

    if (fulfillmentError) {
      return NextResponse.json({ error: fulfillmentError.message }, { status: 500 });
    }
  }

  if (email) {
    try {
      await sendOrderConfirmationEmail({
        orderId: order.id as string,
        email,
        customerName,
        createdAt: new Date().toISOString(),
        currency: session.currency ?? "nzd",
        subtotal,
        total: session.amount_total ? session.amount_total / 100 : subtotal,
        status: "paid",
        shippingAddress: (session.shipping_details?.address ?? {}) as Record<string, unknown>,
        billingAddress: (session.customer_details?.address ?? {}) as Record<string, unknown>,
        items: orderItems.map((item) => ({
          sku: item.sku,
          productName: item.product_name,
          qty: item.qty,
          unitPrice: item.unit_price,
          lineTotal: item.line_total,
          attributes: item.attributes
        })),
        vehicle: vehicleContext
          ? {
              make: vehicleContext.make,
              model: vehicleContext.model,
              year: vehicleContext.year
            }
          : null
      });
    } catch (error) {
      console.error("Order confirmation email failed", error);
    }
  }

  return NextResponse.json({ received: true });
}

async function loadVariantsByIds(supabase: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, variantIds: string[]) {
  if (variantIds.length === 0) return [];

  const { data, error } = await supabase
    .from("product_variants")
    .select("id,product_id,sku,price,attributes,products(name)")
    .in("id", variantIds);

  if (error) throw error;
  return data ?? [];
}

async function loadWiperSetsByIds(supabase: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, ids: string[]) {
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from("wiper_sets")
    .select("id,sku,name,driver_length_in,passenger_length_in,price")
    .in("id", ids);

  if (error) throw error;
  return data ?? [];
}

async function loadRearAddonsByIds(supabase: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, ids: string[]) {
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from("wiper_rear_addons")
    .select("id,name,rear_length_in,price")
    .in("id", ids);

  if (error) throw error;
  return data ?? [];
}

function prepareOrderItem(
  item: CheckoutMetadataItem,
  variantsById: Map<string, Record<string, unknown>>,
  wiperSetsById: Map<string, Record<string, unknown>>,
  rearAddonsById: Map<string, Record<string, unknown>>,
  vehicleContext: VehicleContext | null
): PreparedOrderItem {
  const variant = variantsById.get(item.variant_id);
  const wiperSet = wiperSetsById.get(item.variant_id);
  const rearAddon = rearAddonsById.get(item.variant_id);
  const unitPrice = Number(variant?.price ?? wiperSet?.price ?? rearAddon?.price ?? item.price);
  const qty = Number(item.qty);
  const isStandardVariant = item.product_id !== "wiper_set" && item.product_id !== "wiper_rear_addon";
  const attributes = {
    ...(item.attributes ?? {}),
    ...(isStandardVariant ? ((variant?.attributes as Record<string, string | number> | undefined) ?? {}) : {}),
    ...(item.product_id === "wiper_set"
      ? {
          wiper_set_id: item.variant_id,
          driver_length: `${Number(wiperSet?.driver_length_in)}"`,
          passenger_length: `${Number(wiperSet?.passenger_length_in)}"`
        }
      : {}),
    ...(item.product_id === "wiper_rear_addon"
      ? {
          wiper_rear_addon_id: item.variant_id,
          rear_length: `${Number(rearAddon?.rear_length_in)}"`
        }
      : {}),
    ...(vehicleContext
      ? {
          vehicle_application_id: vehicleContext.applicationId,
          vehicle_make: vehicleContext.make,
          vehicle_model: vehicleContext.model,
          vehicle_year: vehicleContext.year
        }
      : {})
  };

  return {
    logical_product_id: String(variant?.product_id ?? item.product_id),
    logical_variant_id: item.variant_id,
    product_id: isStandardVariant && isUuid(String(variant?.product_id ?? item.product_id)) ? String(variant?.product_id ?? item.product_id) : null,
    variant_id: isStandardVariant && isUuid(item.variant_id) ? item.variant_id : null,
    sku: String(variant?.sku ?? wiperSet?.sku ?? item.sku),
    product_name: getProductName(variant?.products) ?? String(wiperSet?.name ?? rearAddon?.name ?? item.name ?? item.sku),
    attributes,
    qty,
    unit_price: unitPrice,
    line_total: unitPrice * qty
  };
}

function buildWiperFulfillmentRows(
  orderId: string,
  orderItems: PreparedOrderItem[],
  insertedItems: Array<{ id: string; sku: string; attributes: Record<string, string | number> }>,
  vehicleContext: VehicleContext | null,
  customerVehicleId: string | null
) {
  const insertedBySku = new Map(insertedItems.map((item) => [item.sku, item]));
  const rearLength = orderItems.find((item) => item.logical_product_id === "wiper_rear_addon")?.attributes.rear_length;

  return orderItems
    .filter((item) => item.logical_product_id === "wiper_set")
    .map((item) => ({
      order_id: orderId,
      order_item_id: insertedBySku.get(item.sku)?.id ?? null,
      vehicle_application_id: vehicleContext?.applicationId ?? null,
      customer_vehicle_id: customerVehicleId,
      wiper_set_id: item.logical_variant_id,
      driver_length_in: parseLength(item.attributes.driver_length),
      passenger_length_in: parseLength(item.attributes.passenger_length),
      rear_length_in: parseLength(rearLength),
      connector_status: "pending"
    }));
}

function extractVehicleContext(orderItems: PreparedOrderItem[]): VehicleContext | null {
  for (const item of orderItems) {
    const attributes = item.attributes;
    const applicationId = attributes.vehicle_application_id;
    const make = attributes.vehicle_make;
    const model = attributes.vehicle_model;
    const year = Number(attributes.vehicle_year);

    if (typeof applicationId === "string" && typeof make === "string" && typeof model === "string" && Number.isFinite(year)) {
      return {
        applicationId,
        make,
        model,
        year
      };
    }
  }

  return null;
}

function parseMetadataItems(value: string | undefined | null): CheckoutMetadataItem[] {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value) as Array<Partial<CheckoutMetadataItem>>;
    return Array.isArray(parsed) ? parsed.map(normalizeMetadataItem).filter((item): item is CheckoutMetadataItem => Boolean(item)) : [];
  } catch {
    return [];
  }
}

function normalizeMetadataItem(item: Partial<CheckoutMetadataItem>): CheckoutMetadataItem | null {
  const productId = item.product_id ?? item.p;
  const variantId = item.variant_id ?? item.v;
  const sku = item.sku ?? item.s;
  const qty = item.qty ?? item.q;
  const price = item.price ?? item.pr;

  if (!productId || !variantId || !sku || !qty || price === undefined) return null;

  return {
    product_id: productId,
    variant_id: variantId,
    sku,
    name: item.name,
    attributes: item.attributes,
    qty,
    price
  };
}

function parseMetadataVehicle(value: string | undefined | null): VehicleContext | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as { a?: unknown; m?: unknown; d?: unknown; y?: unknown } | null;
    const year = Number(parsed?.y);

    if (typeof parsed?.a !== "string" || typeof parsed.m !== "string" || typeof parsed.d !== "string" || !Number.isFinite(year)) {
      return null;
    }

    return {
      applicationId: parsed.a,
      make: parsed.m,
      model: parsed.d,
      year
    };
  } catch {
    return null;
  }
}

function parseLength(value: unknown) {
  if (value === null || value === undefined) return null;
  const number = Number(String(value).replace(/"/g, ""));
  return Number.isFinite(number) ? number : null;
}

function getProductName(value: unknown) {
  if (!value) return null;
  if (Array.isArray(value)) return getProductName(value[0]);
  if (typeof value === "object" && "name" in value) {
    return String((value as { name: string }).name);
  }
  return null;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
