import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getVariantsByIds } from "@/lib/queries/catalog";
import type { CartItem } from "@/lib/types";

export async function POST(request: Request) {
  const { items } = (await request.json()) as { items?: CartItem[] };

  if (!items?.length) {
    return NextResponse.json({ error: "Cart is empty." }, { status: 400 });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json(
      { error: "Stripe is not configured. Add STRIPE_SECRET_KEY to .env.local." },
      { status: 500 }
    );
  }

  const requestedByVariantId = new Map(items.map((item) => [item.variantId, item]));
  const dbVariants = await getVariantsByIds([...requestedByVariantId.keys()]);

  if (dbVariants.length !== requestedByVariantId.size) {
    return NextResponse.json({ error: "One or more cart items are no longer available." }, { status: 409 });
  }

  let lineItems;

  try {
    lineItems = dbVariants.map((variant) => {
      const cartItem = requestedByVariantId.get(variant.id);

      if (!cartItem) {
        throw new Error(`Cart item missing for variant ${variant.id}`);
      }

      if (variant.stock < cartItem.qty) {
        throw new Error(`Not enough stock for ${variant.sku}`);
      }

      return {
        cartItem,
        variant
      };
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Cart item validation failed." },
      { status: 409 }
    );
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    billing_address_collection: "required",
    shipping_address_collection: {
      allowed_countries: ["NZ", "AU", "US"]
    },
    line_items: lineItems.map(({ cartItem, variant }) => ({
      quantity: cartItem.qty,
      price_data: {
        currency: "nzd",
        unit_amount: Math.round(Number(variant.price) * 100),
        product_data: {
          name: getProductName(variant.products) ?? cartItem.name,
          description: `${variant.sku} | ${Object.entries(variant.attributes)
            .map(([key, value]) => `${key}: ${value}`)
            .join(", ")}`,
          metadata: {
            product_id: variant.product_id,
            variant_id: variant.id,
            sku: variant.sku
          }
        }
      }
    })),
    metadata: {
      items: JSON.stringify(
        lineItems.map(({ cartItem, variant }) => ({
          product_id: variant.product_id,
          variant_id: variant.id,
          sku: variant.sku,
          qty: cartItem.qty,
          price: Number(variant.price)
        }))
      ),
      source: "nexauto"
    },
    success_url: `${siteUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteUrl}/checkout/cancel`
  });

  return NextResponse.json({ url: session.url });
}

function getProductName(value: unknown) {
  if (!value) return null;
  if (Array.isArray(value)) return getProductName(value[0]);
  if (typeof value === "object" && "name" in value) {
    return String((value as { name: string }).name);
  }
  return null;
}
