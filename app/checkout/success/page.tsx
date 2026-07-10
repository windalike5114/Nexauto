import Link from "next/link";
import Stripe from "stripe";
import { CheckoutSuccessActions } from "@/components/checkout-success-actions";
import { createClient } from "@/utils/supabase/server";

export default async function CheckoutSuccessPage({ searchParams }: { searchParams: Promise<{ session_id?: string }> }) {
  const { session_id: sessionId } = await searchParams;
  const [checkoutSession, signedIn] = await Promise.all([
    loadCheckoutSession(sessionId),
    isSignedIn()
  ]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6 lg:px-8">
      <div className="rounded-lg border border-black/10 bg-white p-8 shadow-panel">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-mint">Payment received</p>
        <h1 className="mt-3 text-4xl font-black">Order confirmed</h1>
        <p className="mt-4 leading-7 text-steel">
          Stripe has accepted the payment. Your order is independent from account registration and will be recorded by email.
        </p>
        <CheckoutSuccessActions
          sessionId={sessionId}
          customerEmail={checkoutSession?.customerEmail ?? ""}
          customerName={checkoutSession?.customerName ?? ""}
          signedIn={signedIn}
        />
        <Link href="/shop?category=wiper" className="mt-6 inline-flex rounded bg-ink px-5 py-3 font-black text-white">
          Keep shopping
        </Link>
      </div>
    </main>
  );
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
