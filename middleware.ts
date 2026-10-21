import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/utils/supabase/middleware";

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isCatalogueRequest = ["/shop", "/brake-pads", "/oil-filters", "/wipers", "/products"].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
  const userAgent = request.headers.get("user-agent") ?? "";
  const obviousScriptClient = /(?:curl\/|wget\/|python-requests|python-urllib|scrapy|aiohttp|httpx|libwww-perl|go-http-client|node-fetch)/i.test(userAgent);

  if (process.env.NODE_ENV === "production" && isCatalogueRequest && obviousScriptClient) {
    return new NextResponse("Automated catalogue access is rate limited.", {
      status: 429,
      headers: {
        "Cache-Control": "private, no-store",
        "Retry-After": "3600",
        "X-Robots-Tag": "noai, noimageai"
      }
    });
  }

  const response = await updateSession(request);
  if (isCatalogueRequest) {
    response.headers.set("X-Robots-Tag", "noai, noimageai");
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"]
};
