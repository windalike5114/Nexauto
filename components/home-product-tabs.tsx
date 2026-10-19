"use client";

import Image from "next/image";
import Link from "next/link";
import { useId, useState } from "react";
import { ArrowRight } from "lucide-react";
import { formatMoney } from "@/lib/catalog";

export type StorefrontProductCard = {
  id: string;
  href: string;
  image: string;
  eyebrow: string;
  title: string;
  price: number;
  purchasable?: boolean;
  compareAtPrice?: number | null;
  badge?: string;
};

export type ProductTabGroup = {
  id: "featured" | "new" | "deals";
  label: string;
  items: StorefrontProductCard[];
};

export function HomeProductTabs({ groups }: { groups: ProductTabGroup[] }) {
  const availableGroups = groups.filter((group) => group.items.length > 0);
  const [activeId, setActiveId] = useState(availableGroups[0]?.id ?? "featured");
  const panelId = useId();
  const activeGroup = availableGroups.find((group) => group.id === activeId) ?? availableGroups[0];

  if (!activeGroup) return null;

  return (
    <div>
      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Product collections">
        {availableGroups.map((group) => (
          <button
            key={group.id}
            type="button"
            role="tab"
            aria-selected={activeGroup.id === group.id}
            aria-controls={panelId}
            onClick={() => setActiveId(group.id)}
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-black transition ${activeGroup.id === group.id ? "bg-ink text-white" : "border border-black/10 bg-white text-steel hover:border-black/30 hover:text-ink"}`}
          >
            {group.label}
          </button>
        ))}
      </div>

      <div id={panelId} role="tabpanel" className="mt-6 grid auto-cols-[82%] grid-flow-col gap-4 overflow-x-auto pb-3 snap-x snap-mandatory sm:auto-cols-auto sm:grid-flow-row sm:grid-cols-2 sm:overflow-visible sm:pb-0 lg:grid-cols-4">
        {activeGroup.items.slice(0, 8).map((item) => <ProductCard key={`${activeGroup.id}-${item.id}`} item={item} />)}
      </div>
    </div>
  );
}

function ProductCard({ item }: { item: StorefrontProductCard }) {
  const purchasable = item.purchasable !== false;
  const saving = purchasable && item.compareAtPrice && item.compareAtPrice > item.price ? item.compareAtPrice - item.price : 0;
  return (
    <Link href={item.href as never} className="group snap-start overflow-hidden rounded-xl border border-black/10 bg-white shadow-sm transition duration-200 hover:-translate-y-1 hover:shadow-panel">
      <div className="relative aspect-[4/3] bg-zinc-100">
        {item.badge ? <span className="absolute left-3 top-3 z-10 rounded bg-signal px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-white">{item.badge}</span> : null}
        <Image src={item.image} alt={item.title} fill className="object-contain p-4 transition duration-300 group-hover:scale-[1.03]" sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 82vw" />
      </div>
      <div className="p-4">
        <p className="text-[11px] font-black uppercase tracking-[0.14em] text-signal">{item.eyebrow}</p>
        <h3 className="mt-2 min-h-12 text-base font-black leading-6">{item.title}</h3>
        <div className="mt-3 flex items-end justify-between gap-3">
          <span>
            <span className="text-lg font-black">{purchasable ? formatMoney(item.price) : "Preview"}</span>
            {purchasable && item.compareAtPrice && item.compareAtPrice > item.price ? <span className="ml-2 text-xs font-bold text-steel line-through">{formatMoney(item.compareAtPrice)}</span> : null}
            {saving > 0 ? <span className="mt-1 block text-[11px] font-black text-emerald-700">Save {formatMoney(saving)}</span> : null}
          </span>
          <ArrowRight className="mb-1 h-4 w-4 shrink-0 transition group-hover:translate-x-1" />
        </div>
      </div>
    </Link>
  );
}
