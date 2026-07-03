import Image from "next/image";
import Link from "next/link";
import { ArrowRight, BadgeCheck, PackageCheck, Search, ShieldCheck, Truck, Wrench } from "lucide-react";
import { ProductCard } from "@/components/product-card";
import { listCategories, listProducts } from "@/lib/queries/catalog";
import { productImage } from "@/lib/product-content";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { categories, products, error } = await loadHomeData();
  const categoryNameBySlug = new Map(categories.map((category) => [category.slug, category.name]));
  const heroProduct = products.find((product) => product.category === "wiper") ?? products[0];

  return (
    <main>
      <section className="bg-ink text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-3 text-sm font-bold sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <span>Online auto consumables store</span>
          <span className="text-white/75">Wipers and bulbs live now. More categories ready in database.</span>
        </div>
      </section>

      <section className="border-b border-black/10 bg-white">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[0.95fr_1.05fr] lg:px-8 lg:py-14">
          <div className="flex flex-col justify-center">
            <p className="text-sm font-black uppercase tracking-[0.2em] text-signal">Spec-first auto parts</p>
            <h1 className="mt-4 max-w-3xl text-4xl font-black leading-tight sm:text-6xl">
              Buy the right consumables by size, base, and SKU.
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-steel">
              A clean ecommerce flow for common replacement parts, built around real stock, real variants, and fast repeat ordering.
            </p>
            <div className="mt-7 flex max-w-xl items-center gap-3 rounded-lg border border-black/10 bg-zinc-50 p-3">
              <Search className="h-5 w-5 text-steel" aria-hidden />
              <input className="w-full bg-transparent outline-none" placeholder="Search wiper length, H7, H11..." />
            </div>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/shop" className="inline-flex h-12 items-center gap-2 rounded bg-signal px-5 font-black text-white hover:bg-red-700">
                Shop parts
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/account" className="inline-flex h-12 items-center rounded border border-black/10 px-5 font-black text-ink hover:border-ink">
                Customer account
              </Link>
            </div>
          </div>

          <div className="relative min-h-[360px] overflow-hidden rounded-lg bg-zinc-100">
            {heroProduct ? (
              <Image
                src={productImage(heroProduct)}
                alt={heroProduct.name}
                fill
                priority
                className="object-cover"
                sizes="(min-width: 1024px) 52vw, 100vw"
              />
            ) : null}
            <div className="absolute bottom-4 left-4 right-4 rounded bg-white/92 p-4 shadow-panel backdrop-blur">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-signal">Featured range</p>
              <p className="mt-1 text-xl font-black text-ink">{heroProduct?.name ?? "Auto consumables"}</p>
              <p className="mt-1 text-sm font-bold text-steel">Attribute-driven variants with SKU-level stock.</p>
            </div>
          </div>
        </div>
      </section>

      {error ? <SetupNotice message={error} /> : null}

      <section className="border-b border-black/10 bg-zinc-50">
        <div className="mx-auto grid max-w-7xl gap-3 px-4 py-5 sm:grid-cols-3 sm:px-6 lg:px-8">
          <TrustItem icon={<Truck className="h-5 w-5" />} title="Fast dispatch" text="Ready-to-ship consumables." />
          <TrustItem icon={<ShieldCheck className="h-5 w-5" />} title="Secure checkout" text="Stripe payment flow." />
          <TrustItem icon={<PackageCheck className="h-5 w-5" />} title="SKU stock" text="Variant-level availability." />
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Categories</p>
            <h2 className="mt-2 text-3xl font-black">Shop by part type</h2>
          </div>
          <Link href="/shop" className="hidden rounded bg-ink px-4 py-2 text-sm font-black text-white hover:bg-black sm:inline-flex">
            View all
          </Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {categories.map((category) => (
            <Link
              key={category.slug}
              href={`/shop?category=${category.slug}`}
              className="group rounded-lg border border-black/10 bg-white p-5 shadow-sm hover:border-ink"
            >
              <div className="grid h-11 w-11 place-items-center rounded bg-zinc-100 text-ink group-hover:bg-ink group-hover:text-white">
                <Wrench className="h-5 w-5" />
              </div>
              <p className="mt-5 text-xl font-black">{category.name}</p>
              <p className="mt-2 text-sm leading-6 text-steel">{category.description}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-14 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Popular now</p>
            <h2 className="mt-2 text-3xl font-black">Replacement essentials</h2>
          </div>
        </div>
        {products.length > 0 ? (
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} categoryName={categoryNameBySlug.get(product.category)} />
            ))}
          </div>
        ) : (
          <EmptyState text="No active products found in Supabase yet." />
        )}
      </section>

      <section className="bg-white">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-3 lg:px-8">
          <ValueBlock icon={<BadgeCheck className="h-5 w-5" />} title="Choose attributes" text="Select length, connector, base type, or voltage on the product page." />
          <ValueBlock icon={<PackageCheck className="h-5 w-5" />} title="Match a SKU" text="The storefront resolves the selection to an active variant with stock." />
          <ValueBlock icon={<ShieldCheck className="h-5 w-5" />} title="Pay securely" text="Checkout is handled through Stripe with order records stored in Supabase." />
        </div>
      </section>
    </main>
  );
}

async function loadHomeData() {
  try {
    const [categories, products] = await Promise.all([listCategories(), listProducts()]);
    return { categories, products, error: "" };
  } catch (error) {
    return {
      categories: [],
      products: [],
      error: error instanceof Error ? error.message : "Could not load Supabase catalog data."
    };
  }
}

function TrustItem({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="flex items-center gap-3 rounded bg-white p-4">
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
