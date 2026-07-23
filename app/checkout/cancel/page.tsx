import Link from "next/link";
import { CheckoutCancelActions } from "@/components/checkout-cancel-actions";

export default function CheckoutCancelPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6 lg:px-8">
      <CheckoutCancelActions />
      <div className="rounded-lg border border-black/10 bg-white p-8 shadow-panel">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Checkout cancelled</p>
        <h1 className="mt-3 text-4xl font-black">Your cart is still waiting</h1>
        <p className="mt-4 leading-7 text-steel">No payment was taken. You can adjust the cart and try again.</p>
        <Link href="/cart" className="mt-6 inline-flex rounded bg-ink px-5 py-3 font-black text-white">
          Return to cart
        </Link>
      </div>
    </main>
  );
}
