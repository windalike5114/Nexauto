import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Heart } from "lucide-react";
import { formatMoney } from "@/lib/catalog";
import { productImage } from "@/lib/product-content";
import type { Product } from "@/lib/types";

export function ProductCard({ product, categoryName }: { product: Product; categoryName?: string }) {
  const image = productImage(product);
  const promo = product.category === "wiper" ? "-15%" : product.category === "bulb" ? "Hot" : "";
  const compareAt = promo === "-15%" ? product.price / 0.85 : null;

  return (
    <article className="overflow-hidden rounded-lg border border-black/10 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-panel">
      <div className="relative aspect-[4/3] bg-zinc-200">
        {promo ? (
          <span className="absolute left-3 top-3 z-10 rounded bg-signal px-3 py-1 text-xs font-black text-white">
            {promo}
          </span>
        ) : null}
        <button
          type="button"
          className="absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center rounded bg-white/90 text-steel shadow-sm hover:text-signal"
          aria-label={`Add ${product.name} to wishlist`}
        >
          <Heart className="h-4 w-4" />
        </button>
        {image ? (
          <Image
            src={image}
            alt={product.name}
            fill
            className="object-cover"
            sizes="(min-width: 1024px) 33vw, 100vw"
          />
        ) : (
          <div className="grid h-full place-items-center bg-zinc-100 text-sm font-black uppercase tracking-[0.18em] text-steel">
            No image
          </div>
        )}
      </div>
      <div className="space-y-4 p-5">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-signal">{categoryName ?? product.category}</p>
          <h3 className="mt-2 text-xl font-black">{product.name}</h3>
          <p className="mt-2 text-sm leading-6 text-steel">{product.description}</p>
        </div>
        <div className="flex items-center justify-between">
          <span className="flex flex-col">
            <span className="text-lg font-black">{formatMoney(product.price)}</span>
            {compareAt ? <span className="text-xs font-bold text-steel line-through">{formatMoney(compareAt)}</span> : null}
          </span>
          <Link
            href={`/products/${product.slug}`}
            className="inline-flex h-10 w-10 items-center justify-center rounded bg-ink text-white hover:bg-black"
            aria-label={`View ${product.name}`}
          >
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </div>
    </article>
  );
}
