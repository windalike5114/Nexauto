import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CarFront, CheckCircle2, SearchX, ShieldCheck, Truck } from "lucide-react";
import { CompatibleProductCard, CompatibleWiperCard } from "@/components/compatible-part-card";
import { VehicleContextSynchronizer } from "@/components/vehicle-context-synchronizer";
import { VehiclePartsFinder } from "@/components/vehicle-parts-finder";
import { listAllProductsForVehicle } from "@/lib/queries/vehicle-product-fitment";
import { getWiperSetByLengths } from "@/lib/queries/wiper-commerce";
import { findWiperLengthFitments, type WiperFitmentResult } from "@/lib/queries/wiper-fitment";
import { readStoredVehicleContext } from "@/lib/server/vehicle-context";
import type { Product, WiperSet } from "@/lib/types";
import type { VehicleContext } from "@/lib/vehicle-context";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Parts for Your Vehicle",
  description: "Select your vehicle once, then browse every confirmed compatible part by category."
};

const tabs = [
  { key: "all", label: "All Parts" },
  { key: "wipers", label: "Wipers" },
  { key: "batteries", label: "Batteries" },
  { key: "filters", label: "Filters" },
  { key: "bulbs", label: "Bulbs" },
  { key: "suspension", label: "Suspension" }
] as const;

type TabKey = (typeof tabs)[number]["key"];
type PartsSearchParams = {
  category?: string;
  makeId?: string;
  modelId?: string;
  year?: string;
  make?: string;
  model?: string;
  applicationId?: string;
  generationId?: string;
  variantId?: string;
  chassis?: string;
  body?: string;
  engine?: string;
};

type VehicleSelection = { makeId: string; modelId: string; year: number; applicationId: string };
type CompatibleParts = { products: Product[]; wiperSet: WiperSet | null; wiperFitment: WiperFitmentResult | null; error: string };

export default async function VehiclePartsPage({ searchParams }: { searchParams: Promise<PartsSearchParams> }) {
  const [queryVehicle, storedVehicle] = await Promise.all([searchParams, readStoredVehicleContext()]);
  const vehicle = parseVehicleSelection(queryVehicle) ? queryVehicle : toPartsSearchParams(storedVehicle);
  const selection = parseVehicleSelection(vehicle);
  const synchronizedVehicle = toExactVehicleContext(vehicle);
  const compatible = selection ? await loadCompatibleParts(selection) : emptyCompatibleParts();
  const products = compatible.products.filter((product) => !["vehicle-fit-battery", "vehicle-fit-oil-filter"].includes(product.slug));
  const activeTab = isTabKey(queryVehicle.category) ? queryVehicle.category : "all";
  const counts = countByTab(products, compatible.wiperSet);
  const visibleProducts = activeTab === "all" ? products : products.filter((product) => product.category === databaseCategory(activeTab));
  const showWiper = Boolean(compatible.wiperSet && (activeTab === "all" || activeTab === "wipers"));
  const visibleCount = visibleProducts.length + (showWiper ? 1 : 0);
  const vehicleLabel = [vehicle.year, vehicle.make, vehicle.model, vehicle.chassis].filter(Boolean).join(" ");
  const vehicleDetail = [vehicle.body, vehicle.engine].filter(Boolean).join(" · ");
  const wiperHref = compatible.wiperSet && compatible.wiperFitment
    ? buildWiperHref(compatible.wiperSet, compatible.wiperFitment, vehicle)
    : "";

  return (
    <main className="min-h-screen bg-[#F5F7F9] text-ink">
      {synchronizedVehicle ? <VehicleContextSynchronizer vehicle={synchronizedVehicle} /> : null}

      <section className="bg-ink text-white">
        <div className="mx-auto max-w-7xl px-4 py-9 sm:px-6 sm:py-12 lg:px-8">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-signal">Vehicle fitment</p>
          <h1 className="mt-2 max-w-3xl text-3xl font-black leading-tight sm:text-4xl lg:text-5xl">
            {vehicleLabel ? `Parts for ${vehicleLabel}` : "Find parts that fit your vehicle"}
          </h1>
          <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-white/70 sm:text-base">
            Select your vehicle once. Browse every confirmed match, then use the category tabs to narrow the results.
          </p>
        </div>
      </section>

      <section id="change-vehicle" className="scroll-mt-40 border-b border-black/10 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
          {vehicleLabel ? (
            <div className="rounded-xl border border-emerald-700/20 bg-emerald-50 p-4">
              <div className="flex min-w-0 items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-emerald-700 text-white"><CarFront className="h-5 w-5" /></span>
                <div className="min-w-0">
                  <p className="text-[11px] font-black uppercase tracking-[0.14em] text-emerald-700">Selected vehicle</p>
                  <h2 className="mt-1 text-lg font-black sm:text-xl">{vehicleLabel}</h2>
                  {vehicleDetail ? <p className="mt-1 text-xs font-bold leading-5 text-steel sm:text-sm">{vehicleDetail}</p> : null}
                </div>
              </div>
              <details className="group mt-4 border-t border-emerald-700/15 pt-4">
                <summary className="inline-flex h-10 cursor-pointer list-none items-center justify-center rounded-lg border border-emerald-700/20 bg-white px-4 text-sm font-black marker:hidden hover:border-emerald-700/50">Change vehicle</summary>
                <div className="mt-4 text-left"><VehiclePartsFinder /></div>
              </details>
            </div>
          ) : (
            <VehiclePartsFinder />
          )}
        </div>
      </section>

      <section className="border-b border-black/10 bg-white" aria-label="Part category filters">
        <div className="mx-auto max-w-7xl overflow-x-auto px-2 sm:px-6 lg:px-8">
          <nav className="flex min-w-max items-end gap-1 pt-2">
            {tabs.map((tab) => {
              const active = tab.key === activeTab;
              return (
                <Link
                  key={tab.key}
                  href={buildPartsHref(vehicle, tab.key) as never}
                  aria-current={active ? "page" : undefined}
                  className={`border-b-4 px-4 py-3 text-sm font-black transition ${active ? "border-signal text-ink" : "border-transparent text-steel hover:border-black/15 hover:text-ink"}`}
                >
                  {tab.label} <span className={`ml-1 rounded-full px-2 py-0.5 text-[11px] ${active ? "bg-signal text-white" : "bg-zinc-100 text-steel"}`}>{counts[tab.key]}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8 lg:py-12">
        {compatible.error ? <div className="mb-6 rounded-xl border border-signal/25 bg-red-50 p-4 text-sm font-bold text-signal">{compatible.error}</div> : null}

        {selection ? (
          <>
            <div className="grid gap-2 rounded-xl border border-black/10 bg-white p-3 text-xs font-black shadow-sm min-[480px]:grid-cols-3 sm:text-sm">
              <ServicePill icon={<CheckCircle2 className="h-4 w-4" />} label="Confirmed fitment only" />
              <ServicePill icon={<Truck className="h-4 w-4" />} label="NZ-wide delivery" />
              <ServicePill icon={<ShieldCheck className="h-4 w-4" />} label="Fitment support" />
            </div>

            <div className="mt-7 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-signal">{tabs.find((tab) => tab.key === activeTab)?.label}</p>
                <h2 className="mt-2 text-2xl font-black sm:text-3xl">Compatible products</h2>
              </div>
              <p className="text-sm font-bold text-steel">{visibleCount} confirmed listing{visibleCount === 1 ? "" : "s"}</p>
            </div>

            {visibleCount ? (
              <div className="mt-6 grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {showWiper && compatible.wiperSet && compatible.wiperFitment ? (
                  <CompatibleWiperCard wiperSet={compatible.wiperSet} href={wiperHref} rearLengthIn={compatible.wiperFitment.rearLengthIn} />
                ) : null}
                {visibleProducts.map((product) => <CompatibleProductCard key={product.id} product={product} />)}
              </div>
            ) : (
              <div className="mt-6 rounded-2xl border border-black/10 bg-white p-7 shadow-sm">
                <SearchX className="h-8 w-8 text-signal" />
                <h3 className="mt-4 text-2xl font-black">No confirmed {activeTab === "all" ? "parts" : tabs.find((tab) => tab.key === activeTab)?.label.toLowerCase()} yet</h3>
                <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-steel">We will not show a generic product as compatible without a published fitment relationship. Send us the chassis, engine or existing part number and we can review the missing match.</p>
                <Link href={buildHelpHref(vehicleLabel) as never} className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-signal px-5 text-sm font-black text-white hover:bg-red-700">Request fitment help <ArrowRight className="h-4 w-4" /></Link>
              </div>
            )}
          </>
        ) : (
          <div className="rounded-2xl border border-black/10 bg-white p-7 text-center shadow-sm">
            <CarFront className="mx-auto h-9 w-9 text-signal" />
            <h2 className="mt-4 text-2xl font-black">Choose a vehicle to see compatible products</h2>
            <p className="mx-auto mt-3 max-w-xl text-sm font-semibold leading-6 text-steel">Your selection will stay active while you switch between product categories.</p>
            <Link href="#change-vehicle" className="mt-5 inline-flex h-11 items-center justify-center rounded-lg bg-ink px-5 text-sm font-black text-white">Choose vehicle</Link>
          </div>
        )}
      </section>
    </main>
  );
}

async function loadCompatibleParts(selection: VehicleSelection): Promise<CompatibleParts> {
  try {
    const [products, wiperFitments] = await Promise.all([
      listAllProductsForVehicle(selection),
      findWiperLengthFitments(selection.makeId, selection.modelId, selection.year, {
        applicationId: selection.applicationId,
        applicationKind: "canonical"
      })
    ]);
    const wiperFitment = wiperFitments[0] ?? null;
    const wiperSet = wiperFitment?.driverLengthIn && wiperFitment.passengerLengthIn
      ? await getWiperSetByLengths(wiperFitment.driverLengthIn, wiperFitment.passengerLengthIn)
      : null;
    return { products, wiperSet, wiperFitment, error: "" };
  } catch (error) {
    return { ...emptyCompatibleParts(), error: error instanceof Error ? error.message : "Could not load compatible parts." };
  }
}

function emptyCompatibleParts(): CompatibleParts {
  return { products: [], wiperSet: null, wiperFitment: null, error: "" };
}

function parseVehicleSelection(vehicle: PartsSearchParams): VehicleSelection | null {
  const year = Number(vehicle.year);
  if (!vehicle.makeId || !vehicle.modelId || !vehicle.applicationId || !Number.isInteger(year)) return null;
  return { makeId: vehicle.makeId, modelId: vehicle.modelId, applicationId: vehicle.applicationId, year };
}

function toPartsSearchParams(vehicle: VehicleContext | null): PartsSearchParams {
  if (!vehicle) return {};
  return {
    makeId: vehicle.makeId,
    modelId: vehicle.modelId,
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    applicationId: vehicle.applicationId,
    generationId: vehicle.generationId,
    variantId: vehicle.variantId,
    chassis: vehicle.chassis,
    body: vehicle.bodyConfiguration,
    engine: vehicle.engine
  };
}

function toExactVehicleContext(vehicle: PartsSearchParams): VehicleContext | null {
  if (!vehicle.makeId || !vehicle.modelId || !vehicle.year || !vehicle.make || !vehicle.model || !vehicle.applicationId) return null;
  return {
    makeId: vehicle.makeId,
    modelId: vehicle.modelId,
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    applicationId: vehicle.applicationId,
    generationId: vehicle.generationId,
    variantId: vehicle.variantId,
    chassis: vehicle.chassis,
    bodyConfiguration: vehicle.body,
    engine: vehicle.engine
  };
}

function countByTab(products: Product[], wiperSet: WiperSet | null): Record<TabKey, number> {
  const counts: Record<TabKey, number> = { all: wiperSet ? 1 : 0, wipers: wiperSet ? 1 : 0, batteries: 0, filters: 0, bulbs: 0, suspension: 0 };
  for (const product of products) {
    const tab = tabForDatabaseCategory(product.category);
    if (tab) counts[tab] += 1;
    counts.all += 1;
  }
  return counts;
}

function databaseCategory(tab: TabKey) {
  if (tab === "batteries") return "battery";
  if (tab === "filters") return "filter";
  if (tab === "bulbs") return "bulb";
  if (tab === "suspension") return "suspension";
  return "";
}

function tabForDatabaseCategory(category: string): Exclude<TabKey, "all" | "wipers"> | null {
  if (category === "battery") return "batteries";
  if (category === "filter") return "filters";
  if (category === "bulb") return "bulbs";
  if (category === "suspension") return "suspension";
  return null;
}

function isTabKey(value: string | undefined): value is TabKey {
  return tabs.some((tab) => tab.key === value);
}

function buildPartsHref(vehicle: PartsSearchParams, category: TabKey) {
  const query = new URLSearchParams();
  for (const key of ["makeId", "modelId", "year", "make", "model", "applicationId", "generationId", "variantId", "chassis", "body", "engine"] as const) {
    const value = vehicle[key];
    if (value) query.set(key, value);
  }
  if (category !== "all") query.set("category", category);
  const encoded = query.toString();
  return encoded ? `/parts?${encoded}` : "/parts";
}

function buildWiperHref(wiperSet: WiperSet, fitment: WiperFitmentResult, vehicle: PartsSearchParams) {
  const query = new URLSearchParams({ applicationId: fitment.applicationId, applicationKind: "canonical" });
  if (vehicle.make) query.set("make", vehicle.make);
  if (vehicle.model) query.set("model", vehicle.model);
  if (vehicle.year) query.set("year", vehicle.year);
  if (vehicle.chassis || vehicle.body) query.set("bodyChassis", [vehicle.chassis, vehicle.body].filter(Boolean).join(" · "));
  const label = [vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(" ");
  if (label) query.set("vehicle", label);
  return `/wipers/${wiperSet.sku}?${query}`;
}

function buildHelpHref(vehicle: string) {
  const query = new URLSearchParams({ category: "Vehicle parts" });
  if (vehicle) query.set("vehicle", vehicle);
  return `/contact?${query}`;
}

function ServicePill({ icon, label }: { icon: React.ReactNode; label: string }) {
  return <div className="flex items-center gap-2 rounded-lg bg-[#F8FAFC] px-3 py-2.5 text-ink"><span className="text-signal">{icon}</span>{label}</div>;
}
