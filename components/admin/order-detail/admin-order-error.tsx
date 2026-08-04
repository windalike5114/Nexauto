import Link from "next/link";

export function AdminOrderError({ title, message }: { title: string; message: string }) {
  return (
    <main className="min-h-screen bg-zinc-100 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <Link href="/admin?tab=orders" className="text-sm font-black text-steel hover:text-ink">
          Back to orders
        </Link>
        <section className="mt-5 rounded-lg border border-black/10 bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-black">{title}</h1>
          <p className="mt-3 text-sm font-bold leading-6 text-steel">{message}</p>
        </section>
      </div>
    </main>
  );
}
