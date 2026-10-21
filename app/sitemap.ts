import type { MetadataRoute } from "next";
import { blogArticles } from "@/lib/blog";
import { productHref } from "@/lib/product-content";
import { listProducts } from "@/lib/queries/catalog";
import { listBrakePadCatalogSkus } from "@/lib/queries/brake-pad-catalog";
import { listWiperSets } from "@/lib/queries/wiper-commerce";

const siteUrl = "https://nexautoparts.co.nz";

const staticRoutes = [
  "",
  "/shop",
  "/parts",
  "/specials",
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

  const blogEntries = blogArticles.map((article) => ({
    url: `${siteUrl}/blog/${article.slug}`,
    lastModified: new Date(`${article.publishedAt}T12:00:00Z`),
    changeFrequency: "monthly",
    priority: 0.65
  })) satisfies MetadataRoute.Sitemap;

  const dynamicEntries: MetadataRoute.Sitemap = [];

  try {
    const wiperSets = await listWiperSets();
    const wiperEntries = wiperSets.map((wiperSet) => ({
      url: `${siteUrl}/wipers/${wiperSet.sku}`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.7
    })) satisfies MetadataRoute.Sitemap;

    dynamicEntries.push(...wiperEntries);
  } catch {}

  try {
    const oilFilters = await listProducts("filter");
    dynamicEntries.push(...oilFilters.map((product) => ({
      url: `${siteUrl}${productHref(product)}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.7
    })));
  } catch {}

  dynamicEntries.push(...listBrakePadCatalogSkus().map((sku) => ({
    url: `${siteUrl}/brake-pads/${encodeURIComponent(sku)}`,
    lastModified: now,
    changeFrequency: "weekly" as const,
    priority: 0.7
  })));

  return [...staticEntries, ...blogEntries, ...dynamicEntries];
}
