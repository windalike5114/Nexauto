import { type NextRequest } from "next/server";
import { addShopRateLimitHeaders, guardShopPageRequest } from "@/lib/application/catalog/shop-request-guard";
import { updateSession } from "@/utils/supabase/middleware";

export async function middleware(request: NextRequest) {
  const shopGuard = guardShopPageRequest(request);
  if (shopGuard.response) return shopGuard.response;

  const response = await updateSession(request);
  addShopRateLimitHeaders(response.headers, shopGuard.decision);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"]
};
