import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { formatMoney } from "@/lib/catalog";
import { productImage } from "@/lib/product-content";
import { wiperPairPricing } from "@/lib/pricing";
import { listProducts } from "@/lib/queries/catalog";
import { listWiperSets } from "@/lib/queries/wiper-commerce";
import type { Product, WiperSet } from "@/lib/types";
import { getWiperSetPreviewImage } from "@/lib/wiper-product-images";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Specials", description: "Current NexAutoParts promotions and value bundles." };

export default async function SpecialsPage() {
  const { wipers, bulbs } = await loadSpecials();
  return (
    <main className="bg-[#F8FAFC]">
      <section className="bg-ink text-white"><div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8"><p className="text-xs font-black uppercase tracking-[0.18em] text-signal">Current offers</p><h1 className="mt-2 text-4xl font-black sm:text-5xl">Specials</h1><p className="mt-3 max-w-2xl text-base font-semibold leading-7 text-white/70">Only products with a current offer or bundle are shown here.</p></div></section>
      <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {wipers.map((item) => <SpecialCard key={item.id} href={`/wipers/${item.sku}`} image={getWiperSetPreviewImage(item)} eyebrow="Wiper offer" title={`Front Wiper Pair ${item.driverLengthIn}\" + ${item.passengerLengthIn}\"`} price={item.price} compareAt={item.compareAtPrice ?? wiperPairPricing.compareAtPrice} />)}
          {bulbs.map((item) => <SpecialCard key={item.id} href={`/products/${item.slug}`} image={productImage(item)} eyebrow="Lighting bundle" title={item.name} price={item.price} />)}
        </div>
      </section>
    </main>
  );
}

async function loadSpecials() {
  try {
    const [wipers, bulbs] = await Promise.all([listWiperSets(), listProducts("bulb")]);
    const preferred = ["WPFP2418", "WPFP2216", "WPFP2616"].map((sku) => wipers.find((item) => item.sku === sku)).filter((item): item is WiperSet => Boolean(item));
    return { wipers: preferred, bulbs: bulbs.slice(0, 1) };
  } catch { return { wipers: [] as WiperSet[], bulbs: [] as Product[] }; }
}

function SpecialCard({ href, image, eyebrow, title, price, compareAt }: { href: string; image: string; eyebrow: string; title: string; price: number; compareAt?: number | null }) {
  return <Link href={href as never} className="group overflow-hidden rounded-xl border border-black/10 bg-white shadow-sm hover:-translate-y-0.5 hover:shadow-panel"><div className="relative aspect-[4/3] bg-zinc-100"><span className="absolute left-3 top-3 z-10 rounded bg-signal px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-white">Special</span><Image src={image} alt={title} fill className="object-contain p-4" sizes="25vw" /></div><div className="p-4"><p className="text-xs font-black uppercase tracking-[0.14em] text-signal">{eyebrow}</p><h2 className="mt-2 min-h-12 text-lg font-black">{title}</h2><div className="mt-4 flex items-end justify-between"><span><span className="text-xl font-black">{formatMoney(price)}</span>{compareAt ? <span className="ml-2 text-xs font-bold text-steel line-through">{formatMoney(compareAt)}</span> : null}</span><ArrowRight className="h-4 w-4" /></div></div></Link>;
}
