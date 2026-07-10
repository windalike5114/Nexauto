import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getVariantsByIds } from "@/lib/queries/catalog";
import { getWiperRearAddonsByIds, getWiperSetsByIds } from "@/lib/queries/wiper-commerce";
import { createClient } from "@/utils/supabase/server";
import type { CartItem } from "@/lib/types";

type ValidatedCheckoutItem = {
  cartItem: CartItem;
  id: string;
  productId: string;
  sku: string;
  name: string;
  price: number;
  attributes: Record<string, string | number>;
};

export async function POST(request: Request) {
  const { items, couponCode } = (await request.json()) as { items?: CartItem[]; couponCode?: string };
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

  const requestedByVariantId = new Map(standardItems.map((item) => [item.variantId, item]));
  const requestedByWiperSetId = new Map(wiperSetItems.map((item) => [item.variantId, item]));
  const requestedByRearAddonId = new Map(rearAddonItems.map((item) => [item.variantId, item]));

  const [dbVariants, dbWiperSets, dbRearAddons] = await Promise.all([
    getVariantsByIds([...requestedByVariantId.keys()]),
    getWiperSetsByIds([...requestedByWiperSetId.keys()]),
    getWiperRearAddonsByIds([...requestedByRearAddonId.keys()])
  ]);

  if (dbVariants.length !== requestedByVariantId.size) {
    return NextResponse.json({ error: "One or more cart items are no longer available." }, { status: 409 });
  }

  if (dbWiperSets.length !== requestedByWiperSetId.size || dbRearAddons.length !== requestedByRearAddonId.size) {
    return NextResponse.json({ error: "One or more wiper kit items are no longer available." }, { status: 409 });
  }

  let validatedItems: ValidatedCheckoutItem[];

  try {
    const variantItems = dbVariants.map((variant) => {
      const cartItem = requestedByVariantId.get(variant.id);

      if (!cartItem) {
        throw new Error(`Cart item missing for variant ${variant.id}`);
      }

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
        attributes: variant.attributes
      };
    });

    const wiperSetLineItems = dbWiperSets.map((wiperSet) => {
      const cartItem = requestedByWiperSetId.get(wiperSet.id);
      if (!cartItem) throw new Error(`Cart item missing for wiper set ${wiperSet.id}`);

      return {
        cartItem,
        id: wiperSet.id,
        productId: "wiper_set",
        sku: wiperSet.sku,
        name: wiperSet.name,
        price: wiperSet.price,
        attributes: {
          ...cartItem.attributes,
          driver_length: `${wiperSet.driverLengthIn}"`,
          passenger_length: `${wiperSet.passengerLengthIn}"`
        }
      };
    });

    const rearAddonLineItems = dbRearAddons.map((rearAddon) => {
      const cartItem = requestedByRearAddonId.get(rearAddon.id);
      if (!cartItem) throw new Error(`Cart item missing for rear add-on ${rearAddon.id}`);

      return {
        cartItem,
        id: rearAddon.id,
        productId: "wiper_rear_addon",
        sku: `WPR${rearAddon.rearLengthIn}`,
        name: rearAddon.name,
        price: rearAddon.price,
        attributes: {
          ...cartItem.attributes,
          rear_length: `${rearAddon.rearLengthIn}"`
        }
      };
    });

    validatedItems = [...variantItems, ...wiperSetLineItems, ...rearAddonLineItems];
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
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

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
      allowed_countries: ["NZ", "AU", "US"]
    },
    line_items: validatedItems.map((item) => ({
      quantity: item.cartItem.qty,
      price_data: {
        currency: "nzd",
        unit_amount: Math.round(item.price * 100),
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
      items: JSON.stringify(
        validatedItems.map((item) => ({
          p: item.productId,
          v: item.id,
          s: item.sku,
          q: item.cartItem.qty,
          pr: item.price
        }))
      ),
      vehicle: JSON.stringify(vehicleMetadata),
      vehicle_make: vehicleMetadata?.make ?? "",
      vehicle_model: vehicleMetadata?.model ?? "",
      vehicle_year: vehicleMetadata?.year ? String(vehicleMetadata.year) : "",
      vehicle_series: "",
      vehicle_body: "",
      coupon_code: normalizedCouponCode ?? "",
      source: "nexauto"
    },
    success_url: `${siteUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteUrl}/checkout/cancel`
  };

  const session = await stripe.checkout.sessions.create(sessionParams);

  return NextResponse.json({ url: session.url });
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
