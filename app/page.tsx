import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, BatteryCharging, Eye, Gauge, Headphones, Mail, PackageCheck, SearchCheck, Truck, Wrench } from "lucide-react";
import { HomeNewsletterSignup } from "@/components/home-newsletter-signup";
import { HomeHeroCarousel } from "@/components/home-hero-carousel";
import { HomeProductTabs, type ProductTabGroup, type StorefrontProductCard } from "@/components/home-product-tabs";
import { ScrollReveal } from "@/components/scroll-reveal";
import { VehiclePartsFinder } from "@/components/vehicle-parts-finder";
import { formatMoney } from "@/lib/catalog";
import { productImage } from "@/lib/product-content";
import { wiperPairPricing } from "@/lib/pricing";
import { listProducts } from "@/lib/queries/catalog";
import { listWiperSets } from "@/lib/queries/wiper-commerce";
import type { Product, WiperSet } from "@/lib/types";
import { getWiperSetPreviewImage } from "@/lib/wiper-product-images";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Auto Parts for New Zealand Drivers",
  description: "Shop wiper blades, oil filters, light bulbs, batteries and control arms with vehicle fitment support from NexAutoParts."
};

const categories = [
  { title: "Wiper Blades", description: "Front pairs, rear blades and fitting support", href: "/parts/wipers", image: "/products/wiper-blade.png" },
  { title: "Oil Filters", description: "Engine-specific filters and part-number matching", href: "/parts/filters", image: "/products/vehicle-oil-filter.png" },
  { title: "Light Bulbs", description: "Headlight, fog and exterior replacement bulbs", href: "/parts/bulbs", image: "/products/halogen-bulb.png" },
  { title: "Batteries", description: "Case size, terminal layout, Ah and CCA matching", href: "/parts/batteries", image: "/products/vehicle-battery.png" },
  { title: "Control Arms", description: "Position-specific arms, ball joints and bushes", href: "/parts/suspension", image: "/products/control-arm-v2.png" },
  { title: "Need Help Finding a Part?", description: "Send your vehicle and part details for confirmation", href: "/contact", image: "/home/parts-support-hero.png" }
] as const;

const needs = [
  { title: "Improve visibility", description: "Clearer wet-weather driving with correctly sized wipers.", href: "/parts/wipers", action: "Shop wipers", icon: Eye },
  { title: "Routine engine service", description: "Start with the vehicle, then confirm the engine-specific filter.", href: "/parts/filters", action: "Find filters", icon: Gauge },
  { title: "Starting problems", description: "Match case size, terminal layout, Ah and cold-cranking amps.", href: "/parts/batteries", action: "Check batteries", icon: BatteryCharging },
  { title: "Suspension noise", description: "Identify the axle, side and exact control-arm position first.", href: "/parts/suspension", action: "Find suspension parts", icon: Wrench }
] as const;

const guides = [
  { title: "How to Find the Correct Wiper Size", href: "/blog/how-to-find-correct-wiper-blade-size", label: "Wiper guide" },
  { title: "How to Check if a Part Fits Your Vehicle", href: "/blog/how-to-check-if-an-auto-part-fits-your-vehicle", label: "Fitment guide" },
  { title: "Wiper Installation Guides", href: "/wiper-installation-guides", label: "Installation" }
] as const;

export default async function HomePage() {
  const { wiperSets, products } = await loadHomeData();
  const productGroups = buildProductGroups(wiperSets, products);
  const featuredWiper = preferredWipers(wiperSets, 1)[0];
  const bulbBundle = products.find((item) => item.slug === "h11-headlight-license-plate-bulb-bundle");
  const hasDeals = Boolean(featuredWiper || bulbBundle);

  return (
    <main className="bg-white">
      <HomeHeroCarousel />

      <section id="vehicle-finder" className="scroll-mt-40 border-b border-black/10 bg-[#EEF2F5]">
        <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8"><VehiclePartsFinder /></div>
      </section>

      <section id="part-categories" className="scroll-mt-40 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
          <ScrollReveal>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div><p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Shop by category</p><h2 className="mt-2 text-3xl font-black sm:text-4xl">Everything starts with the right part.</h2></div>
              <Link href="/shop" className="inline-flex items-center gap-2 text-sm font-black text-ink hover:text-signal">Shop all products <ArrowRight className="h-4 w-4" /></Link>
            </div>
          </ScrollReveal>
          <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {categories.map((category, index) => <ScrollReveal key={category.href} delayMs={index * 60}><CategoryCard {...category} /></ScrollReveal>)}
          </div>
        </div>
      </section>

      {hasDeals ? <section className="border-y border-black/10 bg-[#F3F5F7]">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
          <ScrollReveal>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div><p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Weekly Deals</p><h2 className="mt-2 text-3xl font-black sm:text-4xl">Useful parts. Better value this week.</h2><p className="mt-2 text-sm font-bold text-steel">Current offers use real products and prices from our catalogue.</p></div>
              <Link href="/specials" className="inline-flex items-center gap-2 text-sm font-black text-ink hover:text-signal">View All Weekly Deals <ArrowRight className="h-4 w-4" /></Link>
            </div>
          </ScrollReveal>
          <div className="mt-7 grid gap-4 lg:grid-cols-2">
            {featuredWiper ? <ScrollReveal><DealBanner eyebrow="Wiper bundle offer" title={`Two front wiper pairs for ${formatMoney(wiperPairPricing.bundleTotals[2])}`} description={`Choose any two eligible front wiper pairs. Save ${formatMoney(wiperPairPricing.salePrice * 2 - wiperPairPricing.bundleTotals[2])} against two current single-pair prices.`} href="/parts/wipers" action="Choose my wipers" image={getWiperSetPreviewImage(featuredWiper)} /></ScrollReveal> : null}
            {bulbBundle ? <ScrollReveal delayMs={80}><DealBanner eyebrow="Bulb bundle offer" title={bulbBundle.name} description={`A current lighting bundle at ${formatMoney(bulbBundle.price)}. Product contents and specifications are shown on the detail page.`} href={`/products/${bulbBundle.slug}`} action="View bulb bundle" image={productImage(bulbBundle)} /></ScrollReveal> : null}
          </div>
        </div>
      </section> : null}

      {productGroups.some((group) => group.items.length > 0) ? <section className="bg-white">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
          <ScrollReveal><div><p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Shop current products</p><h2 className="mt-2 text-3xl font-black sm:text-4xl">Choose what you need next.</h2><p className="mt-2 text-sm font-bold text-steel">Current products, newly listed items and genuine offers from our catalogue.</p></div></ScrollReveal>
          <ScrollReveal delayMs={80} className="mt-7"><HomeProductTabs groups={productGroups} /></ScrollReveal>
        </div>
      </section> : null}

      <section className="border-y border-black/10 bg-[#F8FAFC]">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
          <ScrollReveal><p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Shop by maintenance need</p><h2 className="mt-2 text-3xl font-black sm:text-4xl">What does your car need today?</h2></ScrollReveal>
          <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {needs.map((need, index) => {
              const Icon = need.icon;
              return <ScrollReveal key={need.title} delayMs={index * 60}><Link href={need.href as never} className="group block h-full rounded-xl border border-black/10 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:border-signal/40 hover:shadow-panel"><span className="grid h-11 w-11 place-items-center rounded-lg bg-ink text-white"><Icon className="h-5 w-5" /></span><h3 className="mt-5 text-xl font-black">{need.title}</h3><p className="mt-2 min-h-[72px] text-sm font-semibold leading-6 text-steel">{need.description}</p><span className="mt-5 inline-flex items-center gap-2 text-sm font-black text-signal">{need.action} <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" /></span></Link></ScrollReveal>;
            })}
          </div>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto grid max-w-7xl gap-4 px-4 py-10 sm:grid-cols-2 sm:px-6 lg:grid-cols-4 lg:px-8 lg:py-14">
          <TrustCard icon={<SearchCheck className="h-5 w-5" />} title="Fitment support" text="Category-specific checks before a compatibility claim." />
          <TrustCard icon={<PackageCheck className="h-5 w-5" />} title="Clear product details" text="Pack quantity, size and key specifications shown upfront." />
          <TrustCard icon={<Truck className="h-5 w-5" />} title="NZ-wide delivery" text="Dispatch and delivery details shown by product type." />
          <TrustCard icon={<Headphones className="h-5 w-5" />} title="Local help" text="Auckland-based support when more vehicle detail is needed." />
        </div>
      </section>

      <section className="border-y border-black/10 bg-[#F8FAFC]">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <ScrollReveal><p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Buying and installation guides</p><div className="mt-5 grid gap-4 md:grid-cols-3">{guides.map((guide) => <Link key={guide.href} href={guide.href} className="group rounded-xl border border-black/10 bg-white p-5 shadow-sm hover:-translate-y-0.5 hover:shadow-panel"><p className="text-xs font-black uppercase tracking-[0.14em] text-signal">{guide.label}</p><h3 className="mt-3 text-xl font-black">{guide.title}</h3><span className="mt-5 inline-flex items-center gap-2 text-sm font-black">Read guide <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" /></span></Link>)}</div></ScrollReveal>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8"><ScrollReveal><div className="relative overflow-hidden rounded-2xl bg-ink px-6 py-10 text-white shadow-panel sm:px-10 lg:px-12"><div className="absolute inset-0 opacity-20"><Image src="/home/parts-support-hero.png" alt="" fill className="object-cover" sizes="100vw" /></div><div className="relative max-w-2xl"><p className="text-xs font-black uppercase tracking-[0.18em] text-signal">Fitment help</p><h2 className="mt-2 text-3xl font-black sm:text-4xl">Can’t find the exact part?</h2><p className="mt-3 text-base font-semibold leading-7 text-white/78">Send your vehicle, engine, chassis or existing part number. We will tell you what else is needed before suggesting a match.</p><Link href="/contact" className="mt-6 inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-white px-5 font-black text-ink hover:bg-zinc-100">Request Fitment Help <ArrowRight className="h-4 w-4" /></Link></div></div></ScrollReveal></div>
      </section>

      <section className="bg-ink text-white"><div className="mx-auto grid max-w-7xl gap-6 px-4 py-10 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:px-8"><div><h2 className="inline-flex items-center gap-2 text-3xl font-black"><Mail className="h-5 w-5" /> Keep in the Loop</h2><p className="mt-3 text-sm font-bold leading-6 text-white/70">Product updates, fitment tips and useful maintenance guides.</p></div><div className="rounded-2xl border border-white/10 bg-white/8 p-5"><HomeNewsletterSignup /></div></div></section>
    </main>
  );
}

function CategoryCard({ title, description, href, image }: { title: string; description: string; href: string; image: string }) {
  return <Link href={href as never} className="group relative isolate block min-h-[260px] overflow-hidden rounded-2xl bg-ink shadow-sm"><Image src={image} alt={`${title} category`} fill className="-z-20 object-cover transition duration-500 group-hover:scale-[1.03]" sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" /><div className="absolute inset-0 -z-10 bg-gradient-to-t from-black via-black/35 to-transparent" /><div className="flex min-h-[260px] flex-col justify-end p-5 text-white sm:p-6"><h3 className="text-2xl font-black">{title}</h3><p className="mt-2 max-w-sm text-sm font-semibold leading-6 text-white/75">{description}</p><span className="mt-4 inline-flex items-center gap-2 text-sm font-black">Explore <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" /></span></div></Link>;
}

function DealBanner({ eyebrow, title, description, href, action, image }: { eyebrow: string; title: string; description: string; href: string; action: string; image: string }) {
  return <article className="group relative isolate min-h-[300px] overflow-hidden rounded-2xl bg-ink text-white shadow-panel"><Image src={image} alt="" fill className="-z-20 object-contain object-right p-4 opacity-75 transition duration-500 group-hover:scale-[1.03] sm:p-7" sizes="(min-width: 1024px) 50vw, 100vw" /><div className="absolute inset-0 -z-10 bg-gradient-to-r from-black via-black/90 to-black/20" /><div className="flex min-h-[300px] max-w-[70%] flex-col justify-center p-6 sm:p-8"><p className="text-xs font-black uppercase tracking-[0.18em] text-signal">{eyebrow}</p><h3 className="mt-3 text-2xl font-black leading-tight sm:text-3xl">{title}</h3><p className="mt-3 text-sm font-semibold leading-6 text-white/72">{description}</p><Link href={href as never} className="mt-6 inline-flex w-fit items-center gap-2 rounded-lg bg-white px-4 py-3 text-sm font-black text-ink hover:bg-zinc-100">{action} <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" /></Link></div></article>;
}

function TrustCard({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return <ScrollReveal><article className="h-full rounded-xl border border-black/10 bg-white p-5"><span className="grid h-10 w-10 place-items-center rounded-lg bg-signal text-white">{icon}</span><h3 className="mt-4 text-lg font-black">{title}</h3><p className="mt-2 text-sm font-semibold leading-6 text-steel">{text}</p></article></ScrollReveal>;
}

async function loadHomeData() {
  try {
    const [wiperSets, products] = await Promise.all([listWiperSets(), listProducts()]);
    return { wiperSets, products };
  } catch {
    return { wiperSets: [] as WiperSet[], products: [] as Product[] };
  }
}

function buildProductGroups(wiperSets: WiperSet[], products: Product[]): ProductTabGroup[] {
  const sellableProducts = products.filter((item) => !["vehicle-fit-battery", "vehicle-fit-oil-filter"].includes(item.slug));
  const featuredWiperCards = preferredWipers(wiperSets, 4).map((item) => toWiperCard(item));
  const productCards = sellableProducts.map((item) => toProductCard(item));
  const bulbBundle = sellableProducts.find((item) => item.slug === "h11-headlight-license-plate-bulb-bundle");
  const dealWipers = preferredWipers(wiperSets, 3).map((item) => toWiperCard(item, "Weekly deal"));
  const dealProducts = bulbBundle ? [toProductCard(bulbBundle, "Bundle offer")] : [];
  return [
    { id: "featured", label: "Featured", items: [...featuredWiperCards.slice(0, 3), ...productCards.slice(0, 3)].slice(0, 6) },
    { id: "new", label: "New Arrivals", items: productCards.slice(0, 8) },
    { id: "deals", label: "Weekly Deals", items: [...dealWipers, ...dealProducts].slice(0, 8) }
  ];
}

function preferredWipers(wiperSets: WiperSet[], limit: number) {
  const preferredSkus = ["WPFP2418", "WPFP2216", "WPFP2616", "WPFP2420", "WPFP2618", "WPFP2220"];
  const preferred = preferredSkus.map((sku) => wiperSets.find((item) => item.sku === sku)).filter((item): item is WiperSet => Boolean(item));
  return [...preferred, ...wiperSets.filter((item) => !preferredSkus.includes(item.sku))].slice(0, limit);
}

function toWiperCard(item: WiperSet, badge?: string): StorefrontProductCard {
  return { id: item.id, href: `/wipers/${item.sku}`, image: getWiperSetPreviewImage(item), eyebrow: "Wiper Blades", title: `Front Wiper Pair ${item.driverLengthIn}\" + ${item.passengerLengthIn}\"`, price: item.price, compareAtPrice: item.compareAtPrice, badge };
}

function toProductCard(item: Product, badge?: string): StorefrontProductCard {
  return { id: item.id, href: `/products/${item.slug}`, image: productImage(item), eyebrow: item.category === "bulb" ? "Light Bulbs" : "Rear Wipers", title: item.name, price: item.price, badge };
}
