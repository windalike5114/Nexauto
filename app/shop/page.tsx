import Image from "next/image";
import Link from "next/link";
import { ArrowRight, SlidersHorizontal } from "lucide-react";
import { WiperFitmentFinder } from "@/components/wiper-fitment-finder";
import { formatMoney } from "@/lib/catalog";
import { listWiperSets } from "@/lib/queries/wiper-commerce";
import type { WiperSet } from "@/lib/types";
import { getWiperSetPreviewImage } from "@/lib/wiper-product-images";

export const dynamic = "force-dynamic";

type ShopSearchParams = {
  sort?: string;
  min?: string;
  max?: string;
  show?: string;
  page?: string;
};

export default async function ShopPage({ searchParams }: { searchParams: Promise<ShopSearchParams> }) {
  const params = await searchParams;
  const { wiperSets, error } = await loadShopData();
  const filteredWiperSets = applyShopFilters(wiperSets, params);
  const pageSize = getPageSize(params.show);
  const totalPages = Math.max(1, Math.ceil(filteredWiperSets.length / pageSize));
  const currentPage = clampPage(Number(params.page ?? 1), totalPages);
  const firstItemIndex = (currentPage - 1) * pageSize;
  const visibleWiperSets = filteredWiperSets.slice(firstItemIndex, firstItemIndex + pageSize);

  return (
    <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-8 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Parts catalog</p>
          <h1 className="mt-2 text-4xl font-black">All front pair SKU combinations</h1>
          <p className="mt-3 max-w-3xl text-sm font-bold leading-6 text-steel">
            These are the active wiper pair combinations generated from fitment data. Customers should search by vehicle first; this catalog stays available for manual checks and future parts expansion.
          </p>
        </div>
        <Link href="/" className="inline-flex h-11 items-center justify-center rounded border border-black/10 bg-white px-4 text-sm font-black text-ink hover:border-ink">
          Vehicle finder
        </Link>
      </div>

      {error ? <div className="mb-6 rounded-lg border border-signal/30 bg-white p-5 text-sm font-bold text-signal">{error}</div> : null}

      <div className="mb-8">
        <WiperFitmentFinder />
      </div>

      <div className="grid gap-8 lg:grid-cols-[280px_1fr]">
        <aside className="space-y-5">
          <section className="rounded-lg border border-black/10 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="h-5 w-5 text-signal" />
              <h2 className="font-black">SKU filters</h2>
            </div>
            <div className="mt-5 space-y-5">
              <FilterGroup title="Price">
                <div className="grid grid-cols-2 gap-2">
                  <SidebarLink href={buildShopHref(params, { min: "0", max: "60", page: undefined })} active={params.min === "0" && params.max === "60"} label="Under $60" />
                  <SidebarLink href={buildShopHref(params, { min: "60", max: "", page: undefined })} active={params.min === "60" && !params.max} label="$60+" />
                  <SidebarLink href={buildShopHref(params, { min: undefined, max: undefined, page: undefined })} active={!params.min && !params.max} label="Any price" />
                </div>
              </FilterGroup>

              <FilterGroup title="Per page">
                <div className="grid grid-cols-3 gap-2">
                  {[12, 24, 36].map((count) => (
                    <SidebarLink
                      key={count}
                      href={buildShopHref(params, { show: String(count), page: undefined })}
                      active={pageSize === count}
                      label={String(count)}
                    />
                  ))}
                </div>
              </FilterGroup>

              <FilterGroup title="How to use">
                <div className="space-y-3 text-sm font-bold leading-6 text-steel">
                  <p>1. Prefer vehicle search.</p>
                  <p>2. Use this list for manual SKU checks.</p>
                  <p>3. SKU format: WPFP + long blade + short blade.</p>
                </div>
              </FilterGroup>
            </div>
          </section>
        </aside>

        <section>
          <div className="mb-5 flex flex-col gap-3 rounded-lg border border-black/10 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2">
              <ControlLink href={buildShopHref(params, { sort: "length-asc", page: undefined })} active={(params.sort ?? "length-asc") === "length-asc"} label="Length" />
              <ControlLink href={buildShopHref(params, { sort: "price-asc", page: undefined })} active={params.sort === "price-asc"} label="Price low to high" />
              <ControlLink href={buildShopHref(params, { sort: "price-desc", page: undefined })} active={params.sort === "price-desc"} label="Price high to low" />
            </div>
            <p className="text-sm font-black text-steel">
              Showing {visibleWiperSets.length ? firstItemIndex + 1 : 0}-{firstItemIndex + visibleWiperSets.length} of {filteredWiperSets.length} SKUs
            </p>
          </div>

          {visibleWiperSets.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {visibleWiperSets.map((wiperSet) => (
                <WiperSetCard key={wiperSet.id} wiperSet={wiperSet} />
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-black/10 bg-white p-8 text-center font-bold text-steel">
              No active wiper pair SKUs match these filters.
            </div>
          )}

          {totalPages > 1 ? (
            <div className="mt-6 flex flex-col gap-3 rounded-lg border border-black/10 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm font-black text-steel">
                Page {currentPage} of {totalPages}
              </p>
              <div className="flex flex-wrap gap-2">
                <PaginationLink href={buildShopHref(params, { page: String(currentPage - 1) })} disabled={currentPage <= 1} label="Previous" />
                {getPaginationPages(currentPage, totalPages).map((page) => (
                  <ControlLink key={page} href={buildShopHref(params, { page: String(page) })} active={page === currentPage} label={String(page)} />
                ))}
                <PaginationLink href={buildShopHref(params, { page: String(currentPage + 1) })} disabled={currentPage >= totalPages} label="Next" />
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}

async function loadShopData() {
  try {
    const wiperSets = await listWiperSets();
    return { wiperSets, error: "" };
  } catch (error) {
    return {
      wiperSets: [],
      error: error instanceof Error ? error.message : "Could not load Supabase wiper SKU data."
    };
  }
}

function applyShopFilters(wiperSets: WiperSet[], params: ShopSearchParams) {
  const min = params.min ? Number(params.min) : null;
  const max = params.max ? Number(params.max) : null;
  const sorted = [...wiperSets].filter((wiperSet) => {
    if (min !== null && wiperSet.price < min) return false;
    if (max !== null && wiperSet.price > max) return false;
    return true;
  });

  if (params.sort === "price-asc") sorted.sort((a, b) => a.price - b.price);
  if (params.sort === "price-desc") sorted.sort((a, b) => b.price - a.price);
  if (!params.sort || params.sort === "length-asc") {
    sorted.sort((a, b) => a.driverLengthIn - b.driverLengthIn || a.passengerLengthIn - b.passengerLengthIn);
  }

  return sorted;
}

function WiperSetCard({ wiperSet }: { wiperSet: WiperSet }) {
  const image = getWiperSetPreviewImage(wiperSet);

  return (
    <article className="overflow-hidden rounded-lg border border-black/10 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-panel">
      <div className="relative aspect-[4/3] bg-zinc-50">
        <Image
          src={image}
          alt={`${wiperSet.name} preview`}
          fill
          className="object-contain p-5"
          sizes="(min-width: 1280px) 25vw, (min-width: 768px) 50vw, 100vw"
        />
      </div>
      <div className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-sm font-black text-signal">{wiperSet.sku}</p>
            <h2 className="mt-2 text-xl font-black">{wiperSet.name}</h2>
          </div>
          <p className="shrink-0 text-lg font-black">{formatMoney(wiperSet.price)}</p>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Spec label="Long blade" value={`${wiperSet.driverLengthIn}"`} />
          <Spec label="Short blade" value={`${wiperSet.passengerLengthIn}"`} />
        </div>
        <Link
          href={`/wipers/${wiperSet.sku}` as never}
          className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded bg-ink px-4 text-sm font-black text-white hover:bg-black"
        >
          View SKU
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </article>
  );
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-black/10 bg-zinc-50 p-3">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-steel">{label}</p>
      <p className="mt-1 text-2xl font-black">{value}</p>
    </div>
  );
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

function PaginationLink({ href, disabled, label }: { href: string; disabled: boolean; label: string }) {
  if (disabled) {
    return <span className="rounded bg-zinc-100 px-3 py-2 text-sm font-black text-steel/50">{label}</span>;
  }

  return <ControlLink href={href} active={false} label={label} />;
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-3 text-sm font-black uppercase tracking-[0.14em] text-steel">{title}</h3>
      {children}
    </div>
  );
}

function getPageSize(value: string | undefined) {
  const pageSize = Number(value ?? 24);
  return [12, 24, 36].includes(pageSize) ? pageSize : 24;
}

function clampPage(value: number, totalPages: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(Math.max(1, Math.floor(value)), totalPages);
}

function getPaginationPages(currentPage: number, totalPages: number) {
  const pages = new Set<number>([1, totalPages, currentPage - 1, currentPage, currentPage + 1]);
  return [...pages].filter((page) => page >= 1 && page <= totalPages).sort((a, b) => a - b);
}
