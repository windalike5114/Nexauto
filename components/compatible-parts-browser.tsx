"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, SearchX, ShieldCheck, Truck } from "lucide-react";
import { CompatibleProductCard, CompatibleWiperCard, WiperReviewDemoCard } from "@/components/compatible-part-card";
import type { Product, WiperSet } from "@/lib/types";
import type { WiperReviewDemo } from "@/lib/wiper-review-demo";
import { partsTabRequestedEvent } from "@/lib/parts-navigation";

const tabs = [
  { key: "all", label: "All Parts" },
  { key: "wipers", label: "Wipers" },
  { key: "batteries", label: "Batteries" },
  { key: "filters", label: "Filters" },
  { key: "brakes", label: "Brake Pads" },
  { key: "bulbs", label: "Bulbs" },
  { key: "suspension", label: "Suspension" }
] as const;

export type CompatiblePartsTab = (typeof tabs)[number]["key"];

type Props = {
  products: Product[];
  wiperSet: WiperSet | null;
  wiperHref: string;
  rearLengthIn: number | null;
  reviewDemo: WiperReviewDemo | null;
  initialTab: CompatiblePartsTab;
  vehicleLabel: string;
  error: string;
};

export function CompatiblePartsBrowser({ products, wiperSet, wiperHref, rearLengthIn, reviewDemo, initialTab, vehicleLabel, error }: Props) {
  const [activeTab, setActiveTab] = useState<CompatiblePartsTab>(initialTab);
  const counts = useMemo(() => countByTab(products, wiperSet), [products, wiperSet]);
  const visibleProducts = activeTab === "all" ? products : products.filter((product) => product.category === databaseCategory(activeTab));
  const showConfirmedWiper = Boolean(wiperSet && (activeTab === "all" || activeTab === "wipers"));
  const showReviewDemo = Boolean(reviewDemo && !wiperSet && (activeTab === "all" || activeTab === "wipers"));
  const confirmedCount = visibleProducts.length + (showConfirmedWiper ? 1 : 0);

  useEffect(() => setActiveTab(initialTab), [initialTab]);

  useEffect(() => {
    const handleHistory = () => setActiveTab(readTabFromUrl());
    const handleHeaderTab = (event: Event) => {
      const requestedTab = (event as CustomEvent<string>).detail;
      if (isTabKey(requestedTab)) selectTab(requestedTab);
    };
    window.addEventListener("popstate", handleHistory);
    window.addEventListener(partsTabRequestedEvent, handleHeaderTab);
    return () => {
      window.removeEventListener("popstate", handleHistory);
      window.removeEventListener(partsTabRequestedEvent, handleHeaderTab);
    };
  }, []);

  function selectTab(tab: CompatiblePartsTab) {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    if (tab === "all") url.searchParams.delete("category");
    else url.searchParams.set("category", tab);
    window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  return (
    <>
      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8 lg:py-12">
        {error ? <div className="mb-6 rounded-xl border border-signal/25 bg-red-50 p-4 text-sm font-bold text-signal">{error}</div> : null}

        <div className="grid gap-2 rounded-xl border border-black/10 bg-white p-3 text-xs font-black shadow-sm min-[480px]:grid-cols-3 sm:text-sm">
          <ServicePill icon={<CheckCircle2 className="h-4 w-4" />} label="Fitment status clearly labelled" />
          <ServicePill icon={<Truck className="h-4 w-4" />} label="NZ-wide delivery" />
          <ServicePill icon={<ShieldCheck className="h-4 w-4" />} label="Fitment support" />
        </div>

        <div className="mt-7 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-signal">{tabs.find((tab) => tab.key === activeTab)?.label}</p>
            <h2 className="mt-2 text-2xl font-black sm:text-3xl">Compatible products</h2>
          </div>
          <p className="text-sm font-bold text-steel">
            {counts[activeTab]} confirmed listing{counts[activeTab] === 1 ? "" : "s"}
            {showReviewDemo ? " · 1 high-confidence review recommendation" : ""}
          </p>
        </div>

        {confirmedCount || showReviewDemo ? (
          <div className="mt-6 grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" role="tabpanel">
            {showConfirmedWiper && wiperSet ? <CompatibleWiperCard wiperSet={wiperSet} href={wiperHref} rearLengthIn={rearLengthIn} /> : null}
            {showReviewDemo && reviewDemo ? <WiperReviewDemoCard review={reviewDemo} helpHref={buildHelpHref(vehicleLabel)} /> : null}
            {visibleProducts.map((product) => <CompatibleProductCard key={product.id} product={product} />)}
          </div>
        ) : (
          <div className="mt-6 rounded-2xl border border-black/10 bg-white p-7 shadow-sm" role="tabpanel">
            <SearchX className="h-8 w-8 text-signal" />
            <h3 className="mt-4 text-2xl font-black">No confirmed {activeTab === "all" ? "parts" : tabs.find((tab) => tab.key === activeTab)?.label.toLowerCase()} yet</h3>
            <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-steel">We will not show a generic product as compatible without a published fitment relationship. Send us the chassis, engine or existing part number and we can review the missing match.</p>
            <Link href={buildHelpHref(vehicleLabel) as never} className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-signal px-5 text-sm font-black text-white hover:bg-red-700">Request fitment help <ArrowRight className="h-4 w-4" /></Link>
          </div>
        )}
      </section>
    </>
  );
}

function countByTab(products: Product[], wiperSet: WiperSet | null): Record<CompatiblePartsTab, number> {
  const counts: Record<CompatiblePartsTab, number> = { all: wiperSet ? 1 : 0, wipers: wiperSet ? 1 : 0, batteries: 0, filters: 0, brakes: 0, bulbs: 0, suspension: 0 };
  for (const product of products) {
    const tab = tabForDatabaseCategory(product.category);
    if (tab) counts[tab] += 1;
    counts.all += 1;
  }
  return counts;
}

function databaseCategory(tab: CompatiblePartsTab) {
  if (tab === "batteries") return "battery";
  if (tab === "filters") return "filter";
  if (tab === "brakes") return "brake-pad";
  if (tab === "bulbs") return "bulb";
  if (tab === "suspension") return "suspension";
  return "";
}

function tabForDatabaseCategory(category: string): Exclude<CompatiblePartsTab, "all" | "wipers"> | null {
  if (category === "battery") return "batteries";
  if (category === "filter") return "filters";
  if (category === "brake-pad") return "brakes";
  if (category === "bulb") return "bulbs";
  if (category === "suspension") return "suspension";
  return null;
}

function readTabFromUrl(): CompatiblePartsTab {
  const category = new URL(window.location.href).searchParams.get("category");
  return tabs.some((tab) => tab.key === category) ? category as CompatiblePartsTab : "all";
}

function isTabKey(value: string): value is CompatiblePartsTab {
  return tabs.some((tab) => tab.key === value);
}

function buildHelpHref(vehicle: string) {
  const query = new URLSearchParams({ category: "Vehicle parts" });
  if (vehicle) query.set("vehicle", vehicle);
  return `/contact?${query}`;
}

function ServicePill({ icon, label }: { icon: React.ReactNode; label: string }) {
  return <div className="flex items-center gap-2 rounded-lg bg-[#F8FAFC] px-3 py-2.5 text-ink"><span className="text-signal">{icon}</span>{label}</div>;
}
