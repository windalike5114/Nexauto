// Server/edge only. These values must never enter browser bundles or responses.
export type QuotaInput={networkHash:string;sessionHash:string;vehicleHash:string|null;requestClass:'api'|'page'};
export type QuotaDecision={allowed:boolean;reason:null|'request_rate'|'vehicle_quota';retryAfterSeconds:number;limit:number;remaining:number;resetAfterSeconds:number;vehicleLimit:number;vehicleRemaining:number;dailyVehicleLimit:number;dailyVehicleRemaining:number};
export interface QuotaStore { consume(input:QuotaInput):Promise<QuotaDecision> }
const encoder=new TextEncoder();
const keys=new Map<string,Promise<CryptoKey>>();
function key(secret:string){
  if(!keys.has(secret))keys.set(secret,crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']));
  return keys.get(secret)!;
}
export async function quotaHash(secret:string,purpose:string,value:string){
  const signature=await crypto.subtle.sign('HMAC',await key(secret),encoder.encode(`nexauto-quota-v1:${purpose}:${value}`));
  return Array.from(new Uint8Array(signature),b=>b.toString(16).padStart(2,'0')).join('');
}
async function validSignature(secret:string,purpose:string,value:string,signature:string){
  if(!/^[a-f0-9]{64}$/.test(signature))return false;
  const bytes=Uint8Array.from(signature.match(/../g)!,v=>parseInt(v,16));
  return crypto.subtle.verify('HMAC',await key(secret),bytes,encoder.encode(`nexauto-quota-v1:${purpose}:${value}`));
}
export function quotaCookieName(request:Request){return new URL(request.url).protocol==='https:'?'__Host-nexauto_fitment':'nexauto_fitment_dev';}
function cookie(request:Request,name:string){
  const field=request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='));
  return field?.slice(name.length+1)??'';
}
export async function quotaSession(request:Request,secret:string,nowSeconds=Math.floor(Date.now()/1000)){
  const raw=cookie(request,quotaCookieName(request));
  const match=raw.match(/^([a-f0-9]{32})\.(\d{10})\.([a-f0-9]{64})$/);
  if(match && Number(match[2])>nowSeconds && Number(match[2])<=nowSeconds+86460
    && await validSignature(secret,'cookie',`${match[1]}.${match[2]}`,match[3]))return {id:match[1],setCookie:null};
  const id=crypto.randomUUID().replaceAll('-',''),expires=nowSeconds+86400;
  const value=`${id}.${expires}.${await quotaHash(secret,'cookie',`${id}.${expires}`)}`;
  return {id,setCookie:`${quotaCookieName(request)}=${value}; Path=/; Max-Age=86400; HttpOnly; SameSite=Lax${new URL(request.url).protocol==='https:'?'; Secure':''}`};
}
export function quotaNetwork(request:Request,vercel=process.env.NODE_ENV==='production'&&process.env.VERCEL==='1'){
  if(!vercel){
    if(process.env.NODE_ENV==='production')throw new Error('Trusted network identity unavailable');
    return 'local-development';
  }
  // Vercel overwrites X-Forwarded-For at ingress on this project (no Enterprise
  // Trusted Proxy). The similarly named x-vercel-forwarded-for is absent in
  // Routing Middleware. Never accept arbitrary proxy chains or CF-Connecting-IP.
  const peer=request.headers.get('x-forwarded-for')?.trim();
  if(!peer || !/^[0-9a-f:.]{1,64}$/i.test(peer))throw new Error('Trusted network identity unavailable');
  return peer.toLowerCase();
}
export function quotaVehicle(request:Request){
  const params=new URL(request.url).searchParams;
  const valid=(s:string|null|undefined)=>Boolean(s&&/^(?:(?:mk|md|ap)_[a-f0-9]{20}|[a-f0-9-]{36})$/i.test(s));
  const make=params.get('makeId'),model=params.get('modelId');
  if(new URL(request.url).pathname.startsWith('/api/')){
    if(valid(make)&&valid(model))return `model:${make!.toLowerCase()}:${model!.toLowerCase()}`;
  }else{
    // Storefront pages resolve the saved selection, ignoring stale URL labels.
    // Count that same identity so added query parameters cannot mask it.
    const saved=cookie(request,'nexauto_vehicle_context_v3');
    if(saved.length<=4096)try{
      const vehicle=JSON.parse(decodeURIComponent(saved));
      if(typeof vehicle.makeId==='string'&&typeof vehicle.modelId==='string'&&valid(vehicle.makeId)&&valid(vehicle.modelId))return `model:${vehicle.makeId.toLowerCase()}:${vehicle.modelId.toLowerCase()}`;
    }catch{/* Untrusted browser data is not identity. */}
    const application=params.get('applicationId');
    if(valid(application))return `application:${application}`;
  }
  return null;
}
export async function originVerification(request:Request,secret:string,expires=Math.floor(Date.now()/1000)+180){
  const url=new URL(request.url);
  const value=`${url.host}:${request.method}:${url.pathname}${url.search}:${expires}`;
  return `${expires}.${await quotaHash(secret,'origin',value)}`;
}
export async function allowQuotaOrigin(request:Request,secret:string,production=process.env.NODE_ENV==='production'&&process.env.VERCEL_ENV==='production'){
  if(!production)return true;
  const url=new URL(request.url);
  if(['nexautoparts.co.nz','www.nexautoparts.co.nz'].includes(url.hostname))return true;
  const match=request.headers.get('x-nexauto-quota-verification')?.match(/^(\d{10})\.([a-f0-9]{64})$/);
  const now=Math.floor(Date.now()/1000);
  return Boolean(match&&Number(match[1])>now&&Number(match[1])<=now+300
    &&await validSignature(secret,'origin',`${url.host}:${request.method}:${url.pathname}${url.search}:${match[1]}`,match[2]));
}
export function quotaSecret(){
  const secret=process.env.FITMENT_QUOTA_SECRET||process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!secret||secret.length<32)throw new Error('Shared quota signing is not configured');
  return secret;
}
export const databaseQuotaStore:QuotaStore={async consume(input){
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,secret=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!secret)throw new Error('Shared quota storage unavailable');
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),3000);
  try{
    const response=await fetch(`${url}/rest/v1/rpc/consume_fitment_quota`,{method:'POST',cache:'no-store',signal:controller.signal,
      headers:{apikey:secret,...(secret.startsWith('eyJ')?{Authorization:`Bearer ${secret}`}:{}) ,'Content-Type':'application/json'},
      body:JSON.stringify({p_network_hash:input.networkHash,p_session_hash:input.sessionHash,p_vehicle_hash:input.vehicleHash,p_request_class:input.requestClass})});
    if(!response.ok)throw new Error('Shared quota storage unavailable');
    const row=await response.json();
    if(typeof row.allowed!=='boolean'||![null,'request_rate','vehicle_quota'].includes(row.reason)
      ||!['request_limit','remaining','reset_after','retry_after','vehicle_limit','vehicle_remaining','daily_vehicle_limit','daily_vehicle_remaining'].every(k=>Number.isInteger(row[k])&&row[k]>=0))throw new Error('Invalid shared quota result');
    return {allowed:row.allowed,reason:row.reason,retryAfterSeconds:Math.max(1,row.retry_after),limit:row.request_limit,remaining:row.remaining,resetAfterSeconds:row.reset_after,
      vehicleLimit:row.vehicle_limit,vehicleRemaining:row.vehicle_remaining,dailyVehicleLimit:row.daily_vehicle_limit,dailyVehicleRemaining:row.daily_vehicle_remaining};
  }finally{clearTimeout(timeout);}
}};
