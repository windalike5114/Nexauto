import Link from "next/link";

export default function CheckoutSuccessPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6 lg:px-8">
      <div className="rounded-lg border border-black/10 bg-white p-8 shadow-panel">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-mint">Payment received</p>
        <h1 className="mt-3 text-4xl font-black">Order confirmed</h1>
        <p className="mt-4 leading-7 text-steel">Stripe has accepted the payment. The webhook route can now persist this order in Supabase.</p>
        <Link href="/shop" className="mt-6 inline-flex rounded bg-ink px-5 py-3 font-black text-white">
          Keep shopping
        </Link>
      </div>
    </main>
  );
}
