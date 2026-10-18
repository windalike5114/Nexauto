import Image from "next/image";
import Link from "next/link";
import { CarFront, Search, UserRound } from "lucide-react";
import { CartLink } from "@/components/cart-link";
import { blobMediaAssets } from "@/lib/blob-media-assets";

const categoryLinks = [
  ["Wiper Blades", "/parts/wipers"],
  ["Oil Filters", "/parts/filters"],
  ["Light Bulbs", "/parts/bulbs"],
  ["Batteries", "/parts/batteries"],
  ["Control Arms", "/parts/suspension"],
  ["Weekly Deals", "/specials"]
] as const;

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-black/10 bg-white/95 shadow-sm backdrop-blur">
      <div className="bg-ink text-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-2 text-[11px] font-black sm:px-6 lg:px-8">
          <Link href="/shipping" className="truncate hover:text-white/80">Fast NZ-wide dispatch from Auckland</Link>
          <Link href="/specials" className="shrink-0 uppercase tracking-[0.12em] text-white hover:text-signal">Weekly Deals · Shop Now</Link>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 lg:px-8">
        <div className="grid grid-cols-[1fr_auto] items-center gap-3 lg:grid-cols-[240px_minmax(280px,1fr)_auto]">
          <Link href="/" className="flex items-center" aria-label="NexAutoParts home">
            <Image src={blobMediaAssets.brand.circleIcon} alt="" width={42} height={42} className="h-10 w-10 rounded-full object-contain sm:hidden" priority />
            <Image src={blobMediaAssets.brand.mainLogo} alt="NexAutoParts" width={240} height={48} className="hidden h-9 w-auto object-contain sm:block" priority />
          </Link>

          <SearchForm className="hidden lg:flex" />

          <div className="flex items-center justify-end gap-1 text-xs font-black text-ink sm:gap-2 sm:text-sm">
            <Link href="/#vehicle-finder" className="inline-flex h-10 items-center gap-2 rounded-lg px-2 hover:bg-black/5 sm:px-3">
              <CarFront className="h-4 w-4 text-signal" />
              <span className="hidden sm:inline">My Vehicle</span>
            </Link>
            <Link href="/account" className="inline-flex h-10 items-center gap-2 rounded-lg px-2 hover:bg-black/5 sm:px-3">
              <UserRound className="h-4 w-4" />
              <span className="hidden md:inline">Account</span>
            </Link>
            <CartLink />
          </div>
        </div>
        <SearchForm className="mt-3 flex lg:hidden" />
      </div>

      <nav className="border-t border-black/10 bg-[#F8FAFC]" aria-label="Product categories">
        <div className="mx-auto flex max-w-7xl items-center gap-1 overflow-x-auto px-3 py-1.5 sm:px-5 lg:px-7">
          {categoryLinks.map(([label, href]) => (
            <Link key={href} href={href} className="shrink-0 rounded-md px-3 py-2 text-xs font-black text-ink transition hover:bg-white hover:text-signal sm:text-sm">
              {label}
            </Link>
          ))}
          <Link href="/contact" className="ml-auto shrink-0 rounded-md px-3 py-2 text-xs font-black text-steel hover:bg-white hover:text-ink sm:text-sm">
            Contact
          </Link>
        </div>
      </nav>
    </header>
  );
}

function SearchForm({ className }: { className: string }) {
  return (
    <form action="/shop" className={`${className} h-11 min-w-0 items-center overflow-hidden rounded-lg border border-black/15 bg-white shadow-sm focus-within:border-ink`}>
      <Search className="ml-3 h-4 w-4 shrink-0 text-steel" />
      <input name="q" type="search" aria-label="Search products" placeholder="Search products, part names or SKUs" className="h-full min-w-0 flex-1 border-0 bg-transparent px-3 text-sm font-semibold text-ink outline-none" />
      <button type="submit" className="h-full shrink-0 bg-ink px-4 text-xs font-black uppercase tracking-[0.1em] text-white hover:bg-black">Search</button>
    </form>
  );
}
