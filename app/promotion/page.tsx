import Link from "next/link";
import { ProductCard } from "@/components/product-card";
import { listCategories, listProducts } from "@/lib/queries/catalog";

export const dynamic = "force-dynamic";

export default async function PromotionPage() {
  const { categories, products } = await loadData();
  const categoryNameBySlug = new Map(categories.map((category) => [category.slug, category.name]));

  return (
    <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <section className="rounded-lg bg-ink p-8 text-white md:p-10">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Promotion</p>
        <h1 className="mt-3 max-w-3xl text-4xl font-black sm:text-5xl">Deals on everyday replacement parts</h1>
        <p className="mt-4 max-w-2xl leading-8 text-white/70">
          Highlight seasonal wiper specials, bulb bundles, clearance stock, and future trade pricing from one place.
        </p>
        <Link href="/shop" className="mt-6 inline-flex rounded bg-signal px-5 py-3 font-black text-white hover:bg-red-700">
          Shop all deals
        </Link>
      </section>

      <section className="mt-10">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Hot Sale</p>
            <h2 className="mt-2 text-3xl font-black">Current offers</h2>
          </div>
        </div>
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} categoryName={categoryNameBySlug.get(product.category)} />
          ))}
        </div>
      </section>
    </main>
  );
}

async function loadData() {
  try {
    const [categories, products] = await Promise.all([listCategories(), listProducts()]);
    return { categories, products };
  } catch {
    return { categories: [], products: [] };
  }
}
