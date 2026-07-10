import type { Metadata } from "next";
import Link from "next/link";
import { CartProvider } from "@/components/cart-provider";
import { CartLink } from "@/components/cart-link";
import { SiteFooter } from "@/components/site-footer";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "NexAutoParts | Quality Auto Parts for New Zealand Drivers",
    template: "%s | NexAutoParts"
  },
  description:
    "Find quality replacement auto parts with confidence. NexAutoParts helps New Zealand drivers choose compatible wiper blades and essential maintenance parts.",
  metadataBase: new URL("https://nexautoparts.co.nz")
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <CartProvider>
          <div className="min-h-screen">
            <header className="sticky top-0 z-30 border-b border-black/10 bg-white/90 backdrop-blur">
              <nav className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
                <Link href="/" className="flex items-center gap-3" aria-label="NexAuto home">
                  <span className="grid h-10 w-10 place-items-center rounded bg-ink text-sm font-black text-white">
                    NX
                  </span>
                  <span className="text-lg font-black tracking-normal">NexAutoParts</span>
                </Link>
                <div className="flex items-center gap-2 text-sm font-semibold text-steel">
                  <Link className="rounded px-3 py-2 hover:bg-black/5" href="/">
                    Finder
                  </Link>
                  <Link className="rounded px-3 py-2 hover:bg-black/5" href="/shop">
                    Shop
                  </Link>
                  <Link className="hidden rounded px-3 py-2 hover:bg-black/5 md:inline-flex" href="/products/universal-wiper-blade">
                    Wiper Blades
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
