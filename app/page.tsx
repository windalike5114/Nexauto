import Link from "next/link";
import { ArrowRight, BadgeCheck, CarFront, ClipboardCheck, PackageCheck, ShieldCheck, Truck } from "lucide-react";
import { ProductCard } from "@/components/product-card";
import { WiperFitmentFinder } from "@/components/wiper-fitment-finder";
import { listProducts } from "@/lib/queries/catalog";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { products, error } = await loadHomeData();

  return (
    <main>
      <section className="bg-ink text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-3 text-sm font-bold sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <span>Vehicle-based wiper finder</span>
          <span className="text-white/75">Front pair kits live now. Connector handling is prepared for fulfillment.</span>
        </div>
      </section>

      <section className="border-b border-black/10 bg-zinc-50">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[0.78fr_1.22fr] lg:px-8 lg:py-14">
          <div className="flex flex-col justify-center">
            <p className="text-sm font-black uppercase tracking-[0.2em] text-signal">NexAuto wiper tools</p>
            <h1 className="mt-4 max-w-3xl text-4xl font-black leading-tight sm:text-6xl">
              Find the right front wiper pair by vehicle.
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-steel">
              Search your make, model, and year to get the matched front pair SKU. Rear blade is handled as an optional add-on when data is available.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/shop?category=wiper" className="inline-flex h-12 items-center gap-2 rounded bg-signal px-5 font-black text-white hover:bg-red-700">
                Open wiper shop
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/products/universal-wiper-blade" className="inline-flex h-12 items-center rounded border border-black/10 bg-white px-5 font-black text-ink hover:border-ink">
                Blade information
              </Link>
            </div>
          </div>

          <WiperFitmentFinder />
        </div>
      </section>

      {error ? <SetupNotice message={error} /> : null}

      <section className="border-b border-black/10 bg-white">
        <div className="mx-auto grid max-w-7xl gap-3 px-4 py-5 sm:grid-cols-3 sm:px-6 lg:px-8">
          <TrustItem icon={<CarFront className="h-5 w-5" />} title="Vehicle lookup" text="Make, model, and year driven." />
          <TrustItem icon={<PackageCheck className="h-5 w-5" />} title="Pair SKU" text="Front blades sold as a matched kit." />
          <TrustItem icon={<Truck className="h-5 w-5" />} title="Fulfillment ready" text="Vehicle context travels with cart." />
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Current range</p>
            <h2 className="mt-2 text-3xl font-black">Wiper products</h2>
          </div>
          <Link href="/shop?category=wiper" className="inline-flex h-11 items-center justify-center rounded bg-ink px-4 text-sm font-black text-white hover:bg-black">
            View wiper catalog
          </Link>
        </div>

        {products.length > 0 ? (
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} categoryName="Wipers" />
            ))}
          </div>
        ) : (
          <EmptyState text="No active wiper products found in Supabase yet." />
        )}
      </section>

      <section className="bg-zinc-50">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-3 lg:px-8">
          <ValueBlock icon={<ClipboardCheck className="h-5 w-5" />} title="Search vehicle" text="Use the finder to resolve blade lengths from fitment data." />
          <ValueBlock icon={<BadgeCheck className="h-5 w-5" />} title="Review SKU" text="Open the recommended front pair page before adding to cart." />
          <ValueBlock icon={<ShieldCheck className="h-5 w-5" />} title="Checkout" text="Pay securely while vehicle details remain attached to the order." />
        </div>
      </section>
    </main>
  );
}

async function loadHomeData() {
  try {
    const products = await listProducts("wiper");
    return { products, error: "" };
  } catch (error) {
    return {
      products: [],
      error: error instanceof Error ? error.message : "Could not load Supabase wiper data."
    };
  }
}

function TrustItem({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="flex items-center gap-3 rounded bg-zinc-50 p-4">
      <div className="grid h-10 w-10 place-items-center rounded bg-mint/10 text-mint">{icon}</div>
      <div>
        <p className="font-black">{title}</p>
        <p className="text-sm text-steel">{text}</p>
      </div>
    </div>
  );
}

function ValueBlock({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div>
      <div className="grid h-11 w-11 place-items-center rounded bg-ink text-white">{icon}</div>
      <h3 className="mt-4 text-xl font-black">{title}</h3>
      <p className="mt-2 leading-7 text-steel">{text}</p>
    </div>
  );
}

function SetupNotice({ message }: { message: string }) {
  return (
    <section className="mx-auto max-w-7xl px-4 pt-8 sm:px-6 lg:px-8">
      <div className="rounded-lg border border-signal/30 bg-white p-5 text-sm font-bold text-signal">{message}</div>
    </section>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-lg border border-black/10 bg-white p-8 text-center font-bold text-steel">{text}</div>;
}
