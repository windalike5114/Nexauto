import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createSupabaseAdminClient } from "@/lib/supabase";

type CheckoutMetadataItem = {
  product_id: string;
  variant_id: string;
  sku: string;
  qty: number;
  price: number;
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
  const variantIds = metadataItems.map((item) => item.variant_id);
  const { data: variants, error: variantsError } = await supabase
    .from("product_variants")
    .select("id,product_id,sku,price,attributes,products(name)")
    .in("id", variantIds);

  if (variantsError) {
    return NextResponse.json({ error: variantsError.message }, { status: 500 });
  }

  const variantsById = new Map((variants ?? []).map((variant) => [variant.id as string, variant]));
  const orderItems = metadataItems.map((item) => {
    const variant = variantsById.get(item.variant_id);
    const unitPrice = Number(variant?.price ?? item.price);
    const qty = Number(item.qty);

    return {
      product_id: String(variant?.product_id ?? item.product_id),
      variant_id: item.variant_id,
      sku: String(variant?.sku ?? item.sku),
      product_name: getProductName(variant?.products) ?? item.sku,
      attributes: variant?.attributes ?? {},
      qty,
      unit_price: unitPrice,
      line_total: unitPrice * qty
    };
  });
  const subtotal = orderItems.reduce((sum, item) => sum + item.line_total, 0);

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      email: session.customer_details?.email ?? session.customer_email ?? null,
      customer_name: session.customer_details?.name ?? null,
      shipping_address: session.shipping_details?.address ?? {},
      billing_address: session.customer_details?.address ?? {},
      items_snapshot: orderItems,
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

  const { error: itemsError } = await supabase.from("order_items").insert(
    orderItems.map((item) => ({
      ...item,
      order_id: order.id
    }))
  );

  if (itemsError) {
    return NextResponse.json({ error: itemsError.message }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

function parseMetadataItems(value: string | undefined | null): CheckoutMetadataItem[] {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value) as CheckoutMetadataItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getProductName(value: unknown) {
  if (!value) return null;
  if (Array.isArray(value)) return getProductName(value[0]);
  if (typeof value === "object" && "name" in value) {
    return String((value as { name: string }).name);
  }
  return null;
}
