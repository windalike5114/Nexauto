import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Search, SlidersHorizontal } from "lucide-react";
import { formatMoney } from "@/lib/catalog";
import { productImage } from "@/lib/product-content";
import { listProducts } from "@/lib/queries/catalog";
import { listWiperSets } from "@/lib/queries/wiper-commerce";
import { buildShopPageHref, getShopPaginationPages, paginateShopItems, parseShopPage, type ShopPageQuery } from "@/lib/shop-pagination";
import type { Product, WiperSet } from "@/lib/types";
import { getWiperSetPreviewImage } from "@/lib/wiper-product-images";

export const dynamic = "force-dynamic";

const filters = [
  ["All Products", "all"],
  ["Wiper Blades", "wipers"],
  ["Oil Filters", "filters"],
  ["Light Bulbs", "bulbs"],
  ["Batteries", "batteries"],
  ["Control Arms", "suspension"]
] as const;

type ShopParams = { q?: string; category?: string; page?: string };
type CatalogItem = { id: string; kind: "wiper"; item: WiperSet } | { id: string; kind: "product"; item: Product };

export async function generateMetadata({ searchParams }: { searchParams: Promise<ShopParams> }): Promise<Metadata> {
  const params = await searchParams;
  const page = parseShopPage(params.page) ?? 1;
  const category = normalizeCategory(params.category);
  const canonical = `https://nexautoparts.co.nz${buildShopPageHref({ category }, page)}`;

  return {
    title: page > 1 ? `Shop All Auto Parts - Page ${page}` : "Shop All Auto Parts",
    description: "Browse current NexAutoParts products across wiper blades, light bulbs, filters, batteries and suspension parts.",
    alternates: { canonical },
    robots: params.q ? { index: false, follow: true } : { index: true, follow: true }
  };
}

export default async function ShopPage({ searchParams }: { searchParams: Promise<ShopParams> }) {
  const params = await searchParams;
  const requestedPage = parseShopPage(params.page);
  if (requestedPage === null) notFound();

  const category = normalizeCategory(params.category);
  const query = params.q?.trim().toLowerCase() ?? "";
  const { wiperSets, products, error } = await loadCatalog();
  const items = buildCatalogItems(wiperSets, products, category, query);
  const pagination = paginateShopItems(items, requestedPage);
  if (requestedPage > pagination.totalPages) notFound();
  const paginationQuery = { category, q: params.q?.trim() };

  return (
    <main className="bg-[#F8FAFC]">
      <section className="border-b border-black/10 bg-ink text-white">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-signal">NexAutoParts catalogue</p>
          <h1 className="mt-2 text-4xl font-black sm:text-5xl">Shop all parts</h1>
          <p className="mt-3 max-w-2xl text-base font-semibold leading-7 text-white/70">Browse current products by category. Vehicle-specific checks remain available inside each category.</p>
          <form action="/shop" className="mt-6 flex max-w-2xl overflow-hidden rounded-lg bg-white shadow-lg">
            {category !== "all" ? <input type="hidden" name="category" value={category} /> : null}
            <Search className="ml-4 h-5 w-5 self-center text-steel" />
            <input name="q" type="search" defaultValue={params.q ?? ""} placeholder="Search by product, size or SKU" className="h-12 min-w-0 flex-1 px-3 text-sm font-bold text-ink outline-none" />
            <button className="bg-signal px-5 text-sm font-black text-white hover:bg-red-700">Search</button>
          </form>
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
        <div className="mb-7 flex gap-2 overflow-x-auto pb-1" aria-label="Product categories">
          {filters.map(([label, value]) => (
            <Link key={value} href={value === "all" ? "/shop" : `/shop?category=${value}`} className={`shrink-0 rounded-lg border px-4 py-2.5 text-sm font-black ${category === value ? "border-ink bg-ink text-white" : "border-black/10 bg-white text-steel hover:border-ink hover:text-ink"}`}>
              {label}
            </Link>
          ))}
        </div>

        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2"><SlidersHorizontal className="h-5 w-5 text-signal" /><h2 className="text-xl font-black">{filters.find(([, value]) => value === category)?.[0]}</h2></div>
          <p className="text-sm font-bold text-steel">
            {pagination.totalItems > 0
              ? `Showing ${pagination.startIndex + 1}-${pagination.startIndex + pagination.items.length} of ${pagination.totalItems}`
              : "0 current listings"}
          </p>
        </div>

        {error ? <p className="rounded-xl border border-signal/20 bg-white p-5 font-bold text-signal">{error}</p> : null}
        {items.length ? (
          <>
            <div className="grid grid-cols-2 gap-x-2 gap-y-4 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
              {pagination.items.map((item) => <CatalogCard key={`${item.kind}-${item.id}`} item={item} />)}
            </div>
            {pagination.totalPages > 1 ? (
              <ShopPagination currentPage={requestedPage} totalPages={pagination.totalPages} query={paginationQuery} />
            ) : null}
          </>
        ) : (
          <section className="rounded-2xl border border-black/10 bg-white p-7 shadow-sm sm:p-10">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-signal">Fitment help available</p>
            <h2 className="mt-2 text-2xl font-black">No current product listing matches this view.</h2>
            <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-steel">We will not show a generic placeholder as if it were a specific part. Send your vehicle, engine, chassis or part number and we can confirm what information is still needed.</p>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <Link href={category === "all" ? "/contact" : `/parts/${category === "wipers" ? "wipers" : category}`} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-ink px-5 text-sm font-black text-white">Open category <ArrowRight className="h-4 w-4" /></Link>
              <Link href="/contact" className="inline-flex h-11 items-center justify-center rounded-lg border border-black/10 px-5 text-sm font-black">Request a quote</Link>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function normalizeCategory(value: string | undefined) {
  return filters.some(([, filterValue]) => filterValue === value) ? value ?? "all" : "all";
}

async function loadCatalog() {
  try {
    const [wiperSets, products] = await Promise.all([listWiperSets(), listProducts()]);
    return { wiperSets, products, error: "" };
  } catch (error) {
    return { wiperSets: [] as WiperSet[], products: [] as Product[], error: error instanceof Error ? error.message : "Could not load products." };
  }
}

function buildCatalogItems(wiperSets: WiperSet[], products: Product[], category: string, query: string): CatalogItem[] {
  const sellableProducts = products.filter((product) => !["vehicle-fit-battery", "vehicle-fit-oil-filter"].includes(product.slug));
  const includeWipers = category === "all" || category === "wipers";
  const filteredProducts = sellableProducts.filter((product) => {
    if (category === "wipers" && product.category !== "wiper") return false;
    if (category === "bulbs" && product.category !== "bulb") return false;
    if (["filters", "batteries", "suspension"].includes(category)) return false;
    if (category !== "all" && !["wipers", "bulbs"].includes(category)) return false;
    return matchesQuery(`${product.name} ${product.slug} ${product.description}`, query);
  });
  const filteredWipers = includeWipers
    ? wiperSets.filter((item) => matchesQuery(`${item.name} ${item.sku} ${item.driverLengthIn} ${item.passengerLengthIn}`, query)).slice(0, category === "wipers" ? 48 : 8)
    : [];
  return [
    ...filteredWipers.map((item) => ({ id: item.id, kind: "wiper" as const, item })),
    ...filteredProducts.map((item) => ({ id: item.id, kind: "product" as const, item }))
  ];
}

function matchesQuery(value: string, query: string) {
  return !query || value.toLowerCase().includes(query);
}

function ShopPagination({ currentPage, totalPages, query }: { currentPage: number; totalPages: number; query: ShopPageQuery }) {
  const pages = getShopPaginationPages(currentPage, totalPages);

  return (
    <nav className="mt-8 flex flex-wrap items-center justify-center gap-2" aria-label="Product pagination">
      <PaginationLink
        href={buildShopPageHref(query, currentPage - 1)}
        disabled={currentPage === 1}
        label="Previous"
        rel="prev"
      />
      {pages.map((page, index) => (
        <span key={page} className="contents">
          {index > 0 && page - pages[index - 1] > 1 ? <span className="px-1 text-steel" aria-hidden>…</span> : null}
          <PaginationLink
            href={buildShopPageHref(query, page)}
            active={page === currentPage}
            label={String(page)}
            ariaLabel={`Page ${page}`}
          />
        </span>
      ))}
      <PaginationLink
        href={buildShopPageHref(query, currentPage + 1)}
        disabled={currentPage === totalPages}
        label="Next"
        rel="next"
      />
    </nav>
  );
}

function PaginationLink({
  href,
  label,
  active = false,
  disabled = false,
  rel,
  ariaLabel
}: {
  href: string;
  label: string;
  active?: boolean;
  disabled?: boolean;
  rel?: "prev" | "next";
  ariaLabel?: string;
}) {
  const className = `inline-flex h-10 min-w-10 items-center justify-center rounded-lg border px-3 text-sm font-black ${
    active
      ? "border-ink bg-ink text-white"
      : disabled
        ? "cursor-not-allowed border-black/5 bg-white text-steel/40"
        : "border-black/10 bg-white text-ink hover:border-ink"
  }`;

  if (disabled) return <span className={className} aria-disabled="true">{label}</span>;

  return <Link href={href as never} className={className} rel={rel} aria-label={ariaLabel} aria-current={active ? "page" : undefined}>{label}</Link>;
}

function CatalogCard({ item }: { item: CatalogItem }) {
  const isWiper = item.kind === "wiper";
  const image = isWiper ? getWiperSetPreviewImage(item.item) : productImage(item.item);
  const href = isWiper ? `/wipers/${item.item.sku}` : `/products/${item.item.slug}`;
  const name = isWiper ? `Front Wiper Pair ${item.item.driverLengthIn}\" + ${item.item.passengerLengthIn}\"` : item.item.name;
  const eyebrow = isWiper ? `SKU ${item.item.sku}` : item.item.category === "bulb" ? "Light Bulbs" : "Rear Wipers";
  return (
    <Link href={href as never} className="group min-w-0 overflow-hidden rounded-lg border border-black/10 bg-white shadow-sm hover:-translate-y-0.5 hover:shadow-panel sm:rounded-xl">
      <div className="relative aspect-square bg-zinc-100 sm:aspect-[4/3]">
        <Image src={image} alt={name} fill className="object-contain p-2 transition group-hover:scale-[1.03] sm:p-4" sizes="(min-width: 1280px) 25vw, (min-width: 640px) 50vw, 50vw" />
      </div>
      <div className="p-2.5 sm:p-4">
        <p className="truncate text-[9px] font-black uppercase tracking-[0.1em] text-signal sm:text-[11px] sm:tracking-[0.14em]">{eyebrow}</p>
        <h3 title={name} className="mt-1 line-clamp-2 min-h-8 text-[13px] font-black leading-4 sm:mt-2 sm:min-h-12 sm:text-base sm:leading-6">{name}</h3>
        <div className="mt-2 flex items-center justify-between gap-2 sm:mt-4">
          <span className="text-base font-black sm:text-xl">{formatMoney(item.item.price)}</span>
          <span className="hidden items-center gap-2 text-sm font-black sm:inline-flex">View <ArrowRight className="h-4 w-4" /></span>
        </div>
      </div>
    </Link>
  );
}
