"use client";

import Image from "next/image";
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

type GalleryImage = {
  src: string;
  alt: string;
};

export function WiperProductGallery({ images }: { images: GalleryImage[] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const activeImage = images[activeIndex];

  function move(direction: 1 | -1) {
    setActiveIndex((current) => (current + direction + images.length) % images.length);
  }

  function handleTouchEnd(clientX: number) {
    if (touchStartX === null) return;
    const distance = touchStartX - clientX;
    setTouchStartX(null);

    if (Math.abs(distance) < 42) return;
    move(distance > 0 ? 1 : -1);
  }

  return (
    <div className="space-y-3 sm:space-y-4">
      <div
        className="group relative aspect-[4/3] overflow-hidden rounded-lg border border-black/10 bg-white shadow-panel sm:aspect-[16/11]"
        onTouchStart={(event) => setTouchStartX(event.touches[0]?.clientX ?? null)}
        onTouchEnd={(event) => handleTouchEnd(event.changedTouches[0]?.clientX ?? 0)}
      >
        <Image
          src={activeImage.src}
          alt={activeImage.alt}
          fill
          priority
          className="object-contain p-3 transition duration-300 sm:p-5 md:group-hover:scale-[1.035]"
          sizes="(min-width: 1280px) 58vw, (min-width: 1024px) 54vw, 100vw"
        />
        <button
          type="button"
          aria-label="Previous product image"
          onClick={() => move(-1)}
          className="absolute left-2 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full border border-black/10 bg-white/95 text-ink shadow-sm transition hover:shadow-md sm:left-3"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button
          type="button"
          aria-label="Next product image"
          onClick={() => move(1)}
          className="absolute right-2 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full border border-black/10 bg-white/95 text-ink shadow-sm transition hover:shadow-md sm:right-3"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 sm:gap-3">
        {images.map((image, index) => (
          <button
            key={image.src}
            type="button"
            onClick={() => setActiveIndex(index)}
            aria-label={`Show product image ${index + 1}`}
            className={`relative h-16 w-20 shrink-0 overflow-hidden rounded-lg border bg-white transition sm:h-20 sm:w-24 ${
              activeIndex === index ? "border-signal shadow-md" : "border-black/10 hover:-translate-y-0.5 hover:shadow-sm"
            }`}
          >
            <Image src={image.src} alt="" fill className="object-contain p-2" sizes="96px" />
          </button>
        ))}
      </div>
    </div>
  );
}
