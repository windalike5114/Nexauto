import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { WiperSetPurchase } from "@/components/wiper-set-purchase";
import { WiperProductGallery } from "@/components/wiper-product-gallery";
import { VehiclePartsFinder } from "@/components/vehicle-parts-finder";
import { formatMoney } from "@/lib/catalog";
import { blobMediaAssets } from "@/lib/blob-media-assets";
import { wiperPairPricing } from "@/lib/pricing";
import { getWiperRearAddonById, getWiperSetBySku } from "@/lib/queries/wiper-commerce";
import { readStoredVehicleContext } from '@/lib/server/vehicle-context';
import { resolveVehicleSelection } from '@/lib/server/resolve-vehicle-selection';
import { matchStorefrontCatalogue } from '@/lib/queries/storefront-catalog';
import { ProductVehicleFitment } from '@/components/product-vehicle-fitment';
import { vehicleContextLabel, vehicleContextDetails } from '@/lib/vehicle-context';

export const dynamic = "force-dynamic";

type WiperSkuSearchParams = {
  vehicle?: string;
  applicationId?: string;
  applicationKind?: "legacy" | "canonical";
  make?: string;
  model?: string;
  year?: string;
  bodyChassis?: string;
  rearAddonId?: string;
};

const productGalleryImages = ["nexautowiper1", "nexautowiper2", "nexautowiper3", "nexautowiper4", "nexautowiper5"];
const adapterImageNames = ["nexautoclip1", "nexautoclip11", "nexautoclip13", "nexautoclip2", "nexautoclip4", "nexautoclip7", "nexautoclip8"];

export async function generateMetadata({ params }: { params: Promise<{ sku: string }> }): Promise<Metadata> {
  const { sku } = await params;
  const wiperSet = await getWiperSetBySku(decodeURIComponent(sku));

  if (!wiperSet) {
    return {
      title: "Premium Windscreen Wiper Blades",
      description: "Find premium windscreen wiper blades for New Zealand vehicles with NexAutoParts."
    };
  }

  const title = getWiperSetTitle(wiperSet);

  return {
    title,
    description: `${title} for New Zealand vehicles. Smooth, quiet wiping performance, vehicle-matched fitment, 12-month warranty and Auckland dispatch.`
  };
}

export default async function WiperSkuPage({
  params,
  searchParams
}: {
  params: Promise<{ sku: string }>;
  searchParams: Promise<WiperSkuSearchParams>;
}) {
  const [{ sku }, query] = await Promise.all([params, searchParams]);
  const [wiperSet, rearAddon] = await Promise.all([
    getWiperSetBySku(decodeURIComponent(sku)),
    getWiperRearAddonById(query.rearAddonId)
  ]);

  if (!wiperSet) notFound();

  const selected = await readStoredVehicleContext();
  let resolved: Awaited<ReturnType<typeof resolveVehicleSelection>> = null;
  let fitmentStatus = 'not-listed';
  try {
    resolved = await resolveVehicleSelection(selected);
    if(resolved){
      const [entry]=await matchStorefrontCatalogue([{id:wiperSet.id,sku:wiperSet.sku,name:wiperSet.name,category:'wipers',price:wiperSet.price,image:'',href:'',purchasable:wiperSet.purchasable,attributes:{driver_length:[`${wiperSet.driverLengthIn}″`],passenger_length:[`${wiperSet.passengerLengthIn}″`]}}],resolved.vehicle,resolved.applications);
      fitmentStatus=entry.status??'not-listed';
    }
  } catch { fitmentStatus='unavailable'; }
  const vehicleContext = resolved && fitmentStatus==='fits' ? {
    applicationId:resolved.applications.length===1?resolved.applications[0].id:undefined,
    applicationKind:'canonical' as const,make:resolved.vehicle.make,model:resolved.vehicle.model,year:Number(resolved.vehicle.year),
    bodyChassis:resolved.vehicle.versionLabel||resolved.vehicle.bodyConfiguration||'',selection:resolved.vehicle
  } : null;
  const vehicle = selected ? [vehicleContextLabel(selected),vehicleContextDetails(selected)].filter(Boolean).join(' · ') : '';
  const title = getWiperSetTitle(wiperSet);
  const galleryImages = productGalleryImages.map((name) => ({
    src: getImageUrl(name),
    alt: `${title} product image`
  }));

  return (
    <main>
      <section className="mx-auto grid max-w-7xl gap-5 px-4 py-5 sm:px-6 sm:py-6 lg:grid-cols-[1.15fr_0.85fr] lg:gap-8 lg:px-8">
        <div className="space-y-4 lg:sticky lg:top-28 lg:self-start">
          <WiperProductGallery images={galleryImages} />
        </div>

        <section className="space-y-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-signal sm:text-sm sm:tracking-[0.18em]">Wipers</p>
            <h1 className="mt-2 text-3xl font-black leading-tight sm:mt-3 sm:text-5xl">Premium Front Windscreen Wiper Blade Pair</h1>
            <p className="mt-2 text-xl font-black text-ink sm:text-2xl">
              {wiperSet.driverLengthIn}" + {wiperSet.passengerLengthIn}"
            </p>
            <div className="mt-4 flex flex-wrap items-end gap-3">
              {wiperSet.purchasable ? (
                <>
                  <span className="text-lg font-black text-steel line-through sm:text-xl">
                    {formatMoney(wiperSet.compareAtPrice ?? wiperPairPricing.compareAtPrice)}
                  </span>
                  <span className="rounded bg-signal px-3 py-1 text-xs font-black uppercase tracking-[0.14em] text-white">Sale</span>
                </>
              ) : (
                <span className="rounded bg-amber-100 px-3 py-1 text-xs font-black uppercase tracking-[0.14em] text-amber-900">Coming soon</span>
              )}
              <span className="text-3xl font-black sm:text-4xl">
                {wiperSet.purchasable ? formatMoney(wiperSet.price) : "Price pending"}
              </span>
            </div>
          </div>

          <ProductVehicleFitment checkedVehicle={selected} status={fitmentStatus}/>

          {wiperSet.purchasable ? (
            <WiperSetPurchase wiperSet={wiperSet} rearAddon={rearAddon} vehicle={vehicle} vehicleContext={vehicleContext} />
          ) : (
            <section className="rounded-lg border border-amber-300 bg-amber-50 p-5">
              <p className="text-sm font-black text-ink">Currently unavailable</p>
              <Link
                href={`/contact?part=${encodeURIComponent(wiperSet.name)}`}
                className="mt-4 inline-flex h-11 items-center justify-center rounded bg-ink px-4 text-sm font-black text-white transition hover:-translate-y-0.5 hover:bg-black"
              >
                Ask about this product
              </Link>
            </section>
          )}

          {!selected ? (
            <details className="rounded-lg border border-black/10 bg-[#F8FAFC] p-3">
              <summary className="cursor-pointer text-sm font-black text-ink">Check compatibility</summary>
              <div className="mt-4"><VehiclePartsFinder compact category="wipers" /></div>
            </details>
          ) : null}
        </section>
      </section>

      <section className="border-t border-black/10 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          <div className="mb-4">
            <h2 className="text-2xl font-black sm:text-3xl">Product Specifications</h2>
          </div>
          <dl className="overflow-hidden rounded-lg border border-black/10 text-sm font-bold">
            <SpecificationRow label="Driver side" value={`${wiperSet.driverLengthIn}\" / ${toMillimetres(wiperSet.driverLengthIn)} mm`} />
            <SpecificationRow label="Passenger side" value={`${wiperSet.passengerLengthIn}\" / ${toMillimetres(wiperSet.passengerLengthIn)} mm`} />
            <SpecificationRow label="Pack" value="1 driver-side blade + 1 passenger-side blade" />
            <SpecificationRow label="SKU" value={wiperSet.sku} />
          </dl>
        </div>
      </section>

      <section className="border-t border-black/10 bg-[#F8FAFC]">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-12 lg:px-8">
          <div className="grid gap-4 md:grid-cols-3">
            <FeatureCard title="Smooth & Quiet" text="Designed for consistent wiping with reduced noise, skipping and vibration." />
            <FeatureCard title="Even Windscreen Contact" text="The flexible internal structure helps distribute pressure across the blade for consistent contact with the windscreen." />
            <FeatureCard title="Built for NZ Conditions" text="Reliable performance through rain, heat, cold weather and daily driving." />
          </div>
        </div>
      </section>

      <section className="border-t border-black/10 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="mb-6 max-w-3xl">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Adapter included</p>
            <h2 className="mt-3 text-3xl font-black">{vehicleContext ? "Correct Adapter Included" : "Adapter Confirmed With Vehicle"}</h2>
            {!selected ? <Link href="/parts#change-vehicle" className="mt-4 inline-flex h-10 items-center rounded-lg border border-black/10 px-4 text-sm font-black">Check compatibility</Link> : null}
          </div>
          <div className="flex gap-4 overflow-x-auto pb-2">
            {adapterImageNames.map((name, index) => (
            <article key={name} className="relative aspect-[4/3] min-w-[58%] overflow-hidden rounded-lg border border-black/10 bg-white shadow-sm min-[430px]:min-w-[42%] sm:min-w-[220px] lg:min-w-0 lg:flex-1">
                <Image
                  src={getImageUrl(name)}
                  alt={`Common wiper arm adapter style ${index + 1}`}
                  fill
                  className="object-contain p-5"
                  sizes="(min-width: 1024px) 14vw, 42vw"
                />
              </article>
            ))}
          </div>
          <p className="mt-4 text-xs font-bold text-steel">Example adapter styles</p>
        </div>
      </section>

      <section className="border-t border-black/10 bg-[#F8FAFC]">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-10 sm:px-6 sm:py-12 lg:grid-cols-[1fr_360px] lg:items-center lg:px-8">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Installation support</p>
            <h2 className="mt-3 text-2xl font-black sm:text-3xl">Need Help Installing Your Wipers?</h2>
            <p className="mt-4 max-w-3xl text-base font-semibold leading-8 text-steel">
              View step-by-step installation guides for different adapter types.
            </p>
          </div>
          <div>
            <Link href="/wiper-installation-guides" className="inline-flex h-12 w-full items-center justify-center rounded bg-signal px-5 font-black text-white transition hover:-translate-y-0.5 hover:bg-red-700 sm:w-auto">
              View Installation Guides
            </Link>
          </div>
        </div>
      </section>

      <section className="border-t border-black/10 bg-white">
        <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="mt-6 divide-y divide-black/10 overflow-hidden rounded-lg border border-black/10 bg-white">
            <AccordionItem title="Installation">
              Most installations require no specialist tools. Use the Installation Guide Centre to match your adapter style and follow the fitting steps.
            </AccordionItem>
            <AccordionItem title="Shipping">
              Standard NZ shipping is currently waived as a launch promotion. Orders ship from Auckland.
            </AccordionItem>
            <AccordionItem title="Returns & Warranty">
              Includes a 12-month warranty. Contact us before installation if you believe the product is not suitable for your vehicle.
            </AccordionItem>
            {productFaqs.map((faq) => (
              <AccordionItem key={faq.question} title={faq.question}>
                {faq.answer}
              </AccordionItem>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-black/10 bg-[#F8FAFC]">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <InfoTile title="Related products" text="Browse compatible front wiper blade pair combinations." href="/parts?category=wipers" />
        </div>
      </section>
    </main>
  );
}

function cleanVehicleDetail(value: string | undefined) {
  return value?.trim().replace(/\s+/g, " ").slice(0, 240) ?? "";
}

function getImageUrl(name: string) {
  const image = blobMediaAssets.images.find((asset) => asset.name === name);
  if (!image) throw new Error(`Missing Blob image asset: ${name}`);
  return image.url;
}

function getWiperSetTitle(wiperSet: { driverLengthIn: number; passengerLengthIn: number }) {
  return `Premium Front Windscreen Wiper Blade Pair - ${wiperSet.driverLengthIn}" + ${wiperSet.passengerLengthIn}"`;
}

function SpecificationRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-4 border-b border-black/10 px-4 py-3 last:border-b-0 odd:bg-zinc-50">
      <dt className="font-black text-ink">{label}</dt>
      <dd className="text-right text-steel">{value}</dd>
    </div>
  );
}

function FeatureCard({ title, text }: { title: string; text: string }) {
  return (
    <article className="rounded-lg border border-black/10 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-panel">
      <div className="grid h-9 w-9 place-items-center rounded-full bg-signal text-white">
        <CheckCircle2 className="h-5 w-5" />
      </div>
      <h3 className="mt-4 text-lg font-black">{title}</h3>
      <p className="mt-3 text-sm font-bold leading-7 text-steel">{text}</p>
    </article>
  );
}

function InfoTile({ title, text, href }: { title: string; text: string; href?: "/parts?category=wipers" }) {
  const content = (
    <article className="h-full rounded-lg border border-black/10 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <h3 className="font-black">{title}</h3>
      <p className="mt-2 text-sm font-bold leading-6 text-steel">{text}</p>
    </article>
  );

  return href ? <Link href={href}>{content}</Link> : content;
}

function AccordionItem({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="group p-5">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-black">
        {title}
        <span className="text-signal group-open:rotate-45">+</span>
      </summary>
      <div className="mt-3 text-sm font-bold leading-7 text-steel">{children}</div>
    </details>
  );
}

const productFaqs = [
  {
    question: "Does this include both front blades?",
    answer: "Yes. One driver-side and one passenger-side blade are included."
  },
  {
    question: "Do I need to select an adapter?",
    answer: "No. The suitable adapter is matched using your selected vehicle."
  },
  {
    question: "Can I install the wipers myself?",
    answer: "Most installations require no specialist tools. View our Installation Guide Centre for instructions."
  }
];

function toMillimetres(lengthIn: number) {
  return Math.round(lengthIn * 25.4);
}
