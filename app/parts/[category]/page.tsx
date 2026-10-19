import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, BatteryCharging, CheckCircle2, Filter, Lightbulb, Wrench } from "lucide-react";
import { VehiclePartsFinder } from "@/components/vehicle-parts-finder";
import { formatMoney } from "@/lib/catalog";
import { productImage } from "@/lib/product-content";
import { listProducts } from "@/lib/queries/catalog";
import { listProductsForVehicle } from "@/lib/queries/vehicle-product-fitment";
import type { Product } from "@/lib/types";

const categoryDefinitions = {
  bulbs: {
    name: "Light Bulbs",
    description: "Shop current lighting products and confirm bulb type, position and pack quantity before ordering.",
    fields: ["Body or chassis", "Lamp position", "Bulb type or existing part number"],
    databaseCategory: "bulb",
    image: "/products/halogen-bulb.png",
    icon: Lightbulb
  },
  batteries: {
    name: "Batteries",
    description: "Battery fitment depends on physical size, terminal layout and the vehicle's electrical requirements.",
    fields: ["Engine", "Start-stop system", "Terminal layout and case size"],
    databaseCategory: "battery",
    image: "/products/vehicle-battery.png",
    icon: BatteryCharging
  },
  filters: {
    name: "Oil Filters",
    description: "Oil filters are matched by engine application, filter construction and cross-reference part number.",
    fields: ["Engine code or capacity", "Fuel type", "Existing filter or OE part number"],
    databaseCategory: "filter",
    image: "/products/vehicle-oil-filter.png",
    icon: Filter
  },
  suspension: {
    name: "Control Arms",
    description: "Control arms must be confirmed by chassis, drivetrain and exact installation position.",
    fields: ["Chassis", "Front or rear / left or right", "Upper or lower position"],
    databaseCategory: "suspension",
    image: "/products/control-arm-v2.png",
    icon: Wrench
  }
} as const;

type CategoryKey = keyof typeof categoryDefinitions;
type CategorySearchParams = {
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

export default async function PartCategoryPage({ params, searchParams }: { params: Promise<{ category: string }>; searchParams: Promise<CategorySearchParams> }) {
  const [{ category }, vehicle] = await Promise.all([params, searchParams]);
  if (!(category in categoryDefinitions)) notFound();
  const definition = categoryDefinitions[category as CategoryKey];
  const vehicleSelection = parseVehicleSelection(vehicle);
  const products = vehicleSelection
    ? await loadVehicleProducts(definition.databaseCategory, vehicleSelection)
    : await loadCategoryProducts(definition.databaseCategory);
  const currentProducts = products.filter((product) => !["vehicle-fit-battery", "vehicle-fit-oil-filter"].includes(product.slug));
  const vehicleLabel = [vehicle.year, vehicle.make, vehicle.model, vehicle.chassis].filter(Boolean).join(" ");
  const Icon = definition.icon;
  const quoteHref = buildQuoteHref(definition.name, vehicleLabel);

  return (
    <main className="bg-[#F8FAFC]">
      <section className="relative isolate overflow-hidden bg-ink text-white">
        <Image src={definition.image} alt={`${definition.name} category`} fill priority className="-z-20 object-cover object-center" sizes="100vw" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-black via-black/82 to-black/25" />
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-signal"><Icon className="h-4 w-4" /> Vehicle-specific parts</div>
          <h1 className="mt-3 text-4xl font-black sm:text-5xl">{definition.name}</h1>
          <p className="mt-4 max-w-2xl text-base font-bold leading-7 text-white/78">{definition.description}</p>
        </div>
      </section>

      <section id="vehicle-finder" className="scroll-mt-40 border-b border-black/10 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          {vehicleLabel ? (
            <div className="flex flex-col gap-4 rounded-xl border border-emerald-700/20 bg-emerald-50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-700" /><div><p className="text-xs font-black uppercase tracking-[0.14em] text-emerald-700">Current vehicle</p><h2 className="mt-1 text-xl font-black">{vehicleLabel}</h2>{vehicle.body || vehicle.engine ? <p className="mt-1 text-xs font-bold text-steel">{[vehicle.body, vehicle.engine].filter(Boolean).join(" · ")}</p> : null}</div></div>
              <a href="#change-vehicle" className="inline-flex h-10 items-center justify-center rounded-lg border border-emerald-700/20 bg-white px-4 text-sm font-black">Change vehicle</a>
            </div>
          ) : null}
          <details id="change-vehicle" open={!vehicleLabel} className="mt-4 rounded-xl border border-black/10 bg-[#EEF2F5] p-3">
            <summary className="cursor-pointer px-2 py-2 text-sm font-black">{vehicleLabel ? "Choose a different vehicle" : "Choose your vehicle for fitment help"}</summary>
            <div className="mt-2"><VehiclePartsFinder /></div>
          </details>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
        <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
          <div>
            <div className="flex items-end justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-signal">{vehicleSelection ? "Matches from the new vehicle catalogue" : "Current catalogue"}</p><h2 className="mt-2 text-3xl font-black">{vehicleSelection ? `Parts for ${vehicleLabel}` : `${definition.name} products`}</h2></div><span className="text-sm font-bold text-steel">{currentProducts.length} {vehicleSelection ? "compatible " : ""}listing{currentProducts.length === 1 ? "" : "s"}</span></div>
            {currentProducts.length ? (
              <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{currentProducts.map((product) => <ProductCard key={product.id} product={product} />)}</div>
            ) : (
              <div className="mt-6 rounded-2xl border border-black/10 bg-white p-7 shadow-sm">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-signal">{vehicleSelection ? "No confirmed match" : "Request a quote"}</p>
                <h3 className="mt-2 text-2xl font-black">{vehicleSelection ? `No ${definition.name.toLowerCase()} are currently linked to this vehicle.` : "No confirmed catalogue item is shown yet."}</h3>
                <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-steel">{vehicleSelection ? "The new vehicle catalogue returned no published fitment for this category. Send the engine, chassis or existing part number and we can review the missing mapping." : "We have removed generic placeholder products from this category. Send the vehicle and part details below so the team can confirm a real option rather than presenting an unverified fitment."}</p>
                <Link href={quoteHref as never} className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-signal px-5 text-sm font-black text-white hover:bg-red-700">Request a Quote <ArrowRight className="h-4 w-4" /></Link>
              </div>
            )}
          </div>

          <aside className="h-fit rounded-2xl border border-black/10 bg-white p-5 shadow-sm lg:sticky lg:top-40">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-signal">Fitment checklist</p>
            <h2 className="mt-2 text-xl font-black">What we may need</h2>
            <ul className="mt-4 space-y-3">{definition.fields.map((field) => <li key={field} className="flex items-start gap-3 text-sm font-bold leading-6"><span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-signal" />{field}</li>)}</ul>
            <p className="mt-5 rounded-lg bg-zinc-100 p-3 text-xs font-bold leading-5 text-steel">A compatibility message appears only after the category data and required vehicle details confirm a match.</p>
            <Link href={quoteHref as never} className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-lg bg-ink px-4 text-sm font-black text-white">Get fitment help</Link>
          </aside>
        </div>
      </section>
    </main>
  );
}

async function loadCategoryProducts(category: string) {
  try { return await listProducts(category); } catch { return [] as Product[]; }
}

async function loadVehicleProducts(category: string, selection: { makeId: string; modelId: string; year: number; applicationId?: string }) {
  try { return await listProductsForVehicle(category, selection); } catch { return [] as Product[]; }
}

function parseVehicleSelection(vehicle: CategorySearchParams) {
  const year = Number(vehicle.year);
  if (!vehicle.makeId || !vehicle.modelId || !Number.isInteger(year)) return null;
  return { makeId: vehicle.makeId, modelId: vehicle.modelId, year, applicationId: vehicle.applicationId };
}

function buildQuoteHref(category: string, vehicle: string) {
  const query = new URLSearchParams({ category });
  if (vehicle) query.set("vehicle", vehicle);
  return `/contact?${query}`;
}

function ProductCard({ product }: { product: Product }) {
  const image = productImage(product);
  return (
    <Link href={`/products/${product.slug}` as never} className="group overflow-hidden rounded-xl border border-black/10 bg-white shadow-sm hover:-translate-y-0.5 hover:shadow-panel">
      <div className="relative aspect-[4/3] bg-zinc-100">{image ? <Image src={image} alt={product.name} fill className="object-contain p-4 transition group-hover:scale-[1.03]" sizes="(min-width: 1280px) 25vw, 50vw" /> : null}</div>
      <div className="p-4"><h3 className="text-lg font-black">{product.name}</h3><p className="mt-2 line-clamp-2 text-sm font-semibold leading-6 text-steel">{product.description}</p><div className="mt-4 flex items-center justify-between"><span className="text-xl font-black">{product.purchasable ? formatMoney(product.price) : "Preview"}</span><span className="inline-flex items-center gap-2 text-sm font-black">View <ArrowRight className="h-4 w-4" /></span></div></div>
    </Link>
  );
}
