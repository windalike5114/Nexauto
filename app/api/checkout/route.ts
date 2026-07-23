import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createCheckoutSession } from "@/lib/application/checkout/create-checkout-session";
import { isCheckoutApplicationError } from "@/lib/application/checkout/checkout.errors";
import { validateCheckoutRequest } from "@/lib/application/checkout/checkout.adapters";
import { createSupabaseCheckoutCustomerRepository } from "@/lib/infrastructure/supabase/checkout-customer.repository";
import { createSupabaseCheckoutOrderRepository } from "@/lib/infrastructure/supabase/checkout-order.repository";
import { createSupabaseCheckoutProductRepository } from "@/lib/infrastructure/supabase/checkout-product.repository";
import { createStripeCheckoutSessionAdapter } from "@/lib/infrastructure/stripe/create-checkout-session";
import { createStripeCouponAdapter } from "@/lib/infrastructure/stripe/coupon.adapter";
import { createClient } from "@/utils/supabase/server";

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Checkout request is invalid." }, { status: 400 });
  }

  const checkoutRequest = validateCheckoutRequest(body);

  if (!checkoutRequest.ok) {
    return NextResponse.json({ error: checkoutRequest.error }, { status: 400 });
  }

  if (!checkoutRequest.data.legacyItems.length) {
    return NextResponse.json({ error: "Cart is empty." }, { status: 400 });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json(
      { error: "Stripe is not configured. Add STRIPE_SECRET_KEY to .env.local." },
      { status: 500 }
    );
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  const checkoutRequestId = getCheckoutRequestId(request);

  try {
    const result = await createCheckoutSession(
      {
        checkoutRequestId,
        items: checkoutRequest.data.legacyItems,
        couponCode: checkoutRequest.data.couponCode,
        welcomeRewardApplied: checkoutRequest.data.welcomeRewardApplied,
        customer: {
          email: user?.email ?? null,
          userId: user?.id ?? null
        },
        siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
      },
      {
        products: createSupabaseCheckoutProductRepository(),
        customers: createSupabaseCheckoutCustomerRepository(),
        orders: createSupabaseCheckoutOrderRepository(),
        coupons: createStripeCouponAdapter(stripe),
        payments: createStripeCheckoutSessionAdapter(stripe),
        logger: console
      }
    );

    return NextResponse.json({ url: result.checkoutUrl });
  } catch (error) {
    if (isCheckoutApplicationError(error)) {
      console.error("checkout.failed", {
        code: error.code,
        checkoutRequestId,
        context: error.context,
        message: error.message
      });
      return NextResponse.json({ error: error.safeMessage }, { status: error.status });
    }

    console.error("checkout.unhandled_failed", {
      checkoutRequestId,
      message: error instanceof Error ? error.message : "Unknown checkout error"
    });

    return NextResponse.json({ error: "Checkout could not be started." }, { status: 500 });
  }
}

function getCheckoutRequestId(request: Request) {
  const headerValue = request.headers.get("x-checkout-request-id");

  if (headerValue?.trim()) return headerValue.trim().slice(0, 120);

  return crypto.randomUUID();
}
