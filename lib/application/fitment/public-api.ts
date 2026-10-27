import { NextResponse } from "next/server";
import { allowQuotaOrigin,databaseQuotaStore,quotaHash,quotaNetwork,quotaSecret,quotaSession,quotaVehicle,type QuotaStore } from './shared-quota';

const MAX_REQUEST_URL_LENGTH = 2_048;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VEHICLE_CATALOG_ID_PATTERN = /^(?:mk|md|ap)_[0-9a-f]{20}$/;

export type FitmentApiGuard = {
  headers: Headers;
  response: NextResponse | null;
};

export type FitmentRequestGuard=(request:Request,options?:{requestClass?:'api'|'page'})=>Promise<FitmentApiGuard>;
export function createFitmentRequestGuard(deps:{store:QuotaStore;secret:()=>string;network:(request:Request)=>string;production?:()=>boolean}):FitmentRequestGuard {
return async function guard(request,options={}) {
  const baseHeaders = createBaseHeaders();
  const fetchSite = request.headers.get("sec-fetch-site");
  const requestClass=options.requestClass??'api';

  if (requestClass==='api' && fetchSite === "cross-site") {
    return {
      headers: baseHeaders,
      response: NextResponse.json({ error: "Cross-site fitment requests are not allowed." }, { status: 403, headers: baseHeaders })
    };
  }

  if (request.url.length > MAX_REQUEST_URL_LENGTH) {
    return {
      headers: baseHeaders,
      response: NextResponse.json({ error: "Fitment request URL is too long." }, { status: 414, headers: baseHeaders })
    };
  }

  let stage='configuration';
  try{
    const secret=deps.secret();
    if(!await allowQuotaOrigin(request,secret,deps.production?.())){
      return {headers:baseHeaders,response:requestClass==='page'
        ?NextResponse.redirect(new URL(new URL(request.url).pathname+new URL(request.url).search,'https://nexautoparts.co.nz'),308)
        :NextResponse.json({error:'Please use nexautoparts.co.nz for vehicle lookups.'},{status:403,headers:baseHeaders})};
    }
    stage='identity';
    const session=await quotaSession(request,secret);
    if(session.setCookie)baseHeaders.append('Set-Cookie',session.setCookie);
    const vehicle=quotaVehicle(request);
    const [networkHash,sessionHash,vehicleHash]=await Promise.all([
      quotaHash(secret,'network',deps.network(request)),quotaHash(secret,'session',session.id),vehicle?quotaHash(secret,'vehicle',vehicle):null]);
    if(new URL(request.url).hostname.endsWith('.vercel.app')&&request.headers.has('x-nexauto-quota-verification')){
      console.info(JSON.stringify({event:'fitment_quota_verification',requestClass,networkToken:networkHash.slice(0,16),sessionToken:sessionHash.slice(0,16)}));
    }
    stage='shared-storage';
    const decision=await deps.store.consume({networkHash,sessionHash,vehicleHash,requestClass});
    baseHeaders.set('X-Fitment-Protection','shared-v1');
    baseHeaders.set('RateLimit-Policy',`${decision.limit};w=60`);
    baseHeaders.set('RateLimit',`limit=${decision.limit}, remaining=${decision.remaining}, reset=${decision.resetAfterSeconds}`);
    baseHeaders.set('X-Vehicle-Quota',`limit=${decision.vehicleLimit}, remaining=${decision.vehicleRemaining}, window=900`);
    baseHeaders.set('X-Vehicle-Daily-Quota',`limit=${decision.dailyVehicleLimit}, remaining=${decision.dailyVehicleRemaining}, window=86400`);
    if(!decision.allowed){
      baseHeaders.set('Retry-After',String(decision.retryAfterSeconds));
      const error=decision.reason==='vehicle_quota'?'You have checked many different vehicles. Please try again after the indicated wait. Your cart is unchanged.':'Too many fitment requests. Please try again shortly.';
      return {headers:baseHeaders,response:NextResponse.json({error,code:decision.reason==='vehicle_quota'?'VEHICLE_QUOTA_EXCEEDED':'FITMENT_RATE_LIMITED'},{status:429,headers:baseHeaders})};
    }
    return {headers:baseHeaders,response:null};
  }catch(error){
    const knownMessages=['Trusted network identity unavailable','Shared quota signing is not configured','Shared quota storage unavailable','Invalid shared quota result'];
    console.error(JSON.stringify({event:'fitment_quota_unavailable',stage,requestClass,
      category:error instanceof Error&&knownMessages.includes(error.message)?error.message:'runtime-error',
      errorType:error instanceof Error?error.name:'unknown'}));
    baseHeaders.set('Retry-After','10');
    return {headers:baseHeaders,response:NextResponse.json({error:'Vehicle lookup is temporarily unavailable. Please try again shortly. Your cart is unchanged.',code:'FITMENT_QUOTA_UNAVAILABLE'},{status:503,headers:baseHeaders})};
  }
};
}
export const guardFitmentApiRequest=createFitmentRequestGuard({store:databaseQuotaStore,secret:quotaSecret,network:quotaNetwork});

export function fitmentJson(body: unknown, guard: FitmentApiGuard, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  guard.headers.forEach((value, key) => headers.set(key, value));
  return NextResponse.json(body, { ...init, headers });
}

export function parseFitmentId(value: string | null) {
  if (!value || value.length > 64 || (!UUID_PATTERN.test(value) && !VEHICLE_CATALOG_ID_PATTERN.test(value))) return null;
  return value;
}

export function parseVehicleYear(value: string | null, currentYear = new Date().getFullYear()) {
  if (!value || !/^\d{4}$/.test(value)) return null;
  const year = Number(value);
  return Number.isInteger(year) && year >= 1886 && year <= currentYear + 2 ? year : null;
}

export function hasOnlySearchParams(searchParams: URLSearchParams, allowed: readonly string[]) {
  const allowedSet = new Set(allowed);
  const seen = new Set<string>();
  return [...searchParams.keys()].every((key) => {
    if (!allowedSet.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function createBaseHeaders() {
  return new Headers({
    "Cache-Control": "private, no-store, max-age=0",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Pragma": "no-cache",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow, noarchive"
  });
}

