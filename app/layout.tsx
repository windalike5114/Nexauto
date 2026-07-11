import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { CartProvider } from "@/components/cart-provider";
import { CartLink } from "@/components/cart-link";
import { SiteFooter } from "@/components/site-footer";
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
                <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-2 text-center text-xs font-black sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:text-left lg:px-8">
                  <p>Launch offer: $20 off all front wiper blade pairs + shipping waived NZ-wide for the first 3 months.</p>
                  <Link href="/#vehicle-finder" className="inline-flex items-center justify-center rounded bg-signal px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-white transition hover:-translate-y-0.5 hover:bg-red-700">
                    Find My Wipers
                  </Link>
                </div>
              </div>
              <nav className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
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
                <div className="flex items-center gap-2 text-sm font-semibold text-steel">
                  <Link className="rounded px-3 py-2 hover:bg-black/5" href="/">
                    Finder
                  </Link>
                  <Link className="rounded px-3 py-2 hover:bg-black/5" href="/shop">
                    Shop
                  </Link>
                  <Link className="hidden rounded px-3 py-2 hover:bg-black/5 lg:inline-flex" href="/about">
                    About
                  </Link>
                  <Link className="hidden rounded px-3 py-2 hover:bg-black/5 lg:inline-flex" href="/contact">
                    Contact
                  </Link>
                  <Link className="rounded px-3 py-2 hover:bg-black/5" href="/account">
                    Account
                  </Link>
                  <CartLink />
                </div>
              </nav>
            </header>
            {children}
            <SiteFooter />
          </div>
        </CartProvider>
      </body>
    </html>
  );
}
