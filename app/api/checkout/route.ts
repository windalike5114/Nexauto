import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getVariantsByIds } from "@/lib/queries/catalog";
import { listCustomerOrders } from "@/lib/queries/account";
import { getWiperRearAddonsByIds, getWiperSetsByIds } from "@/lib/queries/wiper-commerce";
import { createSupabaseAdminClient } from "@/lib/supabase";
import { createClient } from "@/utils/supabase/server";
import { calculateCartLinePricing, calculateCartPricing } from "@/lib/pricing";
import type { CartItem } from "@/lib/types";

type ValidatedCheckoutItem = {
  cartItem: CartItem;
  id: string;
  productId: string;
  sku: string;
  name: string;
  price: number;
  checkoutQuantity?: number;
  checkoutLineTotal?: number;
  bundleDiscount?: number;
  attributes: Record<string, string | number>;
};

export async function POST(request: Request) {
  const { items, couponCode, welcomeRewardApplied } = (await request.json()) as {
    items?: CartItem[];
    couponCode?: string;
    welcomeRewardApplied?: boolean;
  };
  const normalizedCouponCode = couponCode?.trim();

  if (!items?.length) {
    return NextResponse.json({ error: "Cart is empty." }, { status: 400 });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json(
      { error: "Stripe is not configured. Add STRIPE_SECRET_KEY to .env.local." },
      { status: 500 }
    );
  }

  const standardItems = items.filter((item) => item.productId !== "wiper_set" && item.productId !== "wiper_rear_addon");
  const wiperSetItems = items.filter((item) => item.productId === "wiper_set");
  const rearAddonItems = items.filter((item) => item.productId === "wiper_rear_addon");

  const requestedVariantIds = [...new Set(standardItems.map((item) => item.variantId))];
  const requestedWiperSetIds = [...new Set(wiperSetItems.map((item) => item.variantId))];
  const requestedRearAddonIds = [...new Set(rearAddonItems.map((item) => item.variantId))];

  const [dbVariants, dbWiperSets, dbRearAddons] = await Promise.all([
    getVariantsByIds(requestedVariantIds),
    getWiperSetsByIds(requestedWiperSetIds),
    getWiperRearAddonsByIds(requestedRearAddonIds)
  ]);

  if (dbVariants.length !== requestedVariantIds.length) {
    return NextResponse.json({ error: "One or more cart items are no longer available." }, { status: 409 });
  }

  if (dbWiperSets.length !== requestedWiperSetIds.length || dbRearAddons.length !== requestedRearAddonIds.length) {
    return NextResponse.json({ error: "One or more wiper kit items are no longer available." }, { status: 409 });
  }

  let validatedItems: ValidatedCheckoutItem[];

  try {
    const variantsById = new Map(dbVariants.map((variant) => [variant.id, variant]));
    const wiperSetsById = new Map(dbWiperSets.map((wiperSet) => [wiperSet.id, wiperSet]));
    const rearAddonsById = new Map(dbRearAddons.map((rearAddon) => [rearAddon.id, rearAddon]));

    const cartItemsForPricing = items.map((cartItem) => {
      const variant = variantsById.get(cartItem.variantId);
      const wiperSet = wiperSetsById.get(cartItem.variantId);
      const rearAddon = rearAddonsById.get(cartItem.variantId);

      if (cartItem.productId !== "wiper_set" && cartItem.productId !== "wiper_rear_addon") {
        if (!variant) throw new Error(`Cart item missing for variant ${cartItem.variantId}`);
        if (variant.stock < cartItem.qty) {
          throw new Error(`Not enough stock for ${variant.sku}`);
        }

        return {
          ...cartItem,
          name: getProductName(variant.products) ?? cartItem.name,
          sku: variant.sku,
          price: Number(variant.price),
          attributes: variant.attributes,
          bundleEligible: false
        };
      }

      if (cartItem.productId === "wiper_set") {
        if (!wiperSet) throw new Error(`Cart item missing for wiper set ${cartItem.variantId}`);

        return {
          ...cartItem,
          name: wiperSet.name,
          sku: wiperSet.sku,
          price: wiperSet.price,
          bundleEligible: true,
          bundleCategory: "front-wiper-pair",
          attributes: {
            ...cartItem.attributes,
            driver_length: `${wiperSet.driverLengthIn}"`,
            passenger_length: `${wiperSet.passengerLengthIn}"`
          }
        };
      }

      if (!rearAddon) throw new Error(`Cart item missing for rear add-on ${cartItem.variantId}`);

      return {
        ...cartItem,
        name: rearAddon.name,
        sku: `WPR${rearAddon.rearLengthIn}`,
        price: rearAddon.price,
        bundleEligible: false,
        attributes: {
          ...cartItem.attributes,
          rear_length: `${rearAddon.rearLengthIn}"`
        }
      };
    });

    const linePricing = calculateCartLinePricing(cartItemsForPricing);

    validatedItems = linePricing.map(({ item: cartItem, finalLineTotal, bundleDiscount }) => {
      const variant = variantsById.get(cartItem.variantId);
      const wiperSet = wiperSetsById.get(cartItem.variantId);
      const rearAddon = rearAddonsById.get(cartItem.variantId);

      if (cartItem.productId !== "wiper_set" && cartItem.productId !== "wiper_rear_addon" && variant) {
        if (variant.stock < cartItem.qty) {
          throw new Error(`Not enough stock for ${variant.sku}`);
        }

        return {
          cartItem,
          id: variant.id,
          productId: variant.product_id,
          sku: variant.sku,
          name: getProductName(variant.products) ?? cartItem.name,
          price: Number(variant.price),
          checkoutQuantity: 1,
          checkoutLineTotal: finalLineTotal,
          bundleDiscount,
          attributes: variant.attributes
        };
      }

      return {
        cartItem,
        id: cartItem.variantId,
        productId: cartItem.productId,
        sku: String(wiperSet?.sku ?? (rearAddon ? `WPR${rearAddon.rearLengthIn}` : cartItem.sku)),
        name: String(wiperSet?.name ?? rearAddon?.name ?? cartItem.name),
        price: cartItem.price,
        checkoutQuantity: 1,
        checkoutLineTotal: finalLineTotal,
        bundleDiscount,
        attributes: cartItem.attributes
      };
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Cart item validation failed." },
      { status: 409 }
    );
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const promotionCode = normalizedCouponCode ? await findActivePromotionCode(stripe, normalizedCouponCode) : null;

  if (normalizedCouponCode && !promotionCode) {
    return NextResponse.json({ error: "Coupon code is not valid or has expired." }, { status: 400 });
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const vehicleMetadata = buildVehicleMetadata(validatedItems);
  const pricing = calculateCartPricing(validatedItems.map((item) => item.cartItem));
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  const welcomeRewardDiscount = welcomeRewardApplied ? await getValidatedWelcomeRewardDiscount(user?.email ?? null, validatedItems) : 0;
  const checkoutItems = welcomeRewardDiscount > 0 ? applyCheckoutDiscount(validatedItems, welcomeRewardDiscount) : validatedItems;
  const pendingOrder = await createPendingCheckoutOrder({
    items: checkoutItems,
    email: user?.email ?? null,
    vehicle: vehicleMetadata,
    currency: "nzd",
    pricing: {
      productsSubtotal: pricing.productsSubtotal,
      bundleDiscount: pricing.bundleDiscount,
      welcomeRewardDiscount,
      finalSubtotal: Math.max(0, pricing.subtotal - welcomeRewardDiscount),
      couponCode: normalizedCouponCode ?? null
    }
  });

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: "payment",
    locale: "en",
    payment_method_types: ["card", "afterpay_clearpay"],
    adaptive_pricing: {
      enabled: false
    },
    allow_promotion_codes: promotionCode ? undefined : true,
    discounts: promotionCode ? [{ promotion_code: promotionCode.id }] : undefined,
    customer_email: user?.email,
    customer_creation: "if_required",
    billing_address_collection: "required",
    shipping_address_collection: {
      allowed_countries: ["NZ"]
    },
    shipping_options: [
      {
        shipping_rate_data: {
          type: "fixed_amount",
          fixed_amount: {
            amount: 0,
            currency: "nzd"
          },
          display_name: "Promo shipping - normally NZ$8",
          delivery_estimate: {
            minimum: { unit: "business_day", value: 1 },
            maximum: { unit: "business_day", value: 4 }
          }
        }
      }
    ],
    line_items: checkoutItems.map((item) => ({
      quantity: item.checkoutQuantity ?? item.cartItem.qty,
      price_data: {
        currency: "nzd",
        unit_amount: Math.round((item.checkoutLineTotal ?? item.price) * 100),
        product_data: {
          name: item.name,
          description: `${item.sku} | ${Object.entries(item.attributes)
            .map(([key, value]) => `${key}: ${value}`)
            .join(", ")}`,
          metadata: {
            product_id: item.productId,
            variant_id: item.id,
            sku: item.sku
          }
        }
      }
    })),
    metadata: {
      order_id: pendingOrder?.id ?? "",
      order_number: pendingOrder?.orderNumber ?? "",
      items: pendingOrder
        ? ""
        : JSON.stringify(
        checkoutItems.map((item) => buildCompactMetadataItem(item))
      ),
      vehicle: JSON.stringify(vehicleMetadata),
      vehicle_make: vehicleMetadata?.make ?? "",
      vehicle_model: vehicleMetadata?.model ?? "",
      vehicle_year: vehicleMetadata?.year ? String(vehicleMetadata.year) : "",
      vehicle_series: "",
      vehicle_body: "",
      coupon_code: normalizedCouponCode ?? "",
      products_subtotal: String(pricing.productsSubtotal),
      bundle_discount: String(pricing.bundleDiscount),
      welcome_reward_discount: String(welcomeRewardDiscount),
      final_subtotal: String(Math.max(0, pricing.subtotal - welcomeRewardDiscount)),
      source: "nexauto"
    },
    success_url: `${siteUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteUrl}/checkout/cancel`
  };

  const session = await stripe.checkout.sessions.create(sessionParams);
  await attachStripeSessionToPendingOrder(pendingOrder?.id ?? null, session.id);

  return NextResponse.json({ url: session.url });
}

async function createPendingCheckoutOrder({
  items,
  email,
  vehicle,
  currency,
  pricing
}: {
  items: ValidatedCheckoutItem[];
  email: string | null;
  vehicle: ReturnType<typeof buildVehicleMetadata>;
  currency: string;
  pricing: {
    productsSubtotal: number;
    bundleDiscount: number;
    welcomeRewardDiscount: number;
    finalSubtotal: number;
    couponCode: string | null;
  };
}) {
  const supabase = createSupabaseAdminClient();
  if (!supabase) return null;

  const itemsSnapshot = items.map((item) => ({
    product_id: item.productId,
    variant_id: item.id,
    sku: item.sku,
    product_name: item.name,
    attributes: item.attributes,
    qty: item.cartItem.qty,
    unit_price: item.checkoutLineTotal ? roundMoney(item.checkoutLineTotal / item.cartItem.qty) : item.price,
    line_total: item.checkoutLineTotal ?? item.price * item.cartItem.qty,
    bundle_discount: item.bundleDiscount ?? 0
  }));

  const { data: order, error } = await supabase
    .from("orders")
    .insert({
      email,
      items_snapshot: {
        items: itemsSnapshot,
        vehicle,
        pricing,
        checkout_state: "pending_stripe_payment"
      },
      subtotal: pricing.finalSubtotal,
      currency,
      status: "pending"
    })
    .select("id")
    .single();

  if (error || !order?.id) {
    console.error("Could not create pending order", error);
    return null;
  }

  const orderId = order.id as string;

  await supabase.from("order_items").insert(
    items.map((item) => ({
      order_id: orderId,
      product_id: isUuid(item.productId) ? item.productId : null,
      variant_id: item.productId !== "wiper_set" && item.productId !== "wiper_rear_addon" && isUuid(item.id) ? item.id : null,
      sku: item.sku,
      product_name: item.name,
      attributes: {
        ...item.attributes,
        logical_product_id: item.productId,
        logical_variant_id: item.id,
        bundle_discount: item.bundleDiscount ?? 0
      },
      qty: item.cartItem.qty,
      unit_price: item.checkoutLineTotal ? roundMoney(item.checkoutLineTotal / item.cartItem.qty) : item.price,
      line_total: item.checkoutLineTotal ?? item.price * item.cartItem.qty
    }))
  );

  if (vehicle?.a && vehicle.make && vehicle.model && vehicle.year) {
    await supabase.from("order_vehicle_snapshots").insert({
      order_id: orderId,
      vehicle_application_id: isUuid(String(vehicle.a)) ? vehicle.a : null,
      make_snapshot: String(vehicle.make),
      model_snapshot: String(vehicle.model),
      year: Number(vehicle.year)
    });
  }

  return {
    id: orderId,
    orderNumber: formatOrderNumber(orderId)
  };
}

async function attachStripeSessionToPendingOrder(orderId: string | null, stripeSessionId: string) {
  if (!orderId) return;
  const supabase = createSupabaseAdminClient();
  if (!supabase) return;

  const { error } = await supabase
    .from("orders")
    .update({
      stripe_session_id: stripeSessionId,
      updated_at: new Date().toISOString()
    })
    .eq("id", orderId);

  if (error) {
    console.error("Could not attach Stripe session to pending order", error);
  }
}

async function getValidatedWelcomeRewardDiscount(email: string | null, items: ValidatedCheckoutItem[]) {
  if (!email) return 0;

  const existingOrders = await listCustomerOrders(email);
  if (existingOrders.length > 0) return 0;

  const currentTotal = items.reduce((sum, item) => sum + (item.checkoutLineTotal ?? item.price * item.cartItem.qty), 0);
  return Math.min(10, Math.max(0, Math.round(currentTotal * 100) / 100));
}

function applyCheckoutDiscount(items: ValidatedCheckoutItem[], discount: number) {
  const total = items.reduce((sum, item) => sum + (item.checkoutLineTotal ?? item.price * item.cartItem.qty), 0);
  let remainingDiscount = discount;

  return items.map((item, index) => {
    const lineTotal = item.checkoutLineTotal ?? item.price * item.cartItem.qty;
    const isLast = index === items.length - 1;
    const lineDiscount = isLast ? remainingDiscount : roundMoney((discount * lineTotal) / total);
    remainingDiscount = roundMoney(remainingDiscount - lineDiscount);

    return {
      ...item,
      checkoutQuantity: 1,
      checkoutLineTotal: roundMoney(Math.max(0, lineTotal - lineDiscount)),
      attributes: {
        ...item.attributes,
        ...(lineDiscount > 0 ? { welcome_reward_discount: lineDiscount } : {})
      }
    };
  });
}

function buildCompactMetadataItem(item: ValidatedCheckoutItem) {
  return {
    p: item.productId,
    v: item.id,
    s: item.sku,
    q: item.cartItem.qty,
    pr: item.checkoutLineTotal ? item.checkoutLineTotal / item.cartItem.qty : item.price,
    bd: item.bundleDiscount ?? 0,
    veh: item.attributes.vehicle,
    a: item.attributes.vehicle_application_id,
    m: item.attributes.vehicle_make,
    d: item.attributes.vehicle_model,
    y: item.attributes.vehicle_year,
    dl: item.attributes.driver_length,
    pl: item.attributes.passenger_length,
    rl: item.attributes.rear_length
  };
}

async function findActivePromotionCode(stripe: Stripe, code: string) {
  const promotionCodes = await stripe.promotionCodes.list({
    active: true,
    code,
    limit: 1
  });

  return promotionCodes.data[0] ?? null;
}

function buildVehicleMetadata(items: ValidatedCheckoutItem[]) {
  const attributes = items.map((item) => item.attributes).find((entry) => entry.vehicle_application_id);

  if (!attributes) return null;

  return {
    a: attributes.vehicle_application_id,
    m: attributes.vehicle_make,
    d: attributes.vehicle_model,
    y: attributes.vehicle_year,
    make: attributes.vehicle_make,
    model: attributes.vehicle_model,
    year: attributes.vehicle_year,
    series: "",
    body: ""
  };
}

function getProductName(value: unknown) {
  if (!value) return null;
  if (Array.isArray(value)) return getProductName(value[0]);
  if (typeof value === "object" && "name" in value) {
    return String((value as { name: string }).name);
  }
  return null;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function formatOrderNumber(orderId: string) {
  return `NXA${orderId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(value);
}
