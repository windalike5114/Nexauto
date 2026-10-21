import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Search } from "lucide-react";
import { CatalogVehicleSelector } from "@/components/catalog-vehicle-selector";
import { formatMoney } from "@/lib/catalog";
import { productHref, productImage } from "@/lib/product-content";
import { listProducts } from "@/lib/queries/catalog";
import { listBrakePadCatalogProducts } from "@/lib/queries/brake-pad-catalog";
import { listOilFilterCatalogProducts } from "@/lib/queries/oil-filter-catalog";
import { listWiperSets } from "@/lib/queries/wiper-commerce";
import type { Product, WiperSet } from "@/lib/types";
import { getWiperSetPreviewImage } from "@/lib/wiper-product-images";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Shop All Auto Parts",
  description: "Browse current NexAutoParts products across wiper blades, brake pads, light bulbs, filters, batteries and suspension parts."
};

const filters = [
  ["All Products", "all"],
  ["Wiper Blades", "wipers"],
  ["Oil Filters", "filters"],
  ["Brake Pads", "brakes"],
  ["Light Bulbs", "bulbs"],
  ["Batteries", "batteries"],
  ["Control Arms", "suspension"]
] as const;

type ShopParams = { q?: string; category?: string; page?: string; sort?: string };
type CatalogItem = { id: string; kind: "wiper"; item: WiperSet } | { id: string; kind: "product"; item: Product };
type CatalogSort = "featured" | "price-asc" | "price-desc" | "name-asc";
const PAGE_SIZE = 12;

export default async function ShopPage({ searchParams }: { searchParams: Promise<ShopParams> }) {
  const params = await searchParams;
  const category = filters.some(([, value]) => value === params.category) ? params.category ?? "all" : "all";
  const query = params.q?.trim().toLowerCase() ?? "";
  const sort = readSort(params.sort);
  const { wiperSets, products, error } = await loadCatalog();
  const items = sortCatalogItems(buildCatalogItems(wiperSets, products, category, query), sort);
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const currentPage = Math.min(readPage(params.page), totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const visibleItems = items.slice(pageStart, pageStart + PAGE_SIZE);
  const activeCategoryLabel = filters.find(([, value]) => value === category)?.[0] ?? "All Products";
  const pageTitle = category === "all" ? "Shop all parts" : activeCategoryLabel;

  return (
    <main className="bg-[#F8FAFC]">
      <section className="border-b border-black/10 bg-ink text-white">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-7 sm:px-6 sm:py-8 lg:grid-cols-[1.08fr_0.92fr] lg:items-center lg:px-8">
          <div>
            <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-xs font-bold text-white/55">
              <Link href="/" className="hover:text-white">Home</Link>
              <span aria-hidden>/</span>
              {category === "all" ? (
                <span className="text-white/80">Shop</span>
              ) : (
                <>
                  <Link href="/shop" className="hover:text-white">Shop</Link>
                  <span aria-hidden>/</span>
                  <span className="text-white/80">{activeCategoryLabel}</span>
                </>
              )}
            </nav>
            <p className="mt-5 text-xs font-black uppercase tracking-[0.18em] text-signal">NexAutoParts catalogue</p>
            <h1 className="mt-2 text-4xl font-black sm:text-5xl">{pageTitle}</h1>
            <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-white/70 sm:text-base">
              {category === "all"
                ? "Browse every current product. Select a category from the main navigation or search the complete catalogue below."
                : `Browse all current ${activeCategoryLabel.toLowerCase()}. Vehicle-specific fitment can be checked from each product page.`}
            </p>
          </div>
          <CatalogVehicleSelector category={category} categoryLabel={activeCategoryLabel} />
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-4 py-7 sm:px-6 lg:px-8 lg:py-9">
        <section className="mb-6 flex flex-col gap-4 rounded-xl border border-black/10 bg-white p-4 shadow-sm sm:p-5 lg:flex-row lg:items-center lg:justify-between" aria-label="Product results tools">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.16em] text-signal">Product results</p>
            <p className="mt-1 text-sm font-bold text-steel">
              {items.length
                ? `Showing ${pageStart + 1}–${pageStart + visibleItems.length} of ${items.length} listings`
                : "0 current listings"}
            </p>
          </div>
          <form action="/shop" className="grid w-full gap-2 sm:grid-cols-[minmax(220px,1fr)_170px_auto] lg:max-w-3xl">
            {category !== "all" ? <input type="hidden" name="category" value={category} /> : null}
            <div className="flex h-11 min-w-0 items-center overflow-hidden rounded-lg border border-black/15 bg-white focus-within:border-ink">
              <Search className="ml-3 h-4 w-4 shrink-0 text-steel" aria-hidden />
              <input
                name="q"
                type="search"
                defaultValue={params.q ?? ""}
                aria-label={`Search within ${activeCategoryLabel}`}
                placeholder={`Search within ${activeCategoryLabel}`}
                className="h-full min-w-0 flex-1 px-3 text-sm font-semibold text-ink outline-none"
              />
            </div>
            <select name="sort" defaultValue={sort} aria-label="Sort products" className="h-11 rounded-lg border border-black/15 bg-white px-3 text-sm font-bold text-ink outline-none focus:border-ink">
              <option value="featured">Sort: Featured</option>
              <option value="price-asc">Price: Low to high</option>
              <option value="price-desc">Price: High to low</option>
              <option value="name-asc">Name: A–Z</option>
            </select>
            <button type="submit" className="h-11 shrink-0 rounded-lg bg-ink px-4 text-xs font-black uppercase tracking-[0.08em] text-white hover:bg-black">Apply</button>
          </form>
        </section>

        {error ? <p className="rounded-xl border border-signal/20 bg-white p-5 font-bold text-signal">{error}</p> : null}
        {items.length ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {visibleItems.map((item) => <CatalogCard key={`${item.kind}-${item.id}`} item={item} />)}
            </div>
            {totalPages > 1 ? (
              <Pagination
                category={category}
                currentPage={currentPage}
                query={params.q?.trim() ?? ""}
                sort={sort}
                totalPages={totalPages}
              />
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

async function loadCatalog() {
  try {
    const [wiperSets, databaseProducts] = await Promise.all([listWiperSets(), listProducts()]);
    const databaseCatalog = databaseProducts.filter((product) => !["filter", "brake-pad"].includes(product.category));
    const products = [...databaseCatalog, ...listBrakePadCatalogProducts(), ...listOilFilterCatalogProducts()];
    return { wiperSets, products, error: "" };
  } catch (error) {
    return { wiperSets: [] as WiperSet[], products: [] as Product[], error: error instanceof Error ? error.message : "Could not load products." };
  }
}

function buildCatalogItems(wiperSets: WiperSet[], products: Product[], category: string, query: string): CatalogItem[] {
  const sellableProducts = products.filter((product) => !["vehicle-fit-battery", "vehicle-fit-oil-filter"].includes(product.slug));
  const includeWipers = category === "all" || category === "wipers";
  const filteredProducts = sellableProducts.filter((product) => {
    if (category !== "all" && product.category !== databaseCategory(category)) return false;
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

function databaseCategory(category: string) {
  if (category === "wipers") return "wiper";
  if (category === "filters") return "filter";
  if (category === "brakes") return "brake-pad";
  if (category === "bulbs") return "bulb";
  if (category === "batteries") return "battery";
  if (category === "suspension") return "suspension";
  return "";
}

function matchesQuery(value: string, query: string) {
  return !query || value.toLowerCase().includes(query);
}

function readPage(value?: string) {
  const page = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

function readSort(value?: string): CatalogSort {
  return ["price-asc", "price-desc", "name-asc"].includes(value ?? "") ? value as CatalogSort : "featured";
}

function sortCatalogItems(items: CatalogItem[], sort: CatalogSort) {
  if (sort === "featured") return items;
  return [...items].sort((left, right) => {
    if (sort === "price-asc") return left.item.price - right.item.price;
    if (sort === "price-desc") return right.item.price - left.item.price;
    return catalogItemName(left).localeCompare(catalogItemName(right));
  });
}

function Pagination({
  category,
  currentPage,
  query,
  sort,
  totalPages
}: {
  category: string;
  currentPage: number;
  query: string;
  sort: CatalogSort;
  totalPages: number;
}) {
  const pages = paginationPages(currentPage, totalPages);

  return (
    <nav aria-label="Product catalogue pages" className="mt-8 flex flex-wrap items-center justify-center gap-2">
      <PageLink category={category} disabled={currentPage === 1} label="Previous" page={currentPage - 1} query={query} sort={sort} />
      {pages.map((page, index) => page === "ellipsis" ? (
        <span key={`ellipsis-${index}`} aria-hidden className="px-1 text-sm font-black text-steel">…</span>
      ) : (
        <Link
          key={page}
          href={shopHref(category, query, page, sort) as never}
          rel="nofollow"
          aria-current={page === currentPage ? "page" : undefined}
          className={`inline-flex h-10 min-w-10 items-center justify-center rounded-lg border px-3 text-sm font-black ${
            page === currentPage ? "border-ink bg-ink text-white" : "border-black/10 bg-white text-ink hover:border-black/30"
          }`}
        >
          {page}
        </Link>
      ))}
      <PageLink category={category} disabled={currentPage === totalPages} label="Next" page={currentPage + 1} query={query} sort={sort} />
    </nav>
  );
}

function PageLink({
  category,
  disabled,
  label,
  page,
  query,
  sort
}: {
  category: string;
  disabled: boolean;
  label: string;
  page: number;
  query: string;
  sort: CatalogSort;
}) {
  if (disabled) {
    return <span aria-disabled="true" className="inline-flex h-10 items-center rounded-lg border border-black/5 bg-black/[0.03] px-4 text-sm font-black text-steel/45">{label}</span>;
  }

  return <Link href={shopHref(category, query, page, sort) as never} rel="nofollow" className="inline-flex h-10 items-center rounded-lg border border-black/10 bg-white px-4 text-sm font-black text-ink hover:border-black/30">{label}</Link>;
}

function paginationPages(currentPage: number, totalPages: number): Array<number | "ellipsis"> {
  const candidates = new Set([1, totalPages, currentPage - 1, currentPage, currentPage + 1]);
  const pages = [...candidates].filter((page) => page >= 1 && page <= totalPages).sort((a, b) => a - b);
  const result: Array<number | "ellipsis"> = [];

  pages.forEach((page, index) => {
    if (index > 0 && page - pages[index - 1] > 1) result.push("ellipsis");
    result.push(page);
  });

  return result;
}

function shopHref(category: string, query: string, page: number, sort: CatalogSort) {
  const search = new URLSearchParams();
  if (category !== "all") search.set("category", category);
  if (query) search.set("q", query);
  if (sort !== "featured") search.set("sort", sort);
  if (page > 1) search.set("page", String(page));
  const suffix = search.toString();
  return suffix ? `/shop?${suffix}` : "/shop";
}

function CatalogCard({ item }: { item: CatalogItem }) {
  const isWiper = item.kind === "wiper";
  const image = isWiper ? getWiperSetPreviewImage(item.item) : productImage(item.item);
  const href = isWiper ? `/wipers/${item.item.sku}` : productHref(item.item);
  const name = catalogItemName(item);
  const eyebrow = isWiper ? `SKU ${item.item.sku}` : categoryLabel(item.item.category);
  return (
    <Link href={href as never} className="group overflow-hidden rounded-xl border border-black/10 bg-white shadow-sm hover:-translate-y-0.5 hover:shadow-panel">
      <div className="relative aspect-[4/3] bg-zinc-100"><Image src={image} alt={name} fill className="object-contain p-4 transition group-hover:scale-[1.03]" sizes="(min-width: 1280px) 25vw, (min-width: 640px) 50vw, 100vw" /></div>
      <div className="p-4"><p className="text-[11px] font-black uppercase tracking-[0.14em] text-signal">{eyebrow}</p><h3 className="mt-2 min-h-12 text-base font-black leading-6">{name}</h3><div className="mt-4 flex items-center justify-between"><span className="text-xl font-black">{formatMoney(item.item.price)}</span><span className="inline-flex items-center gap-2 text-sm font-black">View <ArrowRight className="h-4 w-4" /></span></div></div>
    </Link>
  );
}

function catalogItemName(item: CatalogItem) {
  return item.kind === "wiper" ? `Front Wiper Pair ${item.item.driverLengthIn}\" + ${item.item.passengerLengthIn}\"` : item.item.name;
}

function categoryLabel(category: string) {
  if (category === "wiper") return "Wiper Blades";
  if (category === "filter") return "Oil Filters";
  if (category === "brake-pad") return "Brake Pads";
  if (category === "bulb") return "Light Bulbs";
  if (category === "battery") return "Batteries";
  if (category === "suspension") return "Control Arms";
  return "Auto Parts";
}
