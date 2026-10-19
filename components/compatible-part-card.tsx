import Image from "next/image";
import Link from "next/link";
import { CheckCircle2, FlaskConical, LockKeyhole } from "lucide-react";
import { formatMoney } from "@/lib/catalog";
import { productImage } from "@/lib/product-content";
import { wiperPairPricing } from "@/lib/pricing";
import type { Product, WiperSet } from "@/lib/types";
import { getWiperSetPreviewImage } from "@/lib/wiper-product-images";
import type { WiperReviewDemo } from "@/lib/wiper-review-demo";

const categoryNames: Record<string, string> = {
  battery: "Battery",
  filter: "Filter",
  bulb: "Light Bulb",
  suspension: "Suspension",
  wiper: "Wiper"
};

export function CompatibleProductCard({ product }: { product: Product }) {
  const image = productImage(product);
  const categoryName = categoryNames[product.category] ?? "Auto Part";

  return (
    <Link
      href={`/products/${product.slug}` as never}
      className="group block overflow-hidden rounded-[14px] border border-black/10 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-panel focus:outline-none focus:ring-2 focus:ring-signal focus:ring-offset-2"
      aria-label={`View ${product.name}`}
    >
      <div className="relative aspect-[1/0.78] bg-zinc-50">
        <span className="absolute left-3 top-3 z-10 rounded bg-ink px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-white">
          {categoryName}
        </span>
        {image ? (
          <Image
            src={image}
            alt={`${product.name} preview`}
            fill
            className="object-contain p-4 transition duration-300 group-hover:scale-[1.03]"
            sizes="(min-width: 1280px) 25vw, (min-width: 640px) 50vw, 100vw"
          />
        ) : (
          <div className="grid h-full place-items-center text-sm font-black uppercase tracking-[0.16em] text-steel">Image coming soon</div>
        )}
      </div>
      <div className="flex min-h-[210px] flex-col p-4">
        <div className="flex items-center gap-2 text-xs font-black text-emerald-700">
          <CheckCircle2 className="h-4 w-4" aria-hidden /> Confirmed vehicle match
        </div>
        <h2 className="mt-3 text-base font-black leading-snug text-ink">{product.name}</h2>
        <p className="mt-2 line-clamp-2 text-sm font-semibold leading-6 text-steel">{product.description}</p>
        <div className="mt-auto flex items-end justify-between gap-3 pt-5">
          <div>
            <p className="text-lg font-black text-ink">{product.purchasable ? formatMoney(product.price) : "Preview"}</p>
            <p className="mt-1 text-[11px] font-bold text-steel">{product.purchasable ? "Available to order" : "Ordering temporarily disabled"}</p>
          </div>
          <span className="inline-flex h-10 items-center justify-center rounded bg-ink px-4 text-sm font-black text-white">View details</span>
        </div>
      </div>
    </Link>
  );
}

export function CompatibleWiperCard({ wiperSet, href, rearLengthIn }: { wiperSet: WiperSet; href: string; rearLengthIn: number | null }) {
  const image = getWiperSetPreviewImage(wiperSet);

  return (
    <Link
      href={href as never}
      className="group block overflow-hidden rounded-[14px] border border-black/10 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-panel focus:outline-none focus:ring-2 focus:ring-signal focus:ring-offset-2"
      aria-label={`View compatible ${wiperSet.driverLengthIn} and ${wiperSet.passengerLengthIn} inch wiper pair`}
    >
      <div className="relative aspect-[1/0.78] bg-zinc-50">
        <span className="absolute left-3 top-3 z-10 rounded bg-signal px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-white">Wiper Blades</span>
        <Image
          src={image}
          alt={`${wiperSet.name} preview`}
          fill
          className="object-contain p-4 transition duration-300 group-hover:scale-[1.03]"
          sizes="(min-width: 1280px) 25vw, (min-width: 640px) 50vw, 100vw"
        />
      </div>
      <div className="flex min-h-[210px] flex-col p-4">
        <div className="flex items-center gap-2 text-xs font-black text-emerald-700">
          <CheckCircle2 className="h-4 w-4" aria-hidden /> Confirmed vehicle match
        </div>
        <h2 className="mt-3 text-base font-black leading-snug text-ink">Front Wiper Blade Pair</h2>
        <p className="mt-2 text-sm font-black leading-6 text-steel">
          Driver {wiperSet.driverLengthIn}&quot; + Passenger {wiperSet.passengerLengthIn}&quot;
          {rearLengthIn ? ` · Rear ${rearLengthIn}\" available` : ""}
        </p>
        <div className="mt-auto flex items-end justify-between gap-3 pt-5">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-lg font-black text-ink">{formatMoney(wiperSet.price)}</span>
            <span className="text-xs font-bold text-steel line-through">{formatMoney(wiperSet.compareAtPrice ?? wiperPairPricing.compareAtPrice)}</span>
          </div>
          <span className="inline-flex h-10 items-center justify-center rounded bg-ink px-4 text-sm font-black text-white">View details</span>
        </div>
      </div>
    </Link>
  );
}

export function WiperReviewDemoCard({ review, helpHref }: { review: WiperReviewDemo; helpHref: string }) {
  const sizes = review.suggestedConfiguration;

  return (
    <article className="overflow-hidden rounded-[14px] border border-amber-300 bg-white shadow-sm">
      <div className="relative aspect-[1/0.78] bg-amber-50">
        <span className="absolute left-3 top-3 z-10 rounded bg-amber-600 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-white">
          Review demo · {review.confidencePercent}%
        </span>
        <Image
          src="/products/wiper-blade.png"
          alt="Wiper blade recommendation awaiting verification"
          fill
          className="object-contain p-6 opacity-90"
          sizes="(min-width: 1280px) 25vw, (min-width: 640px) 50vw, 100vw"
        />
      </div>
      <div className="flex min-h-[250px] flex-col p-4">
        <div className="flex items-center gap-2 text-xs font-black text-amber-700">
          <FlaskConical className="h-4 w-4" aria-hidden /> High-confidence recommendation · not confirmed
        </div>
        <h2 className="mt-3 text-base font-black leading-snug text-ink">Front Wiper Blade Pair</h2>
        <p className="mt-2 text-sm font-black leading-6 text-steel">
          Driver {sizes.driverLengthIn}&quot; + Passenger {sizes.passengerLengthIn}&quot;
          {sizes.rearLengthIn ? ` · Rear ${sizes.rearLengthIn}\"` : ""}
        </p>
        <p className="mt-2 text-xs font-semibold leading-5 text-steel">{review.reasonLabel}. Final supplier or vehicle confirmation is still required.</p>
        <div className="mt-auto flex items-end justify-between gap-3 pt-5">
          <div>
            <p className="flex items-center gap-1.5 text-sm font-black text-amber-800"><LockKeyhole className="h-4 w-4" /> Ordering disabled</p>
            <p className="mt-1 text-[11px] font-bold text-steel">Demo candidate only</p>
          </div>
          <Link href={helpHref as never} className="inline-flex h-10 items-center justify-center rounded bg-amber-600 px-4 text-sm font-black text-white hover:bg-amber-700">Confirm fitment</Link>
        </div>
      </div>
    </article>
  );
}
