import { type NextRequest } from "next/server";
import { updateSession } from "@/utils/supabase/middleware";
import { guardFitmentApiRequest } from '@/lib/application/fitment/public-api';

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isCatalogueRequest = ["/shop", "/parts", "/brake-pads", "/oil-filters", "/wipers", "/bulbs", "/products"].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
  const isExempt = ["/api", "/cart", "/checkout", "/account", "/admin", "/auth", "/login", "/_next"].some(
    prefix => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
  const hasSavedSelection = request.cookies.has('nexauto_vehicle_context_v3');
  // Count before SSR/RSC/internal cache hits, including prefetch. Do not touch
  // account, cart, checkout, payment callbacks, assets or signed recovery APIs.
  const guard=(isCatalogueRequest || (!isExempt && hasSavedSelection))?await guardFitmentApiRequest(request,{requestClass:'page'}):null;
  if(guard?.response)return guard.response;
  const response = await updateSession(request);
  guard?.headers.forEach((value,name)=>{if(name.toLowerCase()!=='set-cookie')response.headers.set(name,value);});
  const issued=guard?.headers.get('set-cookie');
  if(issued){
    const pair=issued.split(';')[0],at=pair.indexOf('=');
    response.cookies.set(pair.slice(0,at),pair.slice(at+1),{path:'/',httpOnly:true,sameSite:'lax',secure:request.nextUrl.protocol==='https:',maxAge:86400});
  }
  if (isCatalogueRequest) {
    response.headers.set("X-Robots-Tag", "noai, noimageai");
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"]
};
