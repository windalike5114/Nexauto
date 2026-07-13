import Link from "next/link";
import Image from "next/image";
import { Clock, Mail, MapPin } from "lucide-react";
import { blobMediaAssets } from "@/lib/blob-media-assets";

const footerGroups = [
  {
    title: "Shop",
    links: [
      ["Shop All", "/shop"],
      ["Wiper Blades", "/shop"],
      ["Vehicle Finder", "/"],
      ["New Arrivals", "/shop"]
    ]
  },
  {
    title: "Customer Care",
    links: [
      ["Shipping Information", "/shipping"],
      ["Returns & Refunds", "/returns"],
      ["Warranty", "/warranty"],
      ["Installation Guides", "/wiper-installation-guides"],
      ["FAQs", "/faq"],
      ["Contact Us", "/contact"],
      ["Track Your Order", "/account"]
    ]
  },
  {
    title: "Company",
    links: [
      ["About Us", "/about"],
      ["Blog", "/blog"],
      ["Privacy Policy", "/privacy"],
      ["Terms & Conditions", "/terms"]
    ]
  }
];

const paymentMethods = ["Visa", "Mastercard", "Apple Pay", "Google Pay", "Afterpay"];

export function SiteFooter() {
  return (
    <footer className="border-t border-black/10 bg-ink text-white">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-2 lg:grid-cols-5 lg:px-8">
        <section className="lg:col-span-2">
          <div className="flex items-center gap-3">
            <div className="rounded bg-white px-3 py-2">
              <Image
                src={blobMediaAssets.brand.mainLogo}
                alt="NexAutoParts"
                width={220}
                height={44}
                className="h-8 w-auto object-contain"
              />
            </div>
          </div>
          <p className="mt-4 max-w-sm text-sm leading-7 text-white/70">
            NexAutoParts is committed to providing quality automotive replacement parts and excellent customer service across New Zealand.
          </p>
          <div className="mt-5 space-y-3 text-sm text-white/70">
            <p className="flex gap-3">
              <MapPin className="mt-0.5 h-4 w-4 text-signal" />
              Auckland, New Zealand
            </p>
            <p className="flex gap-3">
              <Mail className="mt-0.5 h-4 w-4 text-signal" />
              support@nexautoparts.co.nz
            </p>
            <p className="flex gap-3">
              <Clock className="mt-0.5 h-4 w-4 text-signal" />
              Monday - Friday / 9:00 AM - 5:00 PM
            </p>
          </div>
        </section>

        {footerGroups.map((group) => (
          <section key={group.title}>
            <h3 className="font-black">{group.title}</h3>
            <div className="mt-4 grid gap-2 text-sm text-white/70">
              {group.links.map(([label, href]) => (
                <Link key={href + label} href={href as never} className="hover:text-white">
                  {label}
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto grid max-w-7xl gap-5 px-4 py-5 text-xs font-bold text-white/60 sm:px-6 lg:grid-cols-[1fr_auto] lg:items-center lg:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.16em] text-white">We Accept</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {paymentMethods.map((method) => (
                  <span key={method} className="rounded border border-white/15 bg-white/10 px-2.5 py-1 text-[11px] font-black text-white/85">
                    {method}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.16em] text-white">Follow us</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {["Facebook", "Instagram"].map((channel) => (
                  <span key={channel} className="rounded border border-white/15 px-2.5 py-1 text-[11px] font-black text-white/70">
                    {channel}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-1 lg:text-right">
            <span>(c) 2026 NexAutoParts. All rights reserved. NZBN 9429053285928.</span>
            <span>Secure checkout powered by Stripe.</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
