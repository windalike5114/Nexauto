import Image from "next/image";
import Link from "next/link";
import { ArrowRight, CheckCircle2, ShieldCheck, Truck, Wrench } from "lucide-react";
import { WiperFitmentFinder } from "@/components/wiper-fitment-finder";
import { formatMoney } from "@/lib/catalog";
import { listWiperSets } from "@/lib/queries/wiper-commerce";
import type { WiperSet } from "@/lib/types";
import { getWiperSetPreviewImage } from "@/lib/wiper-product-images";

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

      <div className="bg-white">
        <FeatureSection
          eyebrow="Premium Performance"
          title="Premium Beam Wiper Blades"
          text="Engineered for smooth, quiet and streak-free wiping in all weather conditions."
          image="/home/premium-performance.png"
          imageAlt="Close-up of beam wiper blades clearing rain from a windshield"
          points={["High-toughness memory steel", "Premium natural rubber", "Long-lasting performance"]}
        />
        <FeatureSection
          eyebrow="Built for NZ Roads"
          title="Designed for New Zealand Driving"
          text="Reliable performance through rain, frost and changing weather conditions."
          image="/home/nz-roads.png"
          imageAlt="Vehicle driving on a wet New Zealand road"
          points={["All-season durability", "Heat & frost resistant", "Even pressure across the windshield"]}
          reverse
        />
        <FeatureSection
          eyebrow="Perfect Fit, Every Time"
          title="Vehicle-Matched Fitment"
          text="Simply select your vehicle and we'll match the correct blades and adapters automatically."
          image="/home/vehicle-fitment.png"
          imageAlt="Wiper blade adapter and connector installation detail"
          points={["Up to 17 adapter types", "Fits 99% of vehicles", "No guesswork required"]}
        />
        <FeatureSection
          eyebrow="Local Service You Can Trust"
          title="Proudly Based in New Zealand"
          text="Fast local dispatch with friendly support from a NZ-based team."
          image="/home/local-service.png"
          imageAlt="Local warehouse packing wiper blades for dispatch"
          points={["NZ local business", "Fast nationwide shipping", "Responsive customer support"]}
          reverse
        />
      </div>
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
  const image = getWiperSetPreviewImage(wiperSet);

  return (
    <article className="min-w-[240px] overflow-hidden rounded-lg border border-black/10 bg-white shadow-sm sm:min-w-[260px]">
      <div className="relative aspect-[4/3] bg-zinc-50">
        <Image
          src={image}
          alt={`${wiperSet.name} preview`}
          fill
          className="object-contain p-5"
          sizes="260px"
        />
      </div>
      <div className="p-5">
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

function FeatureSection({
  eyebrow,
  title,
  text,
  image,
  imageAlt,
  points,
  reverse = false
}: {
  eyebrow: string;
  title: string;
  text: string;
  image: string;
  imageAlt: string;
  points: string[];
  reverse?: boolean;
}) {
  return (
    <section className="border-b border-black/10">
      <div className={`mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-2 lg:items-center lg:px-8 lg:py-16 ${reverse ? "lg:[&>*:first-child]:order-2" : ""}`}>
        <div className="relative aspect-[16/10] overflow-hidden rounded-lg bg-zinc-100 shadow-panel">
          <Image
            src={image}
            alt={imageAlt}
            fill
            className="object-cover"
            sizes="(min-width: 1024px) 50vw, 100vw"
          />
        </div>

        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">{eyebrow}</p>
          <h2 className="mt-3 text-3xl font-black leading-tight text-ink sm:text-4xl">{title}</h2>
          <p className="mt-4 text-base font-semibold leading-8 text-steel">{text}</p>
          <div className="mt-6 grid gap-3">
            {points.map((point) => (
              <div key={point} className="flex items-center gap-3 text-sm font-black text-ink">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-signal text-white">
                  <CheckCircle2 className="h-4 w-4" />
                </span>
                <span>{point}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
