import type { Metadata } from "next";
import { CartProvider } from "@/components/cart-provider";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { VehicleSelectionBar } from "@/components/vehicle-selection-bar";
import { WelcomeRewardWidget } from "@/components/welcome-reward-widget";
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
            <SiteHeader />
            <VehicleSelectionBar />
            {children}
            <SiteFooter />
            <WelcomeRewardWidget />
          </div>
        </CartProvider>
      </body>
    </html>
  );
}
