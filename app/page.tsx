import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Battery, CheckCircle2, Mail, ShieldCheck, ShoppingCart, Sparkles, Truck, Wrench } from "lucide-react";
import { HomeNewsletterSignup } from "@/components/home-newsletter-signup";
import { WiperFitmentFinder } from "@/components/wiper-fitment-finder";
import { formatMoney } from "@/lib/catalog";
import { productImage } from "@/lib/product-content";
import { wiperPairPricing } from "@/lib/pricing";
import { listProducts } from "@/lib/queries/catalog";
import { listWiperSets } from "@/lib/queries/wiper-commerce";
import type { Product, WiperSet } from "@/lib/types";
import { getWiperSetPreviewImage } from "@/lib/wiper-product-images";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Quality Auto Parts for New Zealand Drivers",
  description:
    "Find the right replacement parts with confidence. Shop premium wiper blades and essential auto maintenance parts from NexAutoParts."
};

export default async function HomePage() {
  const { popularWiperSets, morePartsProducts } = await loadHomeData();
  const popularCards = buildPopularCards(popularWiperSets, morePartsProducts);

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

        <div className="relative mx-auto grid min-h-[calc(100svh-105px)] max-w-7xl content-center gap-7 px-4 py-8 sm:px-6 sm:py-12 lg:min-h-[calc(100vh-73px)] lg:grid-cols-[0.84fr_1.16fr] lg:gap-10 lg:px-8">
          <div className="flex flex-col justify-center text-white">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-white/80 sm:text-sm sm:tracking-[0.18em]">NZ auto parts and wiper fitment</p>
            <h1 className="mt-3 max-w-3xl text-3xl font-black leading-tight sm:mt-4 sm:text-6xl">
              Quality Auto Parts for New Zealand Drivers
            </h1>
            <p className="mt-4 max-w-2xl text-base font-semibold leading-7 text-white/78 sm:mt-5 sm:text-lg sm:leading-8">
              Find the right replacement parts with confidence. From premium wiper blades to essential maintenance components, NexAutoParts makes it easy to keep your vehicle performing at its best.
            </p>

            <div className="mt-6 grid gap-2 sm:mt-8 sm:grid-cols-3 sm:gap-3">
              <TrustPill icon={<Wrench className="h-4 w-4" />} text="Premium Quality" />
              <TrustPill icon={<Truck className="h-4 w-4" />} text="Fast NZ Shipping" />
              <TrustPill icon={<ShieldCheck className="h-4 w-4" />} text="Vehicle Fitment Support" />
            </div>
          </div>

          <div id="vehicle-finder" className="scroll-mt-24 self-center">
            <div className="mb-3 rounded-2xl border border-white/18 bg-white/14 p-3 text-white shadow-lg backdrop-blur sm:p-4">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-signal">Limited launch offer</p>
              <p className="mt-1 text-base font-black sm:text-lg">Save $20 on every front wiper blade pair</p>
              <p className="mt-1 text-xs font-semibold text-white/76 sm:text-sm">$8 shipping waived NZ-wide during the first 3 months.</p>
            </div>
            <WiperFitmentFinder directToProduct />
          </div>
        </div>
      </section>

      <section className="border-b border-black/10 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 sm:py-5 lg:px-8">
          <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
            <div className="rounded-2xl border border-black/10 bg-[#F8FAFC] p-4 shadow-sm sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-signal sm:text-sm sm:tracking-[0.18em]">New categories now live</p>
                  <p className="mt-1 text-base font-black text-ink sm:text-lg">Rear Wipers, Lighting Bundles, Batteries & Oil Filters</p>
                </div>
                <Link href="/shop" className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-ink px-4 text-sm font-black text-white transition hover:-translate-y-0.5 hover:bg-black">
                  Explore More Parts
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <CategoryPill href="/products/premium-rear-wiper-blade" icon={<Wrench className="h-4 w-4" />} label="Rear Wipers" />
              <CategoryPill href="/products/h11-headlight-license-plate-bulb-bundle" icon={<Sparkles className="h-4 w-4" />} label="Lighting Bundles" />
              <CategoryPill href="/products/vehicle-fit-battery" icon={<Battery className="h-4 w-4" />} label="Batteries" />
              <CategoryPill href="/products/vehicle-fit-oil-filter" icon={<ShoppingCart className="h-4 w-4" />} label="Oil Filters" />
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-black/10 bg-[#F8FAFC]">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Popular Products</p>
              <h2 className="mt-2 text-2xl font-black sm:text-3xl">Popular Parts for New Zealand Drivers</h2>
              <p className="mt-2 max-w-2xl text-sm font-bold leading-6 text-steel">
                Front wiper pairs remain the main focus, with new rear wiper, lighting, battery and filter categories now available to browse.
              </p>
            </div>
            <Link href="/shop" className="inline-flex h-11 items-center gap-2 rounded-lg border border-black/10 bg-white px-4 text-sm font-black text-ink shadow-sm transition hover:-translate-y-0.5 hover:border-ink hover:shadow-md">
              View all parts
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:gap-4 sm:px-0">
            {popularCards.map((card) => (
              <PopularCard key={card.id} card={card} />
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-black/10 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="grid gap-5 rounded-2xl border border-black/10 bg-[#F8FAFC] p-4 shadow-panel sm:p-5 lg:grid-cols-[0.85fr_1.15fr] lg:items-center lg:p-7">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Buy More, Save More</p>
              <h2 className="mt-2 text-2xl font-black text-ink sm:text-3xl">Bundle savings for multiple vehicles</h2>
              <p className="mt-3 text-sm font-bold leading-6 text-steel">
                Buying for more than one car? Bundle savings are applied automatically in cart when eligible front wiper blade pairs are added.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              <BundlePrice label="1 Pair" price="$59.99" note="Save $20" />
              <BundlePrice label="2 Pairs" price="$109.99" note="Save up to $50" featured />
              <BundlePrice label="3 Pairs" price="$149.99" note="Save up to $90" />
            </div>
            <div className="lg:col-span-2">
              <Link href="/shop" className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-ink px-4 text-sm font-black text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-black hover:shadow-md sm:w-auto">
                Shop Wiper Blade Pairs
                <ShoppingCart className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-ink text-white">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-12 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-start lg:px-8 lg:py-20">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Keeping New Zealand Moving</p>
            <h2 className="mt-4 text-3xl font-black leading-tight sm:text-5xl">Maintaining your vehicle should not be complicated.</h2>
          </div>
          <div className="space-y-4 text-base font-semibold leading-8 text-white/76 sm:text-lg sm:leading-9">
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
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">More Parts</p>
              <h2 className="mt-2 text-2xl font-black sm:text-3xl">More Parts for New Zealand Drivers</h2>
              <p className="mt-2 max-w-3xl text-sm font-bold leading-6 text-steel">
                Beyond front wiper pairs, NexAutoParts is expanding into rear wipers, lighting bundles, batteries and oil filters.
              </p>
            </div>
            <Link href="/shop" className="inline-flex h-11 items-center gap-2 rounded-lg border border-black/10 bg-white px-4 text-sm font-black text-ink shadow-sm transition hover:-translate-y-0.5 hover:border-ink hover:shadow-md">
              Browse More Parts
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {morePartsProducts.map((product) => (
              <MorePartsCard key={product.id} product={product} />
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-black/10 bg-[#F8FAFC]">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
          <div className="relative min-h-[500px] overflow-hidden rounded-[20px] bg-ink shadow-panel sm:min-h-[460px] lg:min-h-[430px]">
            <Image
              src="/home/parts-support-hero.png"
              alt="Modern vehicle with windscreen wipers and automotive parts support"
              fill
              className="object-cover"
              sizes="(min-width: 1280px) 1216px, 100vw"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/45 to-black/20 sm:bg-gradient-to-r sm:from-black/82 sm:via-black/55 sm:to-black/10" />
            <div className="relative flex min-h-[500px] items-end px-5 py-8 sm:min-h-[460px] sm:items-center sm:px-10 lg:min-h-[430px] lg:px-14">
              <div className="max-w-2xl text-white">
                <h2 className="text-3xl font-black leading-tight sm:text-4xl lg:text-5xl">Need Help Finding the Right Part?</h2>
                <p className="mt-4 text-base font-bold leading-7 text-white/90 sm:mt-5 sm:text-lg sm:leading-8">
                  Can't find the product, image or fitment information you need?
                </p>
                <p className="mt-3 max-w-xl text-sm font-semibold leading-7 text-white/80 sm:text-base sm:leading-8">
                  Send us your vehicle details or part requirements and our team will help confirm the right option.
                </p>
                <Link href="/contact" className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded bg-signal px-5 font-black text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-red-700 sm:mt-8 sm:w-auto">
                  Contact Us
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
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

async function loadHomeData() {
  try {
    const [wiperSets, wiperProducts, bulbProducts, batteryProducts, filterProducts] = await Promise.all([
      listWiperSets(),
      listProducts("wiper"),
      listProducts("bulb"),
      listProducts("battery"),
      listProducts("filter")
    ]);

    return {
      popularWiperSets: pickPopularWiperSets(wiperSets),
      morePartsProducts: pickMorePartsProducts([...wiperProducts, ...bulbProducts, ...batteryProducts, ...filterProducts])
    };
  } catch {
    return { popularWiperSets: [], morePartsProducts: [] };
  }
}

function pickPopularWiperSets(wiperSets: WiperSet[]) {
  const preferredSkus = ["WPFP2418", "WPFP2216", "WPFP2616", "WPFP1818", "WPFP2018", "WPFP1614"];
  const bySku = new Map(wiperSets.map((wiperSet) => [wiperSet.sku, wiperSet]));
  const preferred = preferredSkus.map((sku) => bySku.get(sku)).filter((entry): entry is WiperSet => Boolean(entry));
  const fallback = wiperSets.filter((wiperSet) => !preferredSkus.includes(wiperSet.sku)).slice(0, 6 - preferred.length);
  return [...preferred, ...fallback].slice(0, 6);
}

function pickMorePartsProducts(products: Product[]) {
  const preferredSlugs = [
    "premium-rear-wiper-blade",
    "h11-headlight-license-plate-bulb-bundle",
    "vehicle-fit-battery",
    "vehicle-fit-oil-filter"
  ];
  const bySlug = new Map(products.map((product) => [product.slug, product]));
  return preferredSlugs.map((slug) => bySlug.get(slug)).filter((product): product is Product => Boolean(product));
}

type PopularCardData =
  | { id: string; kind: "wiper"; wiperSet: WiperSet }
  | { id: string; kind: "product"; product: Product };

function buildPopularCards(wiperSets: WiperSet[], morePartsProducts: Product[]) {
  const wiperCards = wiperSets.slice(0, 4).map((wiperSet) => ({ id: wiperSet.id, kind: "wiper" as const, wiperSet }));
  const productCards = morePartsProducts.slice(0, 2).map((product) => ({ id: product.id, kind: "product" as const, product }));
  return [...wiperCards.slice(0, 2), ...productCards, ...wiperCards.slice(2, 4)].slice(0, 6);
}

function TrustPill({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex min-h-11 items-center gap-2 rounded-lg border border-white/18 bg-white/12 px-3 text-xs font-black text-white shadow-sm backdrop-blur sm:min-h-12 sm:px-4 sm:text-sm">
      <span className="text-signal">{icon}</span>
      <span>{text}</span>
    </div>
  );
}

function PopularCard({ card }: { card: PopularCardData }) {
  return card.kind === "wiper" ? <PopularWiperCard wiperSet={card.wiperSet} /> : <PopularProductCard product={card.product} />;
}

function PopularWiperCard({ wiperSet }: { wiperSet: WiperSet }) {
  const image = getWiperSetPreviewImage(wiperSet);
  const compareAtPrice = wiperSet.compareAtPrice ?? wiperPairPricing.compareAtPrice;

  return (
    <Link
      href={`/wipers/${wiperSet.sku}`}
      className="block min-w-[260px] overflow-hidden rounded-xl border border-black/10 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-panel"
    >
      <div className="relative aspect-[4/3] bg-zinc-50">
        <Image src={image} alt={`${wiperSet.name} preview`} fill className="object-contain p-5" sizes="260px" />
        <span className="absolute left-3 top-3 rounded bg-signal px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-white">
          Sale
        </span>
      </div>
      <div className="space-y-3 p-5">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-signal">Front Wiper Pairs</p>
          <h3 className="mt-2 text-xl font-black text-ink">Front Wiper Blade Pair</h3>
          <p className="mt-2 text-sm leading-6 text-steel">
            Driver {wiperSet.driverLengthIn}" + Passenger {wiperSet.passengerLengthIn}" with launch sale pricing and waived NZ shipping.
          </p>
        </div>
        <div className="flex items-center justify-between">
          <span className="flex flex-wrap items-baseline gap-2">
            <span className="text-lg font-black text-ink">{formatMoney(wiperSet.price)}</span>
            <span className="text-xs font-bold text-steel line-through">{formatMoney(compareAtPrice)}</span>
          </span>
          <span className="inline-flex items-center gap-2 text-sm font-black text-ink">
            View Details
            <ArrowRight className="h-4 w-4" />
          </span>
        </div>
      </div>
    </Link>
  );
}

function PopularProductCard({ product }: { product: Product }) {
  const image = productImage(product);
  const isBundle = product.slug === "h11-headlight-license-plate-bulb-bundle";
  const isOutOfStock = product.slug === "vehicle-fit-battery" || product.slug === "vehicle-fit-oil-filter";
  const strap = product.slug === "premium-rear-wiper-blade"
    ? 'Selectable sizes from 8" to 16"'
    : isBundle
      ? "4 x H11 bulbs + licence plate lights"
      : "Contact us to confirm vehicle fitment";

  return (
    <MorePartsCard
      product={product}
      minWidthClass="min-w-[260px]"
      eyebrowOverride={isBundle ? "Lighting Bundles" : undefined}
      badgeOverride={isBundle ? "Bundle" : isOutOfStock ? "Coming Soon" : "New"}
      badgeToneOverride={isBundle ? "bg-signal" : isOutOfStock ? "bg-zinc-700" : "bg-ink"}
      descriptionOverride={isOutOfStock ? "Vehicle-specific matching available via support." : strap}
    />
  );
}

function CategoryPill({
  href,
  icon,
  label
}: {
  href:
    | "/shop"
    | "/products/premium-rear-wiper-blade"
    | "/products/h11-headlight-license-plate-bulb-bundle"
    | "/products/vehicle-fit-battery"
    | "/products/vehicle-fit-oil-filter";
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link href={href} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-black/10 bg-white px-4 text-sm font-black text-ink shadow-sm transition hover:-translate-y-0.5 hover:border-ink hover:shadow-md">
      <span className="text-signal">{icon}</span>
      <span>{label}</span>
    </Link>
  );
}

function MorePartsCard({
  product,
  minWidthClass,
  eyebrowOverride,
  badgeOverride,
  badgeToneOverride,
  descriptionOverride
}: {
  product: Product;
  minWidthClass?: string;
  eyebrowOverride?: string;
  badgeOverride?: string | null;
  badgeToneOverride?: string;
  descriptionOverride?: string;
}) {
  const image = productImage(product);
  const isComingSoon = product.slug === "vehicle-fit-battery" || product.slug === "vehicle-fit-oil-filter";
  const eyebrow =
    eyebrowOverride ??
    (product.slug === "premium-rear-wiper-blade"
      ? "Rear Wipers"
      : product.slug === "h11-headlight-license-plate-bulb-bundle"
        ? "Lighting Bundles"
        : product.slug === "vehicle-fit-battery"
          ? "Batteries"
          : "Oil Filters");
  const badge = badgeOverride ?? (isComingSoon ? "Coming Soon" : null);
  const badgeTone = badgeToneOverride ?? "bg-zinc-700";

  return (
    <article className={`${minWidthClass ?? ""} overflow-hidden rounded-xl border border-black/10 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-panel`}>
      <Link href={`/products/${product.slug}`} className="block">
        <div className="relative aspect-[4/3] bg-zinc-50">
          <Image src={image} alt={product.name} fill className="object-contain p-5" sizes="(min-width: 1280px) 25vw, (min-width: 768px) 50vw, 100vw" />
          {badge ? (
            <span className={`absolute left-3 top-3 rounded px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-white ${badgeTone}`}>
              {badge}
            </span>
          ) : null}
        </div>
        <div className="space-y-3 p-5">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-signal">{eyebrow}</p>
            <h3 className="mt-2 text-xl font-black text-ink">{product.name}</h3>
            <p className="mt-2 text-sm leading-6 text-steel">{descriptionOverride ?? product.description}</p>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-lg font-black text-ink">{formatMoney(product.price)}</span>
            <span className="inline-flex items-center gap-2 text-sm font-black text-ink">
              View Details
              <ArrowRight className="h-4 w-4" />
            </span>
          </div>
        </div>
      </Link>
    </article>
  );
}

function BundlePrice({ label, price, note, featured = false }: { label: string; price: string; note: string; featured?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 sm:p-4 ${featured ? "border-signal bg-white shadow-sm" : "border-black/10 bg-white"}`}>
      <p className="text-xs font-black text-steel sm:text-sm">{label}</p>
      <p className="mt-2 text-lg font-black text-ink sm:text-2xl">{price}</p>
      <p className="mt-1 text-[10px] font-black uppercase tracking-[0.08em] text-signal sm:text-xs sm:tracking-[0.12em]">{note}</p>
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
      <div className={`mx-auto grid max-w-7xl gap-6 px-4 py-10 sm:px-6 lg:grid-cols-2 lg:items-center lg:gap-8 lg:px-8 lg:py-16 ${reverse ? "lg:[&>*:first-child]:order-2" : ""}`}>
        <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-zinc-100 shadow-panel transition hover:-translate-y-1 sm:aspect-[16/10]">
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
          <h2 className="mt-3 text-2xl font-black leading-tight text-ink sm:text-4xl">{title}</h2>
          <p className="mt-3 text-base font-semibold leading-7 text-steel sm:mt-4 sm:leading-8">{text}</p>
          <div className="mt-5 grid gap-3 sm:mt-6">
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
