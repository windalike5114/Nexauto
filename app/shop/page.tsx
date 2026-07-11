import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { CheckCircle2, SlidersHorizontal } from "lucide-react";
import { WiperFitmentFinder } from "@/components/wiper-fitment-finder";
import { formatMoney } from "@/lib/catalog";
import { wiperPairPricing } from "@/lib/pricing";
import { listWiperSets } from "@/lib/queries/wiper-commerce";
import type { WiperSet } from "@/lib/types";
import { getWiperSetPreviewImage } from "@/lib/wiper-product-images";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Wiper Blades | Find the Right Wiper Blades for Your Vehicle",
  description:
    "Search by vehicle or browse available front windscreen wiper blade pair size combinations for New Zealand drivers."
};

type ShopSearchParams = {
  sort?: string;
  driver?: string;
  passenger?: string;
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
          <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Wiper Blades</p>
          <h1 className="mt-2 max-w-3xl text-4xl font-black leading-tight">Find the Right Wiper Blades for Your Vehicle</h1>
          <p className="mt-3 max-w-3xl text-sm font-bold leading-6 text-steel">
            Search by vehicle for the easiest way to find compatible front wiper blades, or browse available blade size combinations below.
          </p>
        </div>
        <Link href="#vehicle-finder" className="inline-flex h-12 items-center justify-center rounded-lg bg-signal px-5 text-sm font-black text-white shadow-lg shadow-red-900/15 transition hover:-translate-y-0.5 hover:bg-red-700">
          Find My Wipers
        </Link>
      </div>

      {error ? <div className="mb-6 rounded-lg border border-signal/30 bg-white p-5 text-sm font-bold text-signal">{error}</div> : null}

      <div id="vehicle-finder" className="mb-10 rounded-2xl bg-[#EEF5FB] p-3 shadow-panel ring-1 ring-black/5 sm:p-4">
        <WiperFitmentFinder
          directToProduct
          title="Find Wipers for Your Vehicle"
          description="Select your vehicle details to find the recommended front wiper blade sizes."
          directButtonLabel="Find Compatible Wipers"
          footnote="Vehicle details are used to identify the recommended blade size combination. Please review the fitment information before ordering."
        />
      </div>

      <div className="grid gap-8 lg:grid-cols-[280px_1fr]">
        <aside className="space-y-5">
          <section className="rounded-lg border border-black/10 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="h-5 w-5 text-signal" />
              <h2 className="font-black">Filter by Size</h2>
            </div>
            <form action="/shop" className="mt-5 space-y-5">
              <input type="hidden" name="sort" value={params.sort ?? "length-asc"} />
              <input type="hidden" name="show" value={String(pageSize)} />

              <FilterGroup title="Driver Blade Size">
                <select name="driver" defaultValue={params.driver ?? ""} className="h-12 w-full rounded border border-black/10 bg-white px-3 text-sm font-bold text-ink outline-none">
                  <option value="">Any Size</option>
                  {driverSizeOptions.map((size) => (
                    <option key={size} value={String(size)}>
                      {size}"
                    </option>
                  ))}
                </select>
              </FilterGroup>

              <FilterGroup title="Passenger Blade Size">
                <select name="passenger" defaultValue={params.passenger ?? ""} className="h-12 w-full rounded border border-black/10 bg-white px-3 text-sm font-bold text-ink outline-none">
                  <option value="">Any Size</option>
                  {passengerSizeOptions.map((size) => (
                    <option key={size} value={String(size)}>
                      {size}"
                    </option>
                  ))}
                </select>
              </FilterGroup>

              <div className="grid grid-cols-2 gap-2">
                <button type="submit" className="h-11 rounded bg-ink px-3 text-sm font-black text-white transition hover:-translate-y-0.5 hover:bg-black">
                  Apply Filters
                </button>
                <Link href="/shop" className="inline-flex h-11 items-center justify-center rounded border border-black/10 px-3 text-sm font-black text-steel transition hover:-translate-y-0.5 hover:border-ink hover:text-ink">
                  Clear Filters
                </Link>
              </div>

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
            </form>
          </section>
        </aside>

        <section>
          <div className="mb-5">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Browse Wiper Blade Sizes</p>
            <h2 className="mt-2 text-2xl font-black">Available Front Wiper Blade Pairs</h2>
            <p className="mt-2 max-w-2xl text-sm font-bold leading-6 text-steel">
              Already know the blade sizes you need? Browse available front wiper blade pairs below.
            </p>
          </div>

          <div className="mb-5 grid gap-2 rounded-lg border border-black/10 bg-[#F8FAFC] p-3 text-sm font-black text-ink shadow-sm sm:grid-cols-3">
            <ServicePill label="Free NZ Shipping" />
            <ServicePill label="12-Month Warranty" />
            <ServicePill label="Ships from Auckland" />
          </div>

          <div className="mb-5 flex flex-col gap-3 rounded-lg border border-black/10 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2">
              <ControlLink href={buildShopHref(params, { sort: "length-asc", page: undefined })} active={(params.sort ?? "length-asc") === "length-asc"} label="Size: Small to Large" />
              <ControlLink href={buildShopHref(params, { sort: "length-desc", page: undefined })} active={params.sort === "length-desc"} label="Size: Large to Small" />
            </div>
            <p className="text-sm font-black text-steel">
              Showing {visibleWiperSets.length ? firstItemIndex + 1 : 0}-{firstItemIndex + visibleWiperSets.length} of {filteredWiperSets.length} pairs
            </p>
          </div>

          {visibleWiperSets.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
              {visibleWiperSets.map((wiperSet) => (
                <WiperSetCard key={wiperSet.id} wiperSet={wiperSet} />
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-black/10 bg-white p-8 text-center font-bold text-steel">
              No wiper blade pairs match these filters.
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
  const driver = params.driver ? Number(params.driver) : null;
  const passenger = params.passenger ? Number(params.passenger) : null;
  const sorted = [...wiperSets].filter((wiperSet) => {
    if (driver !== null && wiperSet.driverLengthIn !== driver) return false;
    if (passenger !== null && wiperSet.passengerLengthIn !== passenger) return false;
    return true;
  });

  if (params.sort === "length-desc") {
    sorted.sort((a, b) => b.driverLengthIn - a.driverLengthIn || b.passengerLengthIn - a.passengerLengthIn);
  }
  if (!params.sort || params.sort === "length-asc") {
    sorted.sort((a, b) => a.driverLengthIn - b.driverLengthIn || a.passengerLengthIn - b.passengerLengthIn);
  }

  return sorted;
}

function WiperSetCard({ wiperSet }: { wiperSet: WiperSet }) {
  const image = getWiperSetPreviewImage(wiperSet);

  return (
    <article className="overflow-hidden rounded-[14px] border border-black/10 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-panel">
      <div className="relative aspect-[1/0.82] bg-zinc-50">
        <span className="absolute left-3 top-3 z-10 rounded bg-signal px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-white">
          Sale
        </span>
        <Image
          src={image}
          alt={`${wiperSet.name} preview`}
          fill
          className="object-contain p-4"
          sizes="(min-width: 1280px) 20vw, (min-width: 768px) 33vw, 50vw"
        />
      </div>
      <div className="space-y-3 p-3 sm:p-4">
        <div>
          <h2 className="text-sm font-black leading-snug text-ink sm:text-base">
            <span className="hidden sm:inline">Front Wiper Blade Pair</span>
            <span className="sm:hidden">Front Wiper Pair</span>
          </h2>
          <p className="mt-2 text-sm font-black leading-5 text-steel sm:text-[15px]">
            <span className="hidden sm:inline">
              Driver {wiperSet.driverLengthIn}" + Passenger {wiperSet.passengerLengthIn}"
            </span>
            <span className="sm:hidden">
              {wiperSet.driverLengthIn}" + {wiperSet.passengerLengthIn}"
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-lg font-black text-ink">{formatMoney(wiperSet.price)}</span>
          <span className="text-xs font-bold text-steel line-through">{formatMoney(wiperSet.compareAtPrice ?? wiperPairPricing.compareAtPrice)}</span>
        </div>

        <p className="hidden text-xs font-black text-steel sm:block">Free NZ Shipping</p>

        <Link
          href={`/wipers/${wiperSet.sku}` as never}
          className="inline-flex h-[42px] w-full items-center justify-center rounded bg-ink px-3 text-sm font-black text-white hover:bg-black"
        >
          View Details
        </Link>
      </div>
    </article>
  );
}

function ServicePill({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded bg-white px-3 py-2">
      <CheckCircle2 className="h-4 w-4 text-signal" />
      <span>{label}</span>
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

const driverSizeOptions = [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28];
const passengerSizeOptions = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];
