import type { MetadataRoute } from "next";
import { listWiperSets } from "@/lib/queries/wiper-commerce";

const siteUrl = "https://nexautoparts.co.nz";

const staticRoutes = [
  "",
  "/shop",
  "/products/universal-wiper-blade",
  "/about",
  "/contact",
  "/blog",
  "/faq",
  "/policy",
  "/shipping",
  "/returns",
  "/warranty",
  "/privacy",
  "/terms"
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const staticEntries = staticRoutes.map((route) => ({
    url: `${siteUrl}${route}`,
    lastModified: now,
    changeFrequency: route === "" ? "weekly" : "monthly",
    priority: route === "" ? 1 : route === "/shop" ? 0.8 : 0.6
  })) satisfies MetadataRoute.Sitemap;

  try {
    const wiperSets = await listWiperSets();
    const wiperEntries = wiperSets.map((wiperSet) => ({
      url: `${siteUrl}/wipers/${wiperSet.sku}`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.7
    })) satisfies MetadataRoute.Sitemap;

    return [...staticEntries, ...wiperEntries];
  } catch {
    return staticEntries;
  }
}
