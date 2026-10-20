import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Heart } from "lucide-react";
import { formatMoney } from "@/lib/catalog";
import { productImage } from "@/lib/product-content";
import type { Product } from "@/lib/types";

export function ProductCard({ product, categoryName }: { product: Product; categoryName?: string }) {
  const image = productImage(product);
  const promo = !product.purchasable ? "Coming soon" : product.category === "wiper" ? "-15%" : product.category === "bulb" ? "Hot" : "";
  const compareAt = promo === "-15%" ? product.price / 0.85 : null;

  return (
    <article className="min-w-0 overflow-hidden rounded-lg border border-black/10 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-panel">
      <div className="relative aspect-square bg-zinc-200 sm:aspect-[4/3]">
        {promo ? (
          <span className="absolute left-1.5 top-1.5 z-10 rounded bg-signal px-1.5 py-0.5 text-[9px] font-black text-white sm:left-3 sm:top-3 sm:px-3 sm:py-1 sm:text-xs">
            {promo}
          </span>
        ) : null}
        <button
          type="button"
          className="absolute right-1.5 top-1.5 z-10 grid h-8 w-8 place-items-center rounded-full bg-white/90 text-steel shadow-sm hover:text-signal sm:right-3 sm:top-3 sm:h-9 sm:w-9 sm:rounded"
          aria-label={`Add ${product.name} to wishlist`}
        >
          <Heart className="h-4 w-4" />
        </button>
        {image ? (
          <Image
            src={image}
            alt={product.name}
            fill
            className={product.category === "wiper" || product.category === "bulb" ? "object-contain p-2 sm:p-5" : "object-cover"}
            sizes="(min-width: 1024px) 33vw, 50vw"
          />
        ) : (
          <div className="grid h-full place-items-center bg-zinc-100 text-sm font-black uppercase tracking-[0.18em] text-steel">
            No image
          </div>
        )}
      </div>
      <div className="space-y-2 p-2.5 sm:space-y-4 sm:p-5">
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.1em] text-signal sm:text-xs sm:tracking-[0.18em]">{categoryName ?? product.category}</p>
          <h3 title={product.name} className="mt-1 line-clamp-2 min-h-8 text-[13px] font-black leading-4 sm:mt-2 sm:min-h-0 sm:text-xl sm:leading-normal">{product.name}</h3>
          <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-steel sm:mt-2 sm:text-sm sm:leading-6">{product.description}</p>
        </div>
        <div className="flex items-center justify-between">
          <span className="flex flex-col">
            <span className="text-base font-black sm:text-lg">{product.purchasable ? formatMoney(product.price) : "Preview"}</span>
            {compareAt && product.purchasable ? <span className="text-[10px] font-bold text-steel line-through sm:text-xs">{formatMoney(compareAt)}</span> : null}
          </span>
          <Link
            href={`/products/${product.slug}`}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded bg-ink text-white hover:bg-black sm:h-10 sm:w-10"
            aria-label={`View ${product.name}`}
          >
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </div>
    </article>
  );
}
