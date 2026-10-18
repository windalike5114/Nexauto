import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, CarFront } from "lucide-react";
import { formatMoney } from "@/lib/catalog";
import { productImage } from "@/lib/product-content";
import { wiperPairPricing } from "@/lib/pricing";
import { listProducts } from "@/lib/queries/catalog";
import { listWiperSets } from "@/lib/queries/wiper-commerce";
import type { Product, WiperSet } from "@/lib/types";
import { getWiperSetPreviewImage } from "@/lib/wiper-product-images";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Weekly Deals", description: "Current NexAutoParts weekly offers and value bundles." };

const filters = [
  ["all", "All deals"],
  ["wipers", "Wiper Blades"],
  ["bulbs", "Light Bulbs"],
  ["filters", "Oil Filters"],
  ["batteries", "Batteries"],
  ["suspension", "Control Arms"]
] as const;

type DealCategory = (typeof filters)[number][0];

export default async function SpecialsPage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  const { category } = await searchParams;
  const activeCategory = filters.some(([value]) => value === category) ? category as DealCategory : "all";
  const { wipers, bulbs } = await loadSpecials();
  const showWipers = activeCategory === "all" || activeCategory === "wipers";
  const showBulbs = activeCategory === "all" || activeCategory === "bulbs";
  const resultCount = (showWipers ? wipers.length : 0) + (showBulbs ? bulbs.length : 0);

  return (
    <main className="min-h-[70vh] bg-[#F8FAFC]">
      <section className="bg-ink text-white">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-signal">Current offers</p>
          <h1 className="mt-2 text-4xl font-black sm:text-5xl">Weekly Deals</h1>
          <p className="mt-3 max-w-2xl text-base font-semibold leading-7 text-white/70">Only real products with a current offer or bundle are shown. Empty categories stay empty until a genuine deal is available.</p>
          <Link href="/#vehicle-finder" className="mt-6 inline-flex items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-4 py-3 text-sm font-black hover:bg-white/15"><CarFront className="h-4 w-4 text-signal" /> Choose a vehicle before checking fitment</Link>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
        <nav className="flex gap-2 overflow-x-auto pb-2" aria-label="Weekly deal categories">
          {filters.map(([value, label]) => <Link key={value} href={value === "all" ? "/specials" : `/specials?category=${value}`} aria-current={activeCategory === value ? "page" : undefined} className={`shrink-0 rounded-full px-4 py-2 text-sm font-black ${activeCategory === value ? "bg-ink text-white" : "border border-black/10 bg-white text-steel hover:text-ink"}`}>{label}</Link>)}
        </nav>

        {resultCount > 0 ? <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {showWipers ? wipers.map((item) => <SpecialCard key={item.id} href={`/wipers/${item.sku}`} image={getWiperSetPreviewImage(item)} eyebrow="Wiper offer" title={`Front Wiper Pair ${item.driverLengthIn}\" + ${item.passengerLengthIn}\"`} price={item.price} compareAt={item.compareAtPrice ?? wiperPairPricing.compareAtPrice} />) : null}
          {showBulbs ? bulbs.map((item) => <SpecialCard key={item.id} href={`/products/${item.slug}`} image={productImage(item)} eyebrow="Lighting bundle" title={item.name} price={item.price} />) : null}
        </div> : <div className="mt-7 rounded-2xl border border-dashed border-black/20 bg-white px-6 py-12 text-center"><h2 className="text-2xl font-black">No weekly deal in this category</h2><p className="mx-auto mt-2 max-w-lg text-sm font-semibold leading-6 text-steel">We do not add placeholder products just to fill the page. Browse the current catalogue or check again when a genuine offer is available.</p><Link href="/shop" className="mt-5 inline-flex items-center gap-2 text-sm font-black text-signal">Browse current products <ArrowRight className="h-4 w-4" /></Link></div>}

        <div className="mt-10 rounded-xl border border-black/10 bg-white p-5 text-sm font-semibold leading-6 text-steel"><strong className="text-ink">How fitment works:</strong> choose your vehicle first, then open the product to confirm the category-specific details. Wipers use the current vehicle fitment database; other categories request the extra information they need rather than making an unsupported compatibility claim.</div>
      </section>
    </main>
  );
}

async function loadSpecials() {
  try {
    const [wipers, bulbs] = await Promise.all([listWiperSets(), listProducts("bulb")]);
    const preferred = ["WPFP2418", "WPFP2216", "WPFP2616"].map((sku) => wipers.find((item) => item.sku === sku)).filter((item): item is WiperSet => Boolean(item));
    const bundle = bulbs.filter((item) => item.slug === "h11-headlight-license-plate-bulb-bundle").slice(0, 1);
    return { wipers: preferred, bulbs: bundle };
  } catch {
    return { wipers: [] as WiperSet[], bulbs: [] as Product[] };
  }
}

function SpecialCard({ href, image, eyebrow, title, price, compareAt }: { href: string; image: string; eyebrow: string; title: string; price: number; compareAt?: number | null }) {
  const saving = compareAt && compareAt > price ? compareAt - price : 0;
  return <Link href={href as never} className="group overflow-hidden rounded-xl border border-black/10 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-panel"><div className="relative aspect-[4/3] bg-zinc-100"><span className="absolute left-3 top-3 z-10 rounded bg-signal px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-white">Weekly deal</span><Image src={image} alt={title} fill className="object-contain p-4 transition duration-300 group-hover:scale-[1.03]" sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw" /></div><div className="p-4"><p className="text-xs font-black uppercase tracking-[0.14em] text-signal">{eyebrow}</p><h2 className="mt-2 min-h-12 text-lg font-black">{title}</h2><div className="mt-4 flex items-end justify-between gap-3"><span><span className="text-xl font-black">{formatMoney(price)}</span>{compareAt && compareAt > price ? <span className="ml-2 text-xs font-bold text-steel line-through">{formatMoney(compareAt)}</span> : null}{saving > 0 ? <span className="mt-1 block text-[11px] font-black text-emerald-700">Save {formatMoney(saving)}</span> : null}</span><ArrowRight className="mb-1 h-4 w-4 transition group-hover:translate-x-1" /></div></div></Link>;
}
