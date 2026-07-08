import Image from "next/image";
import { notFound } from "next/navigation";
import { CarFront, CheckCircle2, PlayCircle, ShieldCheck, Truck, Wrench } from "lucide-react";
import { WiperSetPurchase } from "@/components/wiper-set-purchase";
import { formatMoney } from "@/lib/catalog";
import { getWiperRearAddonById, getWiperSetBySku } from "@/lib/queries/wiper-commerce";
import { getWiperSetPreviewImage } from "@/lib/wiper-product-images";

export const dynamic = "force-dynamic";

type WiperSkuSearchParams = {
  vehicle?: string;
  applicationId?: string;
  make?: string;
  model?: string;
  year?: string;
  rearAddonId?: string;
};

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
  const productImage = getWiperSetPreviewImage(wiperSet);

  return (
    <main>
      <section className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[0.95fr_1.05fr] lg:px-8">
        <div className="space-y-4 lg:sticky lg:top-28 lg:self-start">
          <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-zinc-200">
            <Image
              src={productImage}
              alt={wiperSet.name}
              fill
              priority
              className="object-contain p-8"
              sizes="(min-width: 1024px) 50vw, 100vw"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <MediaTile icon={<Truck className="h-4 w-4" />} text="Dispatch" />
            <MediaTile icon={<ShieldCheck className="h-4 w-4" />} text="Secure pay" />
            <MediaTile icon={<Wrench className="h-4 w-4" />} text="SKU fit" />
          </div>
        </div>

        <section className="space-y-6">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Wipers</p>
            <h1 className="mt-3 text-4xl font-black leading-tight sm:text-5xl">{wiperSet.name}</h1>
            <p className="mt-4 text-lg leading-8 text-steel">
              Matched front pair generated from fitment data. Customers only select a vehicle; blade lengths and connector handling stay with the system.
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
                    This vehicle will be saved with the cart and order for internal SKU and connector fulfillment.
                  </p>
                </div>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <FitmentTile label="Driver blade" lengthIn={wiperSet.driverLengthIn} />
                <FitmentTile label="Passenger blade" lengthIn={wiperSet.passengerLengthIn} />
                <FitmentTile label="Rear blade" lengthIn={rearAddon?.rearLengthIn ?? null} suffix={rearAddon ? "optional" : undefined} />
              </div>
            </section>
          ) : (
            <section className="rounded-lg border border-black/10 bg-zinc-50 p-5">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-signal" />
                <p className="text-sm font-bold text-steel">
                  Buying manually from the catalog. For the safest fitment, search your vehicle first.
                </p>
              </div>
            </section>
          )}

          <WiperSetPurchase wiperSet={wiperSet} rearAddon={rearAddon} vehicle={vehicle} vehicleContext={vehicleContext} />
        </section>
      </section>

      <section className="border-t border-black/10 bg-white">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[0.85fr_1.15fr] lg:px-8">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Built for daily visibility</p>
            <h2 className="mt-3 text-3xl font-black">Product details</h2>
            <p className="mt-4 leading-8 text-steel">
              The high-toughness memory steel strip ensures a tight fit to the windshield. Advanced craftsmanship and high-quality materials guarantee the rubber strip remains highly lubricated, even after long periods of use, without generating noise.
            </p>
            <p className="mt-4 leading-8 text-steel">
              While ensuring excellent performance in silence, durability, high temperature resistance, anti-freeze, anti-oxidation, and even pressure distribution, this wiper blade still maintains an astonishingly low price. The 17 different types of adapters available allow it to perfectly fit 99% of vehicle models on the market.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {[
                `${wiperSet.driverLengthIn}" / ${toMillimetres(wiperSet.driverLengthIn)} mm driver blade`,
                `${wiperSet.passengerLengthIn}" / ${toMillimetres(wiperSet.passengerLengthIn)} mm passenger blade`,
                "Vehicle context saved",
                "Rear blade optional"
              ].map((item) => (
                <span key={item} className="rounded bg-zinc-100 px-3 py-2 text-sm font-bold text-steel">
                  {item}
                </span>
              ))}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <DetailBlock title="What is included" text="One front driver-side blade and one front passenger-side blade as a matched pair." />
            <DetailBlock title="Connector handling" text="Connector fitment is kept separate from blade length. Our backend can record connector choice before dispatch." />
            <DetailBlock title="Vehicle context" text="When opened from the finder, your selected vehicle is carried into cart metadata for fulfillment." />
            <article className="rounded-lg border border-black/10 bg-ink p-5 text-white">
              <div className="flex items-center gap-3">
                <PlayCircle className="h-6 w-6 text-signal" />
                <h3 className="text-lg font-black">Installation overview</h3>
              </div>
              <p className="mt-3 leading-7 text-white/75">
                A short product walkthrough can sit here for blade replacement, connector confirmation, and buyer confidence.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section className="border-t border-black/10 bg-zinc-50">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="mb-6 max-w-3xl">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Adapters</p>
            <h2 className="mt-3 text-3xl font-black">Adapter coverage for common wiper arms</h2>
            <p className="mt-4 text-sm font-bold leading-7 text-steel">
              Customers do not need to select the connector. Vehicle information travels with the order so the correct adapter can be matched before dispatch.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {adapterImages.map((adapter) => (
              <article key={adapter.title} className="overflow-hidden rounded-lg border border-black/10 bg-white shadow-sm">
                <div className="relative aspect-[4/3] bg-white">
                  <Image
                    src={adapter.src}
                    alt={adapter.title}
                    fill
                    className="object-contain p-4"
                    sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
                  />
                </div>
                <div className="border-t border-black/10 p-4">
                  <h3 className="font-black">{adapter.title}</h3>
                  <p className="mt-1 text-sm font-bold text-steel">{adapter.text}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-black/10 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="mb-6 max-w-3xl">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Installation videos</p>
            <h2 className="mt-3 text-3xl font-black">Quick installation guides</h2>
            <p className="mt-4 text-sm font-bold leading-7 text-steel">
              Short adapter installation videos help confirm the fitting process before or after purchase.
            </p>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            {installationVideos.map((video) => (
              <article key={video.title} className="overflow-hidden rounded-lg border border-black/10 bg-white shadow-sm">
                <video className="aspect-video w-full bg-black" controls preload="metadata">
                  <source src={video.src} type="video/mp4" />
                </video>
                <div className="p-4">
                  <h3 className="font-black">{video.title}</h3>
                  <p className="mt-1 text-sm font-bold text-steel">{video.text}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

const adapterImages = [
  { src: "/yj-wiper/adapters/adapter-m6.png", title: "Adapter style M6", text: "Common connector profile for selected wiper arms." },
  { src: "/yj-wiper/adapters/adapter-m8.png", title: "Adapter style M8", text: "Alternative connector profile handled during fulfillment." },
  { src: "/yj-wiper/adapters/adapter-p6.png", title: "Adapter style P6", text: "Low-profile fitting option for compatible arms." },
  { src: "/yj-wiper/adapters/adapter-p8.png", title: "Adapter style P8", text: "Extended fitment option for matching vehicle applications." }
];

const installationVideos = [
  { src: "/yj-wiper/install-videos/install-adapter-1.mp4", title: "Adapter installation 1", text: "Short guide for connector setup." },
  { src: "/yj-wiper/install-videos/install-adapter-2.mp4", title: "Adapter installation 2", text: "Quick fitting process overview." },
  { src: "/yj-wiper/install-videos/install-adapter-3.mp4", title: "Adapter installation 3", text: "Additional adapter installation reference." }
];

function MediaTile({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex min-h-16 flex-col items-center justify-center gap-1 rounded border border-black/10 bg-white text-sm font-black text-steel">
      {icon}
      <span>{text}</span>
    </div>
  );
}

function FitmentTile({ label, lengthIn, suffix }: { label: string; lengthIn: number | null; suffix?: string }) {
  return (
    <div className="rounded-lg border border-black/10 bg-white p-4">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-steel">{label}</p>
      {lengthIn ? (
        <>
          <p className="mt-2 text-2xl font-black text-ink">
            {lengthIn}"{suffix ? <span className="ml-1 text-sm text-steel">{suffix}</span> : null}
          </p>
          <p className="mt-1 text-xs font-black text-steel">{toMillimetres(lengthIn)} mm</p>
        </>
      ) : (
        <p className="mt-2 text-2xl font-black text-ink">Not listed</p>
      )}
    </div>
  );
}

function DetailBlock({ title, text }: { title: string; text: string }) {
  return (
    <article className="rounded-lg border border-black/10 bg-white p-5">
      <h2 className="font-black">{title}</h2>
      <p className="mt-3 text-sm font-bold leading-6 text-steel">{text}</p>
    </article>
  );
}

function toMillimetres(lengthIn: number) {
  return Math.round(lengthIn * 25.4);
}
