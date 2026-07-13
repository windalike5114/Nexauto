import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, CheckCircle2, Mail, ShieldCheck, ShoppingCart, Truck, Wrench } from "lucide-react";
import { HomeNewsletterSignup } from "@/components/home-newsletter-signup";
import { WiperFitmentFinder } from "@/components/wiper-fitment-finder";
import { formatMoney } from "@/lib/catalog";
import { wiperPairPricing } from "@/lib/pricing";
import { listWiperSets } from "@/lib/queries/wiper-commerce";
import type { WiperSet } from "@/lib/types";
import { getWiperSetPreviewImage } from "@/lib/wiper-product-images";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Quality Auto Parts for New Zealand Drivers",
  description:
    "Find the right replacement parts with confidence. Shop premium wiper blades and essential auto maintenance parts from NexAutoParts."
};

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
            <p className="text-sm font-black uppercase tracking-[0.18em] text-white/80">NZ auto parts and wiper fitment</p>
            <h1 className="mt-4 max-w-3xl text-4xl font-black leading-tight sm:text-6xl">
              Quality Auto Parts for New Zealand Drivers
            </h1>
            <p className="mt-5 max-w-2xl text-lg font-semibold leading-8 text-white/78">
              Find the right replacement parts with confidence. From premium wiper blades to essential maintenance components, NexAutoParts makes it easy to keep your vehicle performing at its best.
            </p>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              <TrustPill icon={<Wrench className="h-4 w-4" />} text="Premium Quality" />
              <TrustPill icon={<Truck className="h-4 w-4" />} text="Fast NZ Shipping" />
              <TrustPill icon={<ShieldCheck className="h-4 w-4" />} text="Vehicle Fitment Support" />
            </div>
          </div>

          <div id="vehicle-finder" className="scroll-mt-24 self-center">
            <div className="mb-3 rounded-2xl border border-white/18 bg-white/14 p-4 text-white shadow-lg backdrop-blur">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-signal">Limited launch offer</p>
              <p className="mt-1 text-lg font-black">Save $20 on every front wiper blade pair</p>
              <p className="mt-1 text-sm font-semibold text-white/76">$8 shipping waived NZ-wide during the first 3 months.</p>
            </div>
            <WiperFitmentFinder directToProduct />
          </div>
        </div>
      </section>

      <section className="border-b border-black/10 bg-[#F8FAFC]">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Popular Products</p>
              <h2 className="mt-2 text-3xl font-black">Bestselling Front Wiper Blade Pairs</h2>
              <p className="mt-2 max-w-2xl text-sm font-bold leading-6 text-steel">
                On sale now with $20 off front pair pricing and launch shipping waived NZ-wide.
              </p>
            </div>
            <Link href="/shop" className="inline-flex h-11 items-center gap-2 rounded-lg border border-black/10 bg-white px-4 text-sm font-black text-ink shadow-sm transition hover:-translate-y-0.5 hover:border-ink hover:shadow-md">
              View all blade sizes
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

      <section className="border-b border-black/10 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="grid gap-5 rounded-2xl border border-black/10 bg-[#F8FAFC] p-5 shadow-panel lg:grid-cols-[0.85fr_1.15fr] lg:items-center lg:p-7">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Buy More, Save More</p>
              <h2 className="mt-2 text-3xl font-black text-ink">Bundle savings for multiple vehicles</h2>
              <p className="mt-3 text-sm font-bold leading-6 text-steel">
                Buying for more than one car? Bundle savings are applied automatically in cart when eligible front wiper blade pairs are added.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <BundlePrice label="1 Pair" price="$59.99" note="Save $20" />
              <BundlePrice label="2 Pairs" price="$109.99" note="Save up to $50" featured />
              <BundlePrice label="3 Pairs" price="$149.99" note="Save up to $90" />
            </div>
            <div className="lg:col-span-2">
              <Link href="/shop" className="inline-flex h-11 items-center gap-2 rounded-lg bg-ink px-4 text-sm font-black text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-black hover:shadow-md">
                Shop Wiper Blade Pairs
                <ShoppingCart className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-ink text-white">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-16 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-start lg:px-8 lg:py-20">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Keeping New Zealand Moving</p>
            <h2 className="mt-4 text-4xl font-black leading-tight sm:text-5xl">Maintaining your vehicle should not be complicated.</h2>
          </div>
          <div className="space-y-5 text-lg font-semibold leading-9 text-white/76">
            <p>
              At NexAutoParts, we believe maintaining your vehicle should not be complicated or expensive. Whether you are replacing worn wiper blades, servicing your family car, or sourcing reliable replacement parts, we are here to make the process simple.
            </p>
            <p>
              Our goal is to provide quality automotive parts, straightforward vehicle compatibility information, competitive pricing, and dependable customer support. Every order is handled with care because reliable transportation matters.
            </p>
          </div>
        </div>
      </section>

      <div>
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
          background="soft"
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
          background="soft"
        />
      </div>

      <section className="border-t border-black/10 bg-[#F8FAFC]">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
          <div className="max-w-3xl">
            <h2 className="text-3xl font-black leading-tight text-ink sm:text-4xl">Need Help Finding the Right Part?</h2>
            <p className="mt-4 text-base font-bold leading-8 text-steel">
              Can't find the product, image or fitment information you need?
            </p>
            <p className="mt-3 max-w-2xl text-base font-semibold leading-8 text-steel">
              Send us your vehicle details or part requirements and our team will help confirm the right option.
            </p>
          </div>
          <div>
            <Link href="/contact" className="mt-7 inline-flex h-12 items-center gap-2 rounded bg-ink px-5 font-black text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-black">
              Contact Us
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="relative mt-12 aspect-[4/3] overflow-hidden rounded-[20px] bg-zinc-100 shadow-panel sm:mt-14 sm:aspect-[16/7] lg:mt-16 lg:aspect-[1920/650]">
            <Image
              src="/home/parts-support-hero.png"
              alt="Modern vehicle with windscreen wipers and automotive parts support"
              fill
              className="object-cover"
              sizes="(min-width: 1280px) 1216px, 100vw"
            />
          </div>
        </div>
      </section>

      <section className="bg-ink text-white">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-10 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:px-8">
          <div>
            <h2 className="inline-flex items-center gap-2 text-3xl font-black text-white sm:text-4xl">
              <Mail className="h-4 w-4" />
              Keep in the Loop
            </h2>
            <p className="mt-3 max-w-xl text-sm font-bold leading-6 text-white/70">
              Get exclusive offers, new product updates, fitment tips and practical vehicle maintenance guides delivered to your inbox.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/8 p-5 shadow-panel">
            <HomeNewsletterSignup />
            <p className="mt-3 text-xs font-bold leading-5 text-white/60">
              No spam. Unsubscribe anytime.
            </p>
          </div>
        </div>
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
  const image = getWiperSetPreviewImage(wiperSet);
  const compareAtPrice = wiperSet.compareAtPrice ?? wiperPairPricing.compareAtPrice;

  return (
    <article className="min-w-[240px] overflow-hidden rounded-lg border border-black/10 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-panel sm:min-w-[260px]">
      <div className="relative aspect-[4/3] bg-zinc-50">
        <span className="absolute left-3 top-3 z-10 rounded bg-signal px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-white">
          Sale
        </span>
        <Image
          src={image}
          alt={`${wiperSet.name} preview`}
          fill
          className="object-contain p-5"
          sizes="260px"
        />
      </div>
      <div className="p-5">
        <h3 className="text-lg font-black">Front Wiper Blade Pair</h3>
        <p className="mt-2 text-sm font-black text-steel">
          Driver {wiperSet.driverLengthIn}" + Passenger {wiperSet.passengerLengthIn}"
        </p>
        <p className="mt-3 text-xs font-black text-steel">Save $20 - launch shipping waived</p>
        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="flex flex-wrap items-baseline gap-2">
            <span className="text-lg font-black">{formatMoney(wiperSet.price)}</span>
            <span className="text-xs font-bold text-steel line-through">{formatMoney(compareAtPrice)}</span>
          </p>
          <Link href={`/wipers/${wiperSet.sku}`} className="inline-flex h-10 items-center rounded bg-ink px-3 text-sm font-black text-white transition hover:-translate-y-0.5 hover:bg-black">
            View Details
          </Link>
        </div>
      </div>
    </article>
  );
}

function BundlePrice({ label, price, note, featured = false }: { label: string; price: string; note: string; featured?: boolean }) {
  return (
    <div className={`rounded-lg border p-4 ${featured ? "border-signal bg-white shadow-sm" : "border-black/10 bg-white"}`}>
      <p className="text-sm font-black text-steel">{label}</p>
      <p className="mt-2 text-2xl font-black text-ink">{price}</p>
      <p className="mt-1 text-xs font-black uppercase tracking-[0.12em] text-signal">{note}</p>
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
  reverse = false,
  background = "white"
}: {
  eyebrow: string;
  title: string;
  text: string;
  image: string;
  imageAlt: string;
  points: string[];
  reverse?: boolean;
  background?: "white" | "soft";
}) {
  return (
    <section className={`border-b border-black/10 ${background === "soft" ? "bg-[#F8FAFC]" : "bg-white"}`}>
      <div className={`mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-2 lg:items-center lg:px-8 lg:py-16 ${reverse ? "lg:[&>*:first-child]:order-2" : ""}`}>
        <div className="relative aspect-[16/10] overflow-hidden rounded-lg bg-zinc-100 shadow-panel transition hover:-translate-y-1">
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
