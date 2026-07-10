import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CarFront, CheckCircle2, CircleHelp, CreditCard, LifeBuoy, Truck } from "lucide-react";
import { WiperSetPurchase } from "@/components/wiper-set-purchase";
import { WiperProductGallery } from "@/components/wiper-product-gallery";
import { formatMoney } from "@/lib/catalog";
import { blobMediaAssets } from "@/lib/blob-media-assets";
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
  const title = `Front Windscreen Wiper Blade Pair - ${wiperSet.driverLengthIn}" + ${wiperSet.passengerLengthIn}"`;
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
            <h1 className="mt-3 text-4xl font-black leading-tight sm:text-5xl">{title}</h1>
            <p className="mt-4 text-lg font-semibold leading-8 text-steel">
              Smooth, quiet and reliable wiping performance designed for everyday New Zealand driving.
            </p>
            <p className="mt-5 text-3xl font-black">{formatMoney(wiperSet.price)}</p>
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
                  <p className="mt-2 text-sm font-bold leading-6 text-steel">
                    This vehicle will be included with your order to help confirm the correct wiper configuration.
                  </p>
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

          <div className="grid gap-3 sm:grid-cols-3">
            <TrustPoint icon={<CarFront className="h-4 w-4" />} text="Vehicle-Matched Fitment" />
            <TrustPoint icon={<Truck className="h-4 w-4" />} text="Fast NZ Dispatch" />
            <TrustPoint icon={<CreditCard className="h-4 w-4" />} text="Secure Checkout" />
          </div>
        </section>
      </section>

      <section className="border-t border-black/10 bg-white">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[0.85fr_1.15fr] lg:px-8">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Reliable Everyday Wiping Performance</p>
            <h2 className="mt-3 text-3xl font-black">Built for daily visibility</h2>
          </div>
          <div className="space-y-4 text-base font-semibold leading-8 text-steel">
            <p>NexAutoParts front wiper blades are designed to provide smooth, quiet and consistent wiping performance for everyday driving.</p>
            <p>The flexible memory steel structure helps distribute pressure evenly across the windscreen, allowing the rubber wiping edge to maintain reliable contact with the glass.</p>
            <p>The durable rubber blade helps reduce common wiping issues such as streaking, skipping, vibration and uneven contact.</p>
            <p>Designed for changing New Zealand weather conditions, the blades provide dependable visibility through rain, heat, cold temperatures and regular daily use.</p>
          </div>
        </div>
      </section>

      <section className="border-t border-black/10 bg-[#F8FAFC]">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <FeatureCard title="Smooth and Quiet Operation" text="Designed to provide smooth movement across the windscreen while helping reduce vibration and unnecessary wiping noise." />
            <FeatureCard title="Even Windscreen Contact" text="The flexible internal structure helps distribute pressure across the blade for consistent contact with the windscreen." />
            <FeatureCard title="Durable Rubber Wiping Edge" text="Designed for reliable everyday use while helping reduce streaks and uneven wiping." />
            <FeatureCard title="Suitable for New Zealand Conditions" text="Built for regular use through changing weather conditions including rain, heat and cold temperatures." />
          </div>
        </div>
      </section>

      <section className="border-t border-black/10 bg-white">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[0.85fr_1.15fr] lg:px-8">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Correct Adapters Included</p>
            <h2 className="mt-3 text-3xl font-black">Matched for your selected vehicle</h2>
          </div>
          <div className="space-y-4 text-base font-semibold leading-8 text-steel">
            <p>Different vehicles use different wiper arm connection styles.</p>
            <p>When a vehicle is selected through the NexAutoParts Vehicle Finder, the compatible adapter configuration is matched according to the available vehicle fitment information.</p>
            <p>No technical connector knowledge is required.</p>
            <p>The appropriate adapter option will be included where required.</p>
            <p className="font-black text-ink">Vehicle fitment should be confirmed through the Vehicle Finder before ordering.</p>
          </div>
        </div>
      </section>

      <section className="border-t border-black/10 bg-[#F8FAFC]">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="mb-6 max-w-3xl">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Adapter support</p>
            <h2 className="mt-3 text-3xl font-black">Adapter Coverage for Common Wiper Arms</h2>
            <p className="mt-4 text-sm font-bold leading-7 text-steel">
              A range of adapter styles is available to support many commonly used wiper arm connections. Select your vehicle through our Vehicle Finder and we will help match the suitable wiper configuration.
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
        </div>
      </section>

      <section className="border-t border-black/10 bg-white">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-12 sm:px-6 lg:grid-cols-[1fr_360px] lg:items-center lg:px-8">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Installation support</p>
            <h2 className="mt-3 text-3xl font-black">Need Help Installing Your Wipers?</h2>
            <p className="mt-4 max-w-3xl text-base font-semibold leading-8 text-steel">
              Different vehicles may use different wiper arm connections. Visit our Installation Guide Centre to view step-by-step fitting instructions and select the guide that matches your adapter type.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
            <Link href="/wiper-installation-guides" className="inline-flex h-12 items-center justify-center rounded bg-signal px-5 font-black text-white transition hover:-translate-y-0.5 hover:bg-red-700">
              View Installation Guides
            </Link>
            <Link href="/contact" className="inline-flex h-12 items-center justify-center gap-2 rounded border border-black/10 bg-white px-5 font-black text-ink transition hover:-translate-y-0.5 hover:border-ink">
              <LifeBuoy className="h-4 w-4" />
              Contact Fitment Support
            </Link>
          </div>
        </div>
      </section>

      <section className="border-t border-black/10 bg-[#F8FAFC]">
        <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Product help</p>
          <h2 className="mt-3 text-3xl font-black">Frequently Asked Questions</h2>
          <div className="mt-6 divide-y divide-black/10 overflow-hidden rounded-lg border border-black/10 bg-white">
            {productFaqs.map((faq) => (
              <details key={faq.question} className="group p-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-black">
                  {faq.question}
                  <span className="text-signal group-open:rotate-45">+</span>
                </summary>
                <div className="mt-3 text-sm font-bold leading-7 text-steel">
                  <p>{faq.answer}</p>
                  {faq.guideLink ? (
                    <Link href="/wiper-installation-guides" className="mt-3 inline-flex font-black text-signal hover:text-ink">
                      View Installation Guides
                    </Link>
                  ) : null}
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-black/10 bg-white">
        <div className="mx-auto grid max-w-7xl gap-4 px-4 py-10 sm:px-6 md:grid-cols-3 lg:px-8">
          <InfoTile title="Shipping" text="Fast nationwide dispatch from New Zealand. Shipping options are shown at checkout." />
          <InfoTile title="Returns" text="Contact us before installation if you believe the product is not suitable for your vehicle." />
          <InfoTile title="Related products" text="Browse all front wiper blade pair combinations in the parts catalog." href="/shop" />
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

function TrustPoint({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex min-h-14 items-center gap-2 rounded-lg border border-black/10 bg-white px-4 text-sm font-black text-ink shadow-sm">
      <span className="text-signal">{icon}</span>
      <span>{text}</span>
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

const productFaqs = [
  {
    question: "Does this product include both front wiper blades?",
    answer: "Yes. This product includes one driver-side blade and one passenger-side blade in the sizes shown on the product page."
  },
  {
    question: "Are adapters included?",
    answer: "Compatible adapter options are included where required. Vehicle fitment should be confirmed through the Vehicle Finder before ordering."
  },
  {
    question: "Do I need to select an adapter?",
    answer: "No. Customers normally do not need to identify or select an adapter manually. Use the Vehicle Finder to confirm the vehicle application."
  },
  {
    question: "Can I install the wipers myself?",
    answer: "Most installations can be completed without specialist tools. Visit our Installation Guide Centre for adapter-specific instructions.",
    guideLink: true
  },
  {
    question: "What should I do if I am unsure about fitment?",
    answer: "Use our Vehicle Finder or contact NexAutoParts before installation."
  }
];

function toMillimetres(lengthIn: number) {
  return Math.round(lengthIn * 25.4);
}
