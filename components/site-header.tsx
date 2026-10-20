"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CarFront, Menu, Search, UserRound, X } from "lucide-react";
import { CartLink } from "@/components/cart-link";
import { blobMediaAssets } from "@/lib/blob-media-assets";
import {
  parseVehicleContext,
  vehicleContextChangedEvent,
  vehicleContextStorageKey,
  type VehicleContext
} from "@/lib/vehicle-context";
import { partsTabRequestedEvent } from "@/lib/parts-navigation";

const categoryLinks = [
  ["Wiper Blades", "/parts?category=wipers"],
  ["Oil Filters", "/parts?category=filters"],
  ["Brake Pads", "/parts?category=brakes"],
  ["Light Bulbs", "/parts?category=bulbs"],
  ["Batteries", "/parts?category=batteries"],
  ["Control Arms", "/parts?category=suspension"],
  ["Weekly Deals", "/specials"]
] as const;

export function SiteHeader() {
  const headerRef = useRef<HTMLElement>(null);
  const expandedHeightRef = useRef(0);
  const fixedRef = useRef(false);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [isFixed, setIsFixed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [vehicle, setVehicle] = useState<VehicleContext | null>(null);

  useEffect(() => {
    const syncVehicle = () => setVehicle(parseVehicleContext(window.localStorage.getItem(vehicleContextStorageKey)));
    const onStorage = (event: StorageEvent) => {
      if (event.key === vehicleContextStorageKey) syncVehicle();
    };

    syncVehicle();
    window.addEventListener("storage", onStorage);
    window.addEventListener(vehicleContextChangedEvent, syncVehicle);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(vehicleContextChangedEvent, syncVehicle);
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;

    expandedHeightRef.current = header.offsetHeight;
    let frame = 0;
    const measure = () => {
      if (fixedRef.current) return;
      expandedHeightRef.current = header.offsetHeight;
      setHeaderHeight(expandedHeightRef.current);
    };
    const update = () => {
      frame = 0;
      const nextFixed = window.scrollY > expandedHeightRef.current;
      fixedRef.current = nextFixed;
      setIsFixed(nextFixed);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    measure();
    update();
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  const vehicleLabel = vehicle ? [vehicle.year, vehicle.make, vehicle.model, vehicle.chassis].filter(Boolean).join(" ") : "";

  function handleCategoryNavigation(event: React.MouseEvent<HTMLAnchorElement>, href: string) {
    if (window.location.pathname !== "/parts" || !href.startsWith("/parts?category=")) return;
    event.preventDefault();
    const category = new URL(href, window.location.origin).searchParams.get("category");
    window.dispatchEvent(new CustomEvent(partsTabRequestedEvent, { detail: category }));
  }

  return (
    <div style={isFixed ? { height: headerHeight } : undefined}>
    <header ref={headerRef} className={`${isFixed ? "header-return fixed inset-x-0 top-0" : "relative"} z-30 border-b border-black/10 bg-white/95 shadow-sm backdrop-blur`}>
      <div className={`${isFixed ? "hidden lg:block" : "block"} bg-ink text-white`}>
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-1.5 text-[10px] font-black sm:px-6 lg:px-8 lg:py-2 lg:text-[11px]">
          <Link href="/shipping" className="truncate hover:text-white/80">Fast NZ-wide dispatch from Auckland</Link>
          <Link href="/specials" className="shrink-0 uppercase tracking-[0.12em] text-white hover:text-signal">Weekly Deals · Shop Now</Link>
        </div>
      </div>

      <div className="relative mx-auto max-w-7xl px-4 py-2 sm:px-6 lg:px-8 lg:py-3">
        <div className="flex h-10 items-center gap-2 lg:hidden">
          <button
            type="button"
            aria-expanded={menuOpen}
            aria-controls="mobile-site-menu"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            onClick={() => setMenuOpen((open) => !open)}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-black/10 text-ink hover:bg-black/5"
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>

          <Link href="/" className="flex min-w-0 items-center" aria-label="NexAutoParts home">
            <Image src={blobMediaAssets.brand.mainLogo} alt="NexAutoParts" width={180} height={36} className="h-7 w-auto max-w-[138px] object-contain" priority />
          </Link>

          <div className="ml-auto"><CartLink /></div>
        </div>

        {menuOpen ? <nav id="mobile-site-menu" aria-label="Mobile menu" className="absolute left-4 right-4 top-[58px] z-50 grid gap-1 rounded-xl border border-black/10 bg-white p-2 shadow-panel lg:hidden">
          <Link href="/parts#change-vehicle" onClick={() => setMenuOpen(false)} className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-black hover:bg-[#F3F5F7]"><CarFront className="h-4 w-4 text-signal" /> My Vehicle</Link>
          <Link href="/account" onClick={() => setMenuOpen(false)} className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-black hover:bg-[#F3F5F7]"><UserRound className="h-4 w-4" /> Account</Link>
          <Link href="/contact" onClick={() => setMenuOpen(false)} className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-black hover:bg-[#F3F5F7]">Contact & Fitment Help</Link>
          <Link href="/shipping" onClick={() => setMenuOpen(false)} className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-black hover:bg-[#F3F5F7]">Shipping Information</Link>
        </nav> : null}

        <div className="hidden grid-cols-[240px_minmax(280px,1fr)_auto] items-center gap-3 lg:grid">
          <Link href="/" className="flex items-center" aria-label="NexAutoParts home">
            <Image src={blobMediaAssets.brand.mainLogo} alt="NexAutoParts" width={240} height={48} className="h-9 w-auto object-contain" priority />
          </Link>

          <SearchForm className="flex" />

          <div className="flex items-center justify-end gap-1 text-xs font-black text-ink sm:gap-2 sm:text-sm">
            <Link href="/parts#change-vehicle" className="inline-flex h-10 items-center gap-2 rounded-lg px-2 hover:bg-black/5 sm:px-3">
              <CarFront className="h-4 w-4 text-signal" />
              <span className="hidden max-w-[220px] truncate sm:inline">{vehicle ? vehicleLabel : "My Vehicle"}</span>
            </Link>
            <Link href="/account" className="inline-flex h-10 items-center gap-2 rounded-lg px-2 hover:bg-black/5 sm:px-3">
              <UserRound className="h-4 w-4" />
              <span className="hidden md:inline">Account</span>
            </Link>
            <CartLink />
          </div>
        </div>

        {!vehicle ? <SearchForm className={`${isFixed ? "hidden" : "mt-2 flex"} lg:hidden`} compact /> : null}
      </div>

      <nav className="border-t border-black/10 bg-[#F8FAFC]" aria-label="Product categories">
        <div className="mx-auto flex max-w-7xl items-center gap-0.5 overflow-x-auto px-2 py-0.5 sm:px-5 lg:gap-1 lg:px-7 lg:py-1.5">
          {categoryLinks.map(([label, href]) => (
            <Link key={href} href={href} onClick={(event) => handleCategoryNavigation(event, href)} className="shrink-0 rounded-md px-2.5 py-1.5 text-[11px] font-black text-ink transition hover:bg-white hover:text-signal sm:text-sm lg:px-3 lg:py-2">
              {label}
            </Link>
          ))}
          <Link href="/contact" className="ml-auto shrink-0 rounded-md px-2.5 py-1.5 text-[11px] font-black text-steel hover:bg-white hover:text-ink sm:text-sm lg:px-3 lg:py-2">
            Contact
          </Link>
        </div>
      </nav>
    </header>
    </div>
  );
}

function SearchForm({ className, compact = false }: { className: string; compact?: boolean }) {
  return (
    <form action="/shop" className={`${className} ${compact ? "h-10" : "h-11"} min-w-0 items-center overflow-hidden rounded-lg border border-black/15 bg-white shadow-sm focus-within:border-ink`}>
      <Search className="ml-3 h-4 w-4 shrink-0 text-steel" />
      <input name="q" type="search" aria-label="Search products" placeholder="Search products, part names or SKUs" className="h-full min-w-0 flex-1 border-0 bg-transparent px-3 text-sm font-semibold text-ink outline-none" />
      <button type="submit" className="h-full shrink-0 bg-ink px-4 text-xs font-black uppercase tracking-[0.1em] text-white hover:bg-black">Search</button>
    </form>
  );
}
