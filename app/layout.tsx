import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { CartProvider } from "@/components/cart-provider";
import { CartLink } from "@/components/cart-link";
import { SiteFooter } from "@/components/site-footer";
import { WelcomeRewardWidget } from "@/components/welcome-reward-widget";
import { blobMediaAssets } from "@/lib/blob-media-assets";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "NexAutoParts | Quality Auto Parts for New Zealand Drivers",
    template: "%s | NexAutoParts"
  },
  description:
    "Find quality replacement auto parts with confidence. NexAutoParts helps New Zealand drivers choose compatible wiper blades and essential maintenance parts.",
  metadataBase: new URL("https://nexautoparts.co.nz"),
  icons: {
    icon: [
      { url: "/favicon-48.png", sizes: "48x48", type: "image/png" },
      { url: "/favicon-64.png", sizes: "64x64", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" }
    ],
    shortcut: "/favicon-48.png",
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }]
  }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <CartProvider>
          <div className="min-h-screen">
            <header className="sticky top-0 z-30 border-b border-black/10 bg-white/90 backdrop-blur">
              <div className="bg-ink text-white">
                <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-3 py-2 text-xs font-black sm:px-6 lg:px-8">
                  <p className="min-w-0 flex-1 leading-5 sm:text-left">Launch offer: $20 off wiper pairs + shipping waived NZ-wide.</p>
                  <Link href="/#vehicle-finder" className="inline-flex shrink-0 items-center justify-center rounded bg-signal px-2.5 py-1.5 text-[10px] uppercase tracking-[0.1em] text-white transition hover:-translate-y-0.5 hover:bg-red-700 sm:px-3 sm:text-[11px]">
                    Find My Wipers
                  </Link>
                </div>
              </div>
              <nav className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-3 py-3 sm:px-6 sm:py-4 lg:px-8">
                <Link href="/" className="flex items-center gap-3" aria-label="NexAuto home">
                  <Image
                    src={blobMediaAssets.brand.circleIcon}
                    alt=""
                    width={40}
                    height={40}
                    className="h-10 w-10 rounded-full object-contain sm:hidden"
                    priority
                  />
                  <Image
                    src={blobMediaAssets.brand.mainLogo}
                    alt="NexAutoParts"
                    width={240}
                    height={48}
                    className="hidden h-9 w-auto object-contain sm:block"
                    priority
                  />
                </Link>
                <div className="flex min-w-0 items-center gap-1 text-xs font-bold text-steel sm:gap-2 sm:text-sm sm:font-semibold">
                  <Link className="rounded px-2 py-2 hover:bg-black/5 sm:px-3" href="/">
                    Finder
                  </Link>
                  <Link className="rounded px-2 py-2 hover:bg-black/5 sm:px-3" href="/shop">
                    Shop
                  </Link>
                  <Link className="hidden rounded px-3 py-2 hover:bg-black/5 lg:inline-flex" href="/about">
                    About
                  </Link>
                  <Link className="hidden rounded px-3 py-2 hover:bg-black/5 lg:inline-flex" href="/contact">
                    Contact
                  </Link>
                  <Link className="rounded px-2 py-2 hover:bg-black/5 sm:px-3" href="/account">
                    Account
                  </Link>
                  <CartLink />
                </div>
              </nav>
            </header>
            {children}
            <SiteFooter />
            <WelcomeRewardWidget />
          </div>
        </CartProvider>
      </body>
    </html>
  );
}
