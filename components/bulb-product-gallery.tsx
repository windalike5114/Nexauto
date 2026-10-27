"use client";

import Image from "next/image";
import { useState } from "react";

export function BulbProductGallery({ images, title }: { images: string[]; title: string }) {
  const [activeIndex, setActiveIndex] = useState(0);
  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="relative aspect-[4/3] overflow-hidden rounded-lg border border-black/10 bg-white shadow-panel lg:aspect-auto lg:h-[400px]">
        <Image src={images[activeIndex]} alt={`${title} — view ${activeIndex + 1}`} fill priority className="object-contain p-3 sm:p-6" sizes="(min-width: 1024px) 50vw, 100vw" />
      </div>
      {images.length > 1 ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3" aria-label="Product photos">
          {images.map((src, index) => (
            <button key={src} type="button" onClick={() => setActiveIndex(index)} aria-label={`Show product photo ${index + 1}`} aria-pressed={activeIndex === index}
              className={`relative aspect-square overflow-hidden rounded-lg border bg-white transition ${activeIndex === index ? "border-signal shadow-md" : "border-black/10 hover:border-ink"}`}>
              <Image src={src} alt="" fill className="object-contain p-2" sizes="(min-width: 1024px) 130px, 25vw" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
