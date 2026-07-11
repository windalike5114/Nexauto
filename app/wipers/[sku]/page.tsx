import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CarFront, CheckCircle2, CircleHelp } from "lucide-react";
import { WiperSetPurchase } from "@/components/wiper-set-purchase";
import { WiperProductGallery } from "@/components/wiper-product-gallery";
import { formatMoney } from "@/lib/catalog";
import { blobMediaAssets } from "@/lib/blob-media-assets";
import { wiperPairPricing } from "@/lib/pricing";
import { getWiperRearAddonById, getWiperSetBySku } from "@/lib/queries/wiper-commerce";

export const dynamic = "force-dynamic";

type WiperSkuSearchParams = {
  vehicle?: string;
  applicationId?: string;
  make?: string;
  model?: string;
  year?: string;
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

  const vehicleContext =
    query.applicationId && query.make && query.model && query.year
      ? {
          applicationId: query.applicationId,
          make: decodeURIComponent(query.make),
          model: decodeURIComponent(query.model),
          year: Number(query.year)
        }
      : null;
  const vehicle = vehicleContext
    ? `${vehicleContext.make} ${vehicleContext.model} ${vehicleContext.year}`
    : query.vehicle
      ? decodeURIComponent(query.vehicle)
      : "";
  const title = getWiperSetTitle(wiperSet);
  const galleryImages = productGalleryImages.map((name) => ({
    src: getImageUrl(name),
    alt: `${title} product image`
  }));

  return (
    <main>
      <section className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[1.15fr_0.85fr] lg:px-8">
        <div className="space-y-4 lg:sticky lg:top-28 lg:self-start">
          <WiperProductGallery images={galleryImages} />
        </div>

        <section className="space-y-6">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Wipers</p>
            <h1 className="mt-3 text-4xl font-black leading-tight sm:text-5xl">Premium Front Windscreen Wiper Blade Pair</h1>
            <p className="mt-2 text-2xl font-black text-ink">
              {wiperSet.driverLengthIn}" + {wiperSet.passengerLengthIn}"
            </p>
            <p className="mt-4 text-lg font-semibold leading-8 text-steel">
              Smooth, quiet and reliable wiping performance designed for everyday New Zealand driving.
            </p>
            <div className="mt-5 flex flex-wrap items-end gap-3">
              <span className="text-xl font-black text-steel line-through">
                {formatMoney(wiperSet.compareAtPrice ?? wiperPairPricing.compareAtPrice)}
              </span>
              <span className="rounded bg-signal px-3 py-1 text-xs font-black uppercase tracking-[0.14em] text-white">Sale</span>
              <span className="text-4xl font-black">{formatMoney(wiperSet.price)}</span>
            </div>
            <div className="mt-4 grid gap-2 text-sm font-black text-ink sm:grid-cols-2">
              <span className="rounded border border-black/10 bg-white px-3 py-2">Fits your selected vehicle</span>
              <span className="rounded border border-black/10 bg-white px-3 py-2">Front pair included</span>
              <span className="rounded border border-black/10 bg-white px-3 py-2">Free NZ shipping</span>
              <span className="rounded border border-black/10 bg-white px-3 py-2">12-Month Warranty</span>
              <span className="rounded border border-black/10 bg-white px-3 py-2">Ships from Auckland</span>
            </div>
          </div>

          {vehicle ? (
            <section className="rounded-lg border border-black/10 bg-zinc-50 p-5">
              <div className="flex items-start gap-3">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-signal text-white">
                  <CarFront className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-signal">Selected vehicle</p>
                  <h2 className="mt-1 text-2xl font-black">{vehicle}</h2>
                </div>
              </div>
            </section>
          ) : (
            <section className="rounded-lg border border-black/10 bg-zinc-50 p-5">
              <div className="flex items-start gap-3">
                <CircleHelp className="mt-0.5 h-5 w-5 shrink-0 text-signal" />
                <div>
                  <p className="text-sm font-black text-ink">Buying manually from the catalog</p>
                  <p className="mt-1 text-sm font-bold leading-6 text-steel">
                    For the safest fitment, search your vehicle before ordering.
                  </p>
                </div>
              </div>
            </section>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <FitmentTile label="Driver side" lengthIn={wiperSet.driverLengthIn} />
            <FitmentTile label="Passenger side" lengthIn={wiperSet.passengerLengthIn} />
          </div>

          <div className="flex flex-col gap-3 rounded-lg border border-black/10 bg-[#F8FAFC] p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-bold leading-6 text-steel">
              Not sure whether these sizes fit your vehicle? Use our Vehicle Finder before ordering to confirm compatibility.
            </p>
            <Link href="/#vehicle-finder" className="inline-flex h-11 shrink-0 items-center justify-center rounded bg-ink px-4 text-sm font-black text-white transition hover:-translate-y-0.5 hover:bg-black">
              Check My Vehicle
            </Link>
          </div>

          <WiperSetPurchase wiperSet={wiperSet} rearAddon={rearAddon} vehicle={vehicle} vehicleContext={vehicleContext} />
        </section>
      </section>

      <section className="border-t border-black/10 bg-[#F8FAFC]">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
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
            <h2 className="mt-3 text-3xl font-black">Correct Adapter Included</h2>
            <p className="mt-4 text-sm font-bold leading-7 text-steel">
              Your selected vehicle is matched with the appropriate wiper adapter. You do not need to identify or select the connector manually.
            </p>
          </div>
          <div className="flex gap-4 overflow-x-auto pb-2">
            {adapterImageNames.map((name, index) => (
              <article key={name} className="relative aspect-[4/3] min-w-[42%] overflow-hidden rounded-lg border border-black/10 bg-white shadow-sm sm:min-w-[220px] lg:min-w-0 lg:flex-1">
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
          <p className="mt-4 text-sm font-bold leading-7 text-steel">
            Adapter styles shown are examples. The suitable configuration will be supplied for your selected vehicle.
          </p>
        </div>
      </section>

      <section className="border-t border-black/10 bg-[#F8FAFC]">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-12 sm:px-6 lg:grid-cols-[1fr_360px] lg:items-center lg:px-8">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Installation support</p>
            <h2 className="mt-3 text-3xl font-black">Need Help Installing Your Wipers?</h2>
            <p className="mt-4 max-w-3xl text-base font-semibold leading-8 text-steel">
              View step-by-step installation guides for different adapter types.
            </p>
          </div>
          <div>
            <Link href="/wiper-installation-guides" className="inline-flex h-12 items-center justify-center rounded bg-signal px-5 font-black text-white transition hover:-translate-y-0.5 hover:bg-red-700">
              View Installation Guides
            </Link>
          </div>
        </div>
      </section>

      <section className="border-t border-black/10 bg-white">
        <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="mt-6 divide-y divide-black/10 overflow-hidden rounded-lg border border-black/10 bg-white">
            <AccordionItem title="Product Details">
              Includes one driver-side blade and one passenger-side blade. The listed sizes are {wiperSet.driverLengthIn}" / {toMillimetres(wiperSet.driverLengthIn)} mm and {wiperSet.passengerLengthIn}" / {toMillimetres(wiperSet.passengerLengthIn)} mm.
            </AccordionItem>
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
          <InfoTile title="Related products" text="Browse available front wiper blade pair combinations." href="/shop" />
        </div>
      </section>
    </main>
  );
}

function getImageUrl(name: string) {
  const image = blobMediaAssets.images.find((asset) => asset.name === name);
  if (!image) throw new Error(`Missing Blob image asset: ${name}`);
  return image.url;
}

function getWiperSetTitle(wiperSet: { driverLengthIn: number; passengerLengthIn: number }) {
  return `Premium Front Windscreen Wiper Blade Pair - ${wiperSet.driverLengthIn}" + ${wiperSet.passengerLengthIn}"`;
}

function FitmentTile({ label, lengthIn }: { label: string; lengthIn: number }) {
  return (
    <div className="rounded-lg border border-black/10 bg-white p-4 shadow-sm">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-steel">{label}</p>
      <p className="mt-2 text-xl font-black text-ink">
        {lengthIn}" <span className="text-sm font-bold text-steel">/ approximately {toMillimetres(lengthIn)} mm</span>
      </p>
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

function InfoTile({ title, text, href }: { title: string; text: string; href?: "/shop" }) {
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
