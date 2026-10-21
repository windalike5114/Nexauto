import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: ["GPTBot", "ChatGPT-User", "CCBot", "ClaudeBot", "Claude-Web", "Bytespider", "Amazonbot", "PerplexityBot"],
        disallow: "/"
      },
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/api", "/checkout/success", "/checkout/cancel"]
      }
    ],
    sitemap: "https://nexautoparts.co.nz/sitemap.xml",
    host: "https://nexautoparts.co.nz"
  };
}
