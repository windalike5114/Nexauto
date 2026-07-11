import Link from "next/link";
import Stripe from "stripe";
import { CheckoutSuccessActions } from "@/components/checkout-success-actions";
import { formatMoney } from "@/lib/catalog";
import { createSupabaseAdminClient } from "@/lib/supabase";
import { createClient } from "@/utils/supabase/server";

export default async function CheckoutSuccessPage({ searchParams }: { searchParams: Promise<{ session_id?: string }> }) {
  const { session_id: sessionId } = await searchParams;
  const [checkoutSession, signedIn] = await Promise.all([
    loadCheckoutSession(sessionId),
    isSignedIn()
  ]);
  const order = await loadOrderByStripeSession(sessionId);

  return (
    <main className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6 lg:px-8">
      <div className="rounded-lg border border-black/10 bg-white p-8 shadow-panel">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-mint">Payment received</p>
        <h1 className="mt-3 text-4xl font-black">Order confirmed</h1>
        <p className="mt-4 leading-7 text-steel">
          Your payment has been received. Your order is independent from account registration and will be recorded by email.
        </p>
        {order ? (
          <div className="mt-6 rounded border border-black/10 bg-zinc-50 p-4 text-left">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.14em] text-steel">Order number</p>
                <p className="mt-1 text-lg font-black">{formatOrderNumber(order.id)}</p>
              </div>
              <span className="rounded bg-white px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-steel">{order.status}</span>
            </div>
            <div className="mt-4 grid gap-3 text-sm font-bold text-steel sm:grid-cols-2">
              <p>Total: <span className="font-black text-ink">{formatMoney(order.subtotal)}</span></p>
              <p>Email: <span className="font-black text-ink">{order.email ?? checkoutSession?.customerEmail ?? ""}</span></p>
            </div>
          </div>
        ) : (
          <p className="mt-5 rounded border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-900">
            Your payment is confirmed. The order record may take a moment to appear while Stripe finishes syncing.
          </p>
        )}
        <CheckoutSuccessActions
          sessionId={sessionId}
          customerEmail={order?.email ?? checkoutSession?.customerEmail ?? ""}
          customerName={order?.customerName ?? checkoutSession?.customerName ?? ""}
          signedIn={signedIn}
        />
        <Link href="/shop?category=wiper" className="mt-6 inline-flex rounded bg-ink px-5 py-3 font-black text-white">
          Keep shopping
        </Link>
      </div>
    </main>
  );
}

async function loadOrderByStripeSession(sessionId: string | undefined) {
  if (!sessionId) return null;
  const supabase = createSupabaseAdminClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("orders")
    .select("id,email,customer_name,subtotal,status")
    .eq("stripe_session_id", sessionId)
    .maybeSingle();

  if (error || !data) return null;

  return {
    id: data.id as string,
    email: data.email as string | null,
    customerName: data.customer_name as string | null,
    subtotal: Number(data.subtotal),
    status: data.status as string
  };
}

async function isSignedIn() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  return Boolean(user);
}

async function loadCheckoutSession(sessionId: string | undefined) {
  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!sessionId || !secretKey) return null;

  try {
    const stripe = new Stripe(secretKey);
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    return {
      customerEmail: session.customer_details?.email ?? session.customer_email ?? "",
      customerName: session.customer_details?.name ?? ""
    };
  } catch {
    return null;
  }
}

function formatOrderNumber(orderId: string) {
  return `NXA${orderId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}
