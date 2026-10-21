"use client";

import Image from "next/image";
import { useState } from "react";

type GalleryItem = {
  src: string;
  alt: string;
  label: string;
};

export function BrakePadProductGallery({ items, illustrative }: { items: GalleryItem[]; illustrative: boolean }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const activeItem = items[activeIndex] ?? items[0];

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="group relative aspect-[4/3] overflow-hidden rounded-lg border border-black/10 bg-white shadow-panel sm:aspect-[16/11]">
        <Image
          src={activeItem.src}
          alt={activeItem.alt}
          fill
          priority
          className="object-contain p-3 transition duration-300 sm:p-6 md:group-hover:scale-[1.025]"
          sizes="(min-width: 1280px) 58vw, (min-width: 1024px) 54vw, 100vw"
        />
        {illustrative && activeIndex === 0 ? (
          <span className="absolute left-3 top-3 rounded bg-ink/90 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-white">
            Illustrative image
          </span>
        ) : null}
        <span className="absolute bottom-3 left-3 rounded bg-white/95 px-3 py-1.5 text-xs font-black text-ink shadow-sm">
          {activeItem.label}
        </span>
      </div>

      {items.length > 1 ? <div className={`grid gap-2 sm:gap-3 ${items.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
        {items.map((item, index) => (
          <button
            key={item.src}
            type="button"
            onClick={() => setActiveIndex(index)}
            aria-pressed={activeIndex === index}
            aria-label={`Show ${item.label.toLowerCase()}`}
            className={`relative aspect-[4/3] overflow-hidden rounded-lg border bg-white transition ${
              activeIndex === index ? "border-signal shadow-md" : "border-black/10 hover:-translate-y-0.5 hover:shadow-sm"
            }`}
          >
            <Image src={item.src} alt="" fill priority={index === 0} className="object-contain p-2 sm:p-3" sizes="220px" />
            <span className="absolute inset-x-1 bottom-1 rounded bg-white/90 px-1 py-1 text-[9px] font-black uppercase tracking-[0.08em] text-ink sm:inset-x-2 sm:bottom-2 sm:text-[10px]">
              {item.label}
            </span>
          </button>
        ))}
      </div> : null}
    </div>
  );
}
