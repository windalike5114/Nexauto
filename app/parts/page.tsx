import type { Metadata } from "next";
import Link from "next/link";
import { CarFront } from "lucide-react";
import { CompatiblePartsBrowser, type CompatiblePartsTab } from "@/components/compatible-parts-browser";
import { VehicleContextSynchronizer } from "@/components/vehicle-context-synchronizer";
import { VehiclePartsFinder } from "@/components/vehicle-parts-finder";
import { listAllProductsForVehicle } from "@/lib/queries/vehicle-product-fitment";
import { getWiperSetByLengths } from "@/lib/queries/wiper-commerce";
import { findWiperLengthFitments, type WiperFitmentResult } from "@/lib/queries/wiper-fitment";
import { readStoredVehicleContext } from "@/lib/server/vehicle-context";
import type { Product, WiperSet } from "@/lib/types";
import type { VehicleContext } from "@/lib/vehicle-context";
import { findHighConfidenceWiperReview } from "@/lib/wiper-review-demo";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Parts for Your Vehicle",
  description: "Select your vehicle once, then browse every confirmed compatible part by category."
};

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
  const vehicleLabel = [vehicle.year, vehicle.make, vehicle.model, vehicle.chassis].filter(Boolean).join(" ");
  const vehicleDetail = [vehicle.body, vehicle.engine].filter(Boolean).join(" · ");
  const reviewDemo = compatible.wiperSet ? null : findHighConfidenceWiperReview(vehicle);
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

      {selection ? (
        <CompatiblePartsBrowser
          products={products}
          wiperSet={compatible.wiperSet}
          wiperHref={wiperHref}
          rearLengthIn={compatible.wiperFitment?.rearLengthIn ?? null}
          reviewDemo={reviewDemo}
          initialTab={activeTab}
          vehicleLabel={vehicleLabel}
          error={compatible.error}
        />
      ) : (
        <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8 lg:py-12">
          <div className="rounded-2xl border border-black/10 bg-white p-7 text-center shadow-sm">
            <CarFront className="mx-auto h-9 w-9 text-signal" />
            <h2 className="mt-4 text-2xl font-black">Choose a vehicle to see compatible products</h2>
            <p className="mx-auto mt-3 max-w-xl text-sm font-semibold leading-6 text-steel">Your selection will stay active while you switch between product categories.</p>
            <Link href="#change-vehicle" className="mt-5 inline-flex h-11 items-center justify-center rounded-lg bg-ink px-5 text-sm font-black text-white">Choose vehicle</Link>
          </div>
        </section>
      )}
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

function isTabKey(value: string | undefined): value is CompatiblePartsTab {
  return ["all", "wipers", "batteries", "filters", "bulbs", "suspension"].includes(value ?? "");
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
