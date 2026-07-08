import Image from "next/image";
import Link from "next/link";
import { ArrowRight, BadgeCheck, CheckCircle2, Gauge, ShieldCheck, Sparkles, Truck, Wrench } from "lucide-react";
import { WiperFitmentFinder } from "@/components/wiper-fitment-finder";
import { formatMoney } from "@/lib/catalog";
import { listWiperSets } from "@/lib/queries/wiper-commerce";
import type { WiperSet } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const popularWiperSets = await loadPopularWiperSets();

  return (
    <main className="bg-white">
      <section className="relative overflow-hidden bg-ink">
        <Image
          src="/hero-nz-wiper-road.png"
          alt="Modern vehicle driving on a wet New Zealand road"
          fill
          priority
          className="object-cover opacity-75"
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/48 to-black/18" />

        <div className="relative mx-auto grid min-h-[calc(100vh-73px)] max-w-7xl content-center gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[0.84fr_1.16fr] lg:px-8">
          <div className="flex flex-col justify-center text-white">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-white/80">NZ wiper fitment tool</p>
            <h1 className="mt-4 max-w-3xl text-4xl font-black leading-tight sm:text-6xl">
              Find the correct wiper blades for your vehicle.
            </h1>
            <p className="mt-5 max-w-2xl text-lg font-semibold leading-8 text-white/78">
              Select your make, model, and year. NexAuto matches the blade lengths and keeps connector handling internal for fulfillment.
            </p>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              <TrustPill icon={<Wrench className="h-4 w-4" />} text="Fitment first" />
              <TrustPill icon={<ShieldCheck className="h-4 w-4" />} text="Secure checkout" />
              <TrustPill icon={<Truck className="h-4 w-4" />} text="NZ focused" />
            </div>
          </div>

          <div className="self-center">
            <WiperFitmentFinder />
          </div>
        </div>
      </section>

      <section className="border-b border-black/10 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Popular Products</p>
              <h2 className="mt-2 text-3xl font-black">Bestselling front pair SKUs</h2>
            </div>
            <Link href="/shop" className="inline-flex h-11 items-center gap-2 rounded-lg border border-black/10 bg-white px-4 text-sm font-black text-ink hover:border-ink">
              View all SKUs
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="flex gap-4 overflow-x-auto pb-2">
            {popularWiperSets.map((wiperSet) => (
              <PopularSkuCard key={wiperSet.id} wiperSet={wiperSet} />
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-2 lg:px-8">
        <ContentSection
          icon={<BadgeCheck className="h-5 w-5" />}
          title="Why Choose Our Wipers"
          text="Our wiper flow starts with fitment data, not guesswork. Customers search the vehicle first, then the system maps the correct front pair SKU and carries that vehicle through cart and checkout."
          points={["Vehicle-first buying path", "NZ-focused fitment data", "Order notes ready for fulfillment"]}
        />
        <ContentSection
          icon={<Gauge className="h-5 w-5" />}
          title="Beam Wiper Benefits"
          text="Beam-style blades are built for even screen pressure, clean contact, and reliable performance in changing New Zealand weather."
          points={["Even pressure across the glass", "Low-profile modern design", "Good wet-weather visibility"]}
        />
        <ContentSection
          icon={<Sparkles className="h-5 w-5" />}
          title="Product Advantages"
          text="Front blades are sold as matched long-and-short pairs, making the buying experience simpler while keeping internal SKU mapping clear."
          points={["Matched front pair kits", "Simple SKU format", "Rear blade add-on when available"]}
        />
        <ContentSection
          icon={<CheckCircle2 className="h-5 w-5" />}
          title="Easy Installation & Perfect Fit"
          text="Customers do not choose blade length or connector manually. The selected vehicle stays attached to the order so the team can confirm connector handling before dispatch."
          points={["No manual length selection", "Connector handled internally", "Vehicle saved with the order"]}
        />
      </section>
    </main>
  );
}

async function loadPopularWiperSets() {
  try {
    const wiperSets = await listWiperSets();
    return pickPopularWiperSets(wiperSets);
  } catch {
    return [];
  }
}

function pickPopularWiperSets(wiperSets: WiperSet[]) {
  const preferredSkus = ["WPFP2418", "WPFP2216", "WPFP2616", "WPFP1818", "WPFP2018", "WPFP1614"];
  const bySku = new Map(wiperSets.map((wiperSet) => [wiperSet.sku, wiperSet]));
  const preferred = preferredSkus.map((sku) => bySku.get(sku)).filter((entry): entry is WiperSet => Boolean(entry));
  const fallback = wiperSets.filter((wiperSet) => !preferredSkus.includes(wiperSet.sku)).slice(0, 6 - preferred.length);
  return [...preferred, ...fallback].slice(0, 6);
}

function TrustPill({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex min-h-12 items-center gap-2 rounded-lg border border-white/18 bg-white/12 px-4 text-sm font-black text-white shadow-sm backdrop-blur">
      <span className="text-signal">{icon}</span>
      <span>{text}</span>
    </div>
  );
}

function PopularSkuCard({ wiperSet }: { wiperSet: WiperSet }) {
  return (
    <article className="min-w-[240px] rounded-lg border border-black/10 bg-white p-5 shadow-sm sm:min-w-[260px]">
      <p className="font-mono text-sm font-black text-signal">{wiperSet.sku}</p>
      <h3 className="mt-2 text-lg font-black">{wiperSet.name}</h3>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <MiniSpec label="Long" value={`${wiperSet.driverLengthIn}"`} />
        <MiniSpec label="Short" value={`${wiperSet.passengerLengthIn}"`} />
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-lg font-black">{formatMoney(wiperSet.price)}</p>
        <Link href={`/wipers/${wiperSet.sku}`} className="inline-flex h-10 items-center rounded bg-ink px-3 text-sm font-black text-white hover:bg-black">
          View
        </Link>
      </div>
    </article>
  );
}

function MiniSpec({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-zinc-50 p-3">
      <p className="text-xs font-black uppercase tracking-[0.12em] text-steel">{label}</p>
      <p className="mt-1 text-xl font-black">{value}</p>
    </div>
  );
}

function ContentSection({
  icon,
  title,
  text,
  points
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  points: string[];
}) {
  return (
    <article className="rounded-lg border border-black/10 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-lg bg-signal text-white">{icon}</div>
        <h2 className="text-2xl font-black">{title}</h2>
      </div>
      <p className="mt-4 text-sm font-semibold leading-7 text-steel">{text}</p>
      <div className="mt-5 grid gap-2">
        {points.map((point) => (
          <div key={point} className="flex items-center gap-2 text-sm font-black text-ink">
            <CheckCircle2 className="h-4 w-4 text-signal" />
            <span>{point}</span>
          </div>
        ))}
      </div>
    </article>
  );
}
