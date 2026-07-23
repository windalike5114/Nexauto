import { NextResponse } from "next/server";
import Stripe from "stripe";
import { assertInternalRecoveryAccess } from "@/lib/application/recovery/internal-auth";
import { reconcileOrderPayment } from "@/lib/application/reconciliation/reconcile-order-payment";
import { createPaymentReconciliationRepository } from "@/lib/infrastructure/supabase/payment-reconciliation.repository";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const unauthorized = assertInternalRecoveryAccess(request);
  if (unauthorized) return unauthorized;
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "Stripe is not configured." }, { status: 503 });
  }

  const body = await safeJson(request);
  const orderId = typeof body?.orderId === "string" ? body.orderId : undefined;
  const stripeSessionId = typeof body?.stripeSessionId === "string" ? body.stripeSessionId : undefined;
  if (!orderId && !stripeSessionId) {
    return NextResponse.json({ error: "orderId or stripeSessionId is required." }, { status: 400 });
  }

  const result = await reconcileOrderPayment(
    { orderId, stripeSessionId },
    { repository: createPaymentReconciliationRepository(new Stripe(process.env.STRIPE_SECRET_KEY)) }
  );
  return NextResponse.json(result);
}

async function safeJson(request: Request) {
  try {
    return (await request.json()) as { orderId?: unknown; stripeSessionId?: unknown };
  } catch {
    return null;
  }
}
