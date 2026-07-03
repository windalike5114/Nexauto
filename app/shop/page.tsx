import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";
import { ProductCard } from "@/components/product-card";
import { formatMoney } from "@/lib/catalog";
import { listCategories, listProducts } from "@/lib/queries/catalog";
import type { Product } from "@/lib/types";

export const dynamic = "force-dynamic";

type ShopSearchParams = {
  category?: string;
  sort?: string;
  min?: string;
  max?: string;
  stock?: string;
  show?: string;
};

export default async function ShopPage({ searchParams }: { searchParams: Promise<ShopSearchParams> }) {
  const params = await searchParams;
  const { categories, products, error } = await loadShopData(params.category);
  const categoryNameBySlug = new Map(categories.map((entry) => [entry.slug, entry.name]));
  const filteredProducts = applyShopFilters(products, params);
  const showCount = Number(params.show ?? 12);
  const visibleProducts = filteredProducts.slice(0, Number.isFinite(showCount) ? showCount : 12);

  return (
    <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-8 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Shop</p>
          <h1 className="mt-2 text-4xl font-black">Parts catalog</h1>
          <p className="mt-3 text-sm font-bold text-steel">
            Showing {visibleProducts.length} of {filteredProducts.length} products
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <FilterLink href={buildShopHref(params, { category: undefined })} active={!params.category} label="All" />
          {categories.slice(0, 5).map((entry) => (
            <FilterLink
              key={entry.slug}
              href={buildShopHref(params, { category: entry.slug })}
              active={params.category === entry.slug}
              label={entry.name}
            />
          ))}
        </div>
      </div>

      {error ? <div className="mb-6 rounded-lg border border-signal/30 bg-white p-5 text-sm font-bold text-signal">{error}</div> : null}

      <div className="grid gap-8 lg:grid-cols-[280px_1fr]">
        <aside className="space-y-5">
          <section className="rounded-lg border border-black/10 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="h-5 w-5 text-signal" />
              <h2 className="font-black">Filter products</h2>
            </div>
            <div className="mt-5 space-y-5">
              <FilterGroup title="Categories">
                <div className="grid gap-2">
                  <SidebarLink href={buildShopHref(params, { category: undefined })} active={!params.category} label="All categories" />
                  {categories.map((entry) => (
                    <SidebarLink
                      key={entry.slug}
                      href={buildShopHref(params, { category: entry.slug })}
                      active={params.category === entry.slug}
                      label={entry.name}
                    />
                  ))}
                </div>
              </FilterGroup>

              <FilterGroup title="Price">
                <div className="grid grid-cols-2 gap-2">
                  <PriceLink params={params} min="0" max="20" label="Under $20" />
                  <PriceLink params={params} min="20" max="50" label="$20 - $50" />
                  <PriceLink params={params} min="50" max="" label="$50+" />
                  <SidebarLink href={buildShopHref(params, { min: undefined, max: undefined })} active={!params.min && !params.max} label="Any price" />
                </div>
              </FilterGroup>

              <FilterGroup title="Availability">
                <div className="grid gap-2">
                  <SidebarLink href={buildShopHref(params, { stock: "in" })} active={params.stock === "in"} label="In stock" />
                  <SidebarLink href={buildShopHref(params, { stock: undefined })} active={!params.stock} label="Any availability" />
                </div>
              </FilterGroup>
            </div>
          </section>

          <section className="rounded-lg border border-black/10 bg-white p-5 shadow-sm">
            <h2 className="font-black">Featured</h2>
            <div className="mt-4 space-y-3">
              {products.slice(0, 3).map((product) => (
                <Link key={product.id} href={`/products/${product.slug}`} className="block border-b border-black/5 pb-3 last:border-0 last:pb-0">
                  <p className="text-sm font-black">{product.name}</p>
                  <p className="mt-1 text-sm font-bold text-signal">{formatMoney(product.price)}</p>
                </Link>
              ))}
            </div>
          </section>
        </aside>

        <section>
          <div className="mb-5 flex flex-col gap-3 rounded-lg border border-black/10 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2">
              <ControlLink href={buildShopHref(params, { sort: "latest" })} active={(params.sort ?? "latest") === "latest"} label="Latest" />
              <ControlLink href={buildShopHref(params, { sort: "price-asc" })} active={params.sort === "price-asc"} label="Price low to high" />
              <ControlLink href={buildShopHref(params, { sort: "price-desc" })} active={params.sort === "price-desc"} label="Price high to low" />
            </div>
            <div className="flex gap-2">
              {[12, 24, 36].map((count) => (
                <ControlLink
                  key={count}
                  href={buildShopHref(params, { show: String(count) })}
                  active={String(count) === String(params.show ?? 12)}
                  label={String(count)}
                />
              ))}
            </div>
          </div>

          {visibleProducts.length > 0 ? (
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {visibleProducts.map((product) => (
                <ProductCard key={product.id} product={product} categoryName={categoryNameBySlug.get(product.category)} />
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-black/10 bg-white p-8 text-center font-bold text-steel">
              No products match these filters.
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

async function loadShopData(category?: string) {
  try {
    const [categories, products] = await Promise.all([listCategories(), listProducts(category)]);
    return { categories, products, error: "" };
  } catch (error) {
    return {
      categories: [],
      products: [],
      error: error instanceof Error ? error.message : "Could not load Supabase catalog data."
    };
  }
}

function applyShopFilters(products: Product[], params: ShopSearchParams) {
  const min = params.min ? Number(params.min) : null;
  const max = params.max ? Number(params.max) : null;
  const sorted = [...products].filter((product) => {
    if (min !== null && product.price < min) return false;
    if (max !== null && product.price > max) return false;
    return true;
  });

  if (params.sort === "price-asc") sorted.sort((a, b) => a.price - b.price);
  if (params.sort === "price-desc") sorted.sort((a, b) => b.price - a.price);

  return sorted;
}

function buildShopHref(params: ShopSearchParams, changes: Partial<ShopSearchParams>) {
  const next = new URLSearchParams();
  const merged = { ...params, ...changes };

  Object.entries(merged).forEach(([key, value]) => {
    if (value) next.set(key, value);
  });

  const query = next.toString();
  return query ? `/shop?${query}` : "/shop";
}

function FilterLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link href={href as never} className={`rounded px-4 py-2 text-sm font-black ${active ? "bg-ink text-white" : "bg-white text-steel"}`}>
      {label}
    </Link>
  );
}

function SidebarLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href as never}
      className={`rounded border px-3 py-2 text-sm font-bold ${active ? "border-ink bg-ink text-white" : "border-black/10 text-steel hover:border-ink"}`}
    >
      {label}
    </Link>
  );
}

function ControlLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link href={href as never} className={`rounded px-3 py-2 text-sm font-black ${active ? "bg-ink text-white" : "bg-zinc-100 text-steel"}`}>
      {label}
    </Link>
  );
}

function PriceLink({ params, min, max, label }: { params: ShopSearchParams; min: string; max: string; label: string }) {
  const active = params.min === min && (params.max ?? "") === max;
  return <SidebarLink href={buildShopHref(params, { min, max: max || undefined })} active={active} label={label} />;
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-3 text-sm font-black uppercase tracking-[0.14em] text-steel">{title}</h3>
      {children}
    </div>
  );
}
