"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";

const slides = [
  {
    id: "parts",
    eyebrow: "Automotive parts for New Zealand",
    title: <>Parts that fit.<br />Service you can trust.</>,
    description: "Shop dependable replacement parts, or start with your vehicle and let each product category confirm the details it needs.",
    image: "/home/parts-hero-v2.png",
    imageAlt: "NexAutoParts wipers, oil filter, light bulbs, battery and control arm",
    parallax: { x: 0, y: 1 },
    primary: { label: "Shop Parts", href: "/shop" },
    secondary: { label: "Find Parts for My Vehicle", href: "/#vehicle-finder" }
  },
  {
    id: "fitment",
    eyebrow: "Wiper fitment made simple",
    title: <>Clear vision.<br />Correct fit.</>,
    description: "Choose your vehicle to confirm the correct front blade lengths, body details and fitting adapter before you order.",
    image: "/home/vehicle-fitment.png",
    imageAlt: "A technician fitting a wiper blade with multiple adapters",
    parallax: { x: -0.28, y: 0.72 },
    primary: { label: "Find My Wipers", href: "/parts?category=wipers" },
    secondary: { label: "Installation Guides", href: "/wiper-installation-guides" }
  },
  {
    id: "nz-roads",
    eyebrow: "Support for New Zealand drivers",
    title: <>Confidence for<br />every road.</>,
    description: "Start with your vehicle, then let each product category collect the extra details needed for a dependable match.",
    image: "/home/nz-roads.png",
    imageAlt: "A vehicle travelling on a wet New Zealand road",
    parallax: { x: 0.2, y: 0.88 },
    primary: { label: "Choose My Vehicle", href: "/#vehicle-finder" },
    secondary: { label: "View Weekly Deals", href: "/specials" }
  }
] as const;

const slideIntervalMs = 6500;

export function HomeHeroCarousel() {
  const heroRef = useRef<HTMLElement>(null);
  const touchStartX = useRef<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [interacting, setInteracting] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const mobileQuery = window.matchMedia("(max-width: 767px)");
    const syncPreference = () => setReducedMotion(mediaQuery.matches || mobileQuery.matches);
    syncPreference();
    mediaQuery.addEventListener("change", syncPreference);
    mobileQuery.addEventListener("change", syncPreference);
    return () => {
      mediaQuery.removeEventListener("change", syncPreference);
      mobileQuery.removeEventListener("change", syncPreference);
    };
  }, []);

  useEffect(() => {
    if (interacting || reducedMotion) return;
    const timer = window.setInterval(() => setActiveIndex((current) => (current + 1) % slides.length), slideIntervalMs);
    return () => window.clearInterval(timer);
  }, [interacting, reducedMotion]);

  useEffect(() => {
    if (reducedMotion) return;
    const hero = heroRef.current;
    if (!hero) return;
    let frame = 0;
    const updateParallax = () => {
      frame = 0;
      const rect = hero.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) return;
      const shift = Math.max(0, Math.min(24, window.scrollY * 0.045));
      const parallax = slides[activeIndex].parallax;
      hero.style.setProperty("--hero-parallax-x", `${shift * parallax.x}px`);
      hero.style.setProperty("--hero-parallax-y", `${shift * parallax.y}px`);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(updateParallax);
    };
    updateParallax();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [activeIndex, reducedMotion]);

  const activeSlide = slides[activeIndex];
  const showPrevious = () => setActiveIndex((current) => (current - 1 + slides.length) % slides.length);
  const showNext = () => setActiveIndex((current) => (current + 1) % slides.length);

  return (
    <section
      ref={heroRef}
      className="relative isolate overflow-hidden bg-black text-white"
      aria-roledescription="carousel"
      aria-label="NexAutoParts highlights"
      onMouseEnter={() => setInteracting(true)}
      onMouseLeave={() => setInteracting(false)}
      onFocusCapture={() => setInteracting(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setInteracting(false);
      }}
      onTouchStart={(event) => { touchStartX.current = event.touches[0]?.clientX ?? null; }}
      onTouchEnd={(event) => {
        const start = touchStartX.current;
        const end = event.changedTouches[0]?.clientX;
        touchStartX.current = null;
        if (start === null || end === undefined || Math.abs(start - end) < 45) return;
        if (start > end) showNext(); else showPrevious();
      }}
    >
      <div className="absolute inset-0 -z-20">
        {slides.map((slide, index) => (
          <div key={slide.id} className={`hero-slide ${activeIndex === index ? "hero-slide-active" : ""}`} aria-hidden={activeIndex !== index}>
            <div className="hero-slide-media">
              <Image src={slide.image} alt={activeIndex === index ? slide.imageAlt : ""} fill priority={index === 0} className="object-cover object-center" sizes="100vw" />
            </div>
          </div>
        ))}
      </div>
      <div className="absolute inset-0 -z-10 bg-gradient-to-r from-black via-black/86 to-black/15" />

      <div className="mx-auto flex min-h-[470px] max-w-7xl items-center px-4 py-14 sm:min-h-[520px] sm:px-6 lg:px-8">
        <div key={activeSlide.id} className="hero-copy-enter max-w-xl">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-signal sm:text-sm">{activeSlide.eyebrow}</p>
          <h1 className="mt-4 text-4xl font-black leading-[0.98] sm:text-6xl">{activeSlide.title}</h1>
          <p className="mt-5 max-w-lg text-base font-semibold leading-7 text-white/78 sm:text-lg">{activeSlide.description}</p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <Link href={activeSlide.primary.href as never} className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-signal px-6 font-black text-white shadow-lg shadow-red-950/30 transition hover:bg-red-700">{activeSlide.primary.label} <ArrowRight className="h-4 w-4" /></Link>
            <Link href={activeSlide.secondary.href as never} className="inline-flex h-12 items-center justify-center rounded-lg border border-white/35 bg-black/20 px-6 font-black text-white backdrop-blur transition hover:bg-white/15">{activeSlide.secondary.label}</Link>
          </div>
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0">
        <div className="mx-auto flex max-w-7xl items-center px-4 pb-5 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2" role="group" aria-label="Choose hero slide">
            {slides.map((slide, index) => (
              <button key={slide.id} type="button" aria-pressed={activeIndex === index} aria-label={`Show slide ${index + 1}: ${slide.eyebrow}`} onClick={() => setActiveIndex(index)} className={`h-1.5 rounded-full transition-all ${activeIndex === index ? "w-10 bg-signal" : "w-5 bg-white/45 hover:bg-white/75"}`} />
            ))}
          </div>
        </div>
      </div>
      <p className="sr-only" aria-live="off">Slide {activeIndex + 1} of {slides.length}: {activeSlide.eyebrow}</p>
    </section>
  );
}
