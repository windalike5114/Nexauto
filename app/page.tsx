import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Headphones, Mail, PackageCheck, SearchCheck, Truck } from "lucide-react";
import { HomeNewsletterSignup } from "@/components/home-newsletter-signup";
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

const guides = [
  { title: "How to Find the Correct Wiper Size", href: "/blog/how-to-find-correct-wiper-blade-size", label: "Wiper guide" },
  { title: "How to Check if a Part Fits Your Vehicle", href: "/blog/how-to-check-if-an-auto-part-fits-your-vehicle", label: "Fitment guide" },
  { title: "Wiper Installation Guides", href: "/wiper-installation-guides", label: "Installation" }
] as const;

export default async function HomePage() {
  const { wiperSets, products } = await loadHomeData();
  const featured = buildFeatured(wiperSets, products);

  return (
    <main className="bg-white">
      <section className="relative isolate overflow-hidden bg-black text-white">
        <Image src="/home/parts-hero-v2.png" alt="NexAutoParts wipers, oil filter, light bulbs, battery and control arm" fill priority className="-z-20 object-cover object-center" sizes="100vw" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-black via-black/88 to-black/10" />
        <div className="mx-auto flex min-h-[430px] max-w-7xl items-center px-4 py-12 sm:min-h-[480px] sm:px-6 lg:px-8">
          <div className="max-w-xl">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-signal sm:text-sm">Automotive parts for New Zealand</p>
            <h1 className="mt-4 text-4xl font-black leading-[0.98] sm:text-6xl">Parts that fit.<br />Service you can trust.</h1>
            <p className="mt-5 max-w-lg text-base font-semibold leading-7 text-white/78 sm:text-lg">
              Shop dependable replacement parts, or start with your vehicle and let each product category confirm the details it needs.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Link href="/shop" className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-signal px-6 font-black text-white shadow-lg shadow-red-950/30 hover:bg-red-700">
                Shop Parts <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="#vehicle-finder" className="inline-flex h-12 items-center justify-center rounded-lg border border-white/35 bg-white/10 px-6 font-black text-white backdrop-blur hover:bg-white/18">
                Find Parts for My Vehicle
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section id="vehicle-finder" className="scroll-mt-40 border-b border-black/10 bg-[#EEF2F5]">
        <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8"><VehiclePartsFinder /></div>
      </section>

      <section id="part-categories" className="scroll-mt-40 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Shop by category</p>
              <h2 className="mt-2 text-3xl font-black sm:text-4xl">Everything starts with the right part.</h2>
            </div>
            <Link href="/shop" className="inline-flex items-center gap-2 text-sm font-black text-ink hover:text-signal">Shop all products <ArrowRight className="h-4 w-4" /></Link>
          </div>
          <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {categories.map((category) => <CategoryCard key={category.href} {...category} />)}
          </div>
        </div>
      </section>

      <section className="border-y border-black/10 bg-[#F8FAFC]">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Ready to order</p>
              <h2 className="mt-2 text-3xl font-black sm:text-4xl">Popular products</h2>
              <p className="mt-2 text-sm font-bold text-steel">Only current product listings are shown here.</p>
            </div>
            <Link href="/shop" className="hidden items-center gap-2 text-sm font-black sm:inline-flex">View all <ArrowRight className="h-4 w-4" /></Link>
          </div>
          {featured.length ? (
            <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {featured.map((item) => <FeaturedCard key={item.id} item={item} />)}
            </div>
          ) : <p className="mt-7 rounded-xl border border-black/10 bg-white p-6 font-bold text-steel">Products are being updated. Contact us for current availability.</p>}
        </div>
      </section>

      <section className="bg-ink text-white">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[1fr_auto] lg:items-center lg:px-8 lg:py-12">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-signal">Wiper launch offer</p>
            <h2 className="mt-2 text-3xl font-black">Front wiper pairs from {formatMoney(wiperPairPricing.salePrice)}</h2>
            <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-white/70">Choose your vehicle first for confirmed blade lengths, body or chassis details, and the appropriate adapter.</p>
          </div>
          <Link href="/parts/wipers" className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-signal px-6 font-black text-white hover:bg-red-700">Find My Wipers <ArrowRight className="h-4 w-4" /></Link>
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
          <p className="text-sm font-black uppercase tracking-[0.18em] text-signal">Buying and installation guides</p>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            {guides.map((guide) => (
              <Link key={guide.href} href={guide.href} className="group rounded-xl border border-black/10 bg-white p-5 shadow-sm hover:-translate-y-0.5 hover:shadow-panel">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-signal">{guide.label}</p>
                <h3 className="mt-3 text-xl font-black">{guide.title}</h3>
                <span className="mt-5 inline-flex items-center gap-2 text-sm font-black">Read guide <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" /></span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="relative overflow-hidden rounded-2xl bg-ink px-6 py-10 text-white shadow-panel sm:px-10 lg:px-12">
            <div className="absolute inset-0 opacity-20"><Image src="/home/parts-support-hero.png" alt="" fill className="object-cover" sizes="100vw" /></div>
            <div className="relative max-w-2xl">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-signal">Fitment help</p>
              <h2 className="mt-2 text-3xl font-black sm:text-4xl">Can’t find the exact part?</h2>
              <p className="mt-3 text-base font-semibold leading-7 text-white/78">Send your vehicle, engine, chassis or existing part number. We will tell you what else is needed before suggesting a match.</p>
              <Link href="/contact" className="mt-6 inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-white px-5 font-black text-ink hover:bg-zinc-100">Request Fitment Help <ArrowRight className="h-4 w-4" /></Link>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-ink text-white">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-10 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:px-8">
          <div><h2 className="inline-flex items-center gap-2 text-3xl font-black"><Mail className="h-5 w-5" /> Keep in the Loop</h2><p className="mt-3 text-sm font-bold leading-6 text-white/70">Product updates, fitment tips and useful maintenance guides.</p></div>
          <div className="rounded-2xl border border-white/10 bg-white/8 p-5"><HomeNewsletterSignup /></div>
        </div>
      </section>
    </main>
  );
}

function CategoryCard({ title, description, href, image }: { title: string; description: string; href: string; image: string }) {
  return (
    <Link href={href as never} className="group relative isolate min-h-[260px] overflow-hidden rounded-2xl bg-ink shadow-sm">
      <Image src={image} alt={`${title} category`} fill className="-z-20 object-cover transition duration-500 group-hover:scale-[1.03]" sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-t from-black via-black/35 to-transparent" />
      <div className="flex min-h-[260px] flex-col justify-end p-5 text-white sm:p-6">
        <h3 className="text-2xl font-black">{title}</h3>
        <p className="mt-2 max-w-sm text-sm font-semibold leading-6 text-white/75">{description}</p>
        <span className="mt-4 inline-flex items-center gap-2 text-sm font-black">Explore <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" /></span>
      </div>
    </Link>
  );
}

type FeaturedItem = { id: string; kind: "wiper"; item: WiperSet } | { id: string; kind: "product"; item: Product };

function FeaturedCard({ item }: { item: FeaturedItem }) {
  const card = item.kind === "wiper"
    ? {
        image: getWiperSetPreviewImage(item.item),
        href: `/wipers/${item.item.sku}`,
        name: `Front Wiper Pair ${item.item.driverLengthIn}\" + ${item.item.passengerLengthIn}\"`,
        eyebrow: "Wiper Blades",
        price: item.item.price
      }
    : {
        image: productImage(item.item),
        href: `/products/${item.item.slug}`,
        name: item.item.name,
        eyebrow: item.item.category === "bulb" ? "Light Bulbs" : "Rear Wipers",
        price: item.item.price
      };
  return (
    <Link href={card.href as never} className="group overflow-hidden rounded-xl border border-black/10 bg-white shadow-sm hover:-translate-y-0.5 hover:shadow-panel">
      <div className="relative aspect-[4/3] bg-zinc-100"><Image src={card.image} alt={card.name} fill className="object-contain p-4 transition group-hover:scale-[1.03]" sizes="(min-width: 1024px) 25vw, 50vw" /></div>
      <div className="p-4"><p className="text-[11px] font-black uppercase tracking-[0.14em] text-signal">{card.eyebrow}</p><h3 className="mt-2 min-h-12 text-base font-black leading-6">{card.name}</h3><div className="mt-3 flex items-center justify-between"><span className="text-lg font-black">{formatMoney(card.price)}</span><ArrowRight className="h-4 w-4" /></div></div>
    </Link>
  );
}

function TrustCard({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return <article className="rounded-xl border border-black/10 bg-white p-5"><span className="grid h-10 w-10 place-items-center rounded-lg bg-signal text-white">{icon}</span><h3 className="mt-4 text-lg font-black">{title}</h3><p className="mt-2 text-sm font-semibold leading-6 text-steel">{text}</p></article>;
}

async function loadHomeData() {
  try {
    const [wiperSets, products] = await Promise.all([listWiperSets(), listProducts()]);
    return { wiperSets, products };
  } catch {
    return { wiperSets: [] as WiperSet[], products: [] as Product[] };
  }
}

function buildFeatured(wiperSets: WiperSet[], products: Product[]): FeaturedItem[] {
  const preferredWipers = ["WPFP2418", "WPFP2216"]
    .map((sku) => wiperSets.find((item) => item.sku === sku))
    .filter((item): item is WiperSet => Boolean(item))
    .map((item) => ({ id: item.id, kind: "wiper" as const, item }));
  const currentProducts = products
    .filter((item) => !["vehicle-fit-battery", "vehicle-fit-oil-filter"].includes(item.slug))
    .slice(0, 2)
    .map((item) => ({ id: item.id, kind: "product" as const, item }));
  return [...preferredWipers, ...currentProducts].slice(0, 4);
}
