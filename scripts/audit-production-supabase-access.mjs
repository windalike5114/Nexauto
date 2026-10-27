import fs from 'node:fs';
import path from 'node:path';

for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}
const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!base || !anon || !service) throw new Error('Missing Supabase configuration');
const headers = key => ({apikey:key, ...(key.startsWith('eyJ') ? {Authorization:`Bearer ${key}`} : {})});
const get = (url, init = {}) => fetch(url, {...init, signal:AbortSignal.timeout(20000)});
const report = {checkedAt:new Date().toISOString(), supabaseUrl:base, readOnly:true,
  scope:'REST/OpenAPI and bounded anonymous reads only; no RPCs invoked; no customer values retained',
  rlsMetadata:'not_yet_verified', tables:[]};
const site = process.env.NEXT_PUBLIC_SITE_URL || 'https://nexautoparts.co.nz';
const home = await get(new URL('/account',site));
const html = await home.text();
const scripts = [...new Set([...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(m=>m[1]))].slice(0,30);
let matched = false;
for (const src of scripts) {
  const url = new URL(src, site);
  if (url.origin !== new URL(site).origin) continue;
  const body = await (await get(url)).text();
  if (body.includes(base)) matched = true;
}
report.productionLink = {site,status:home.status, checkedScripts:scripts.length, supabaseUrlFoundInPublicBundle:matched};
const schemaResponse = await get(`${base}/rest/v1/`, {headers:headers(service)});
if (!schemaResponse.ok) throw new Error(`Service OpenAPI unavailable: ${schemaResponse.status}`);
const schema = await schemaResponse.json();
const noKey = await get(`${base}/rest/v1/orders?select=id&limit=1`);
report.noApiKeyStatus = noKey.status;
const anonSchemaResponse = await get(`${base}/rest/v1/`, {headers:headers(anon)});
const anonSchema = anonSchemaResponse.ok ? await anonSchemaResponse.json() : null;
report.anonymousOpenApiStatus = anonSchemaResponse.status;
report.anonymousRpcNames = Object.keys(anonSchema?.paths || {}).filter(p=>p.startsWith('/rpc/')).map(p=>p.slice(5));
for (const name of Object.keys(schema.definitions || {}).sort()) {
  if (!schema.paths?.[`/${name}`]) continue;
  const properties = schema.definitions[name].properties || {};
  const column = properties.id ? 'id' : Object.keys(properties)[0];
  if (!column) continue;
  const response = await get(`${base}/rest/v1/${encodeURIComponent(name)}?select=${encodeURIComponent(column)}&limit=1`, {headers:headers(anon)});
  const body = await response.json().catch(()=>null);
  report.tables.push({table:name, status:response.status, anonymousSelectAllowed:response.ok,
    sampleRowVisible:Array.isArray(body) && body.length > 0, returnedRows:Array.isArray(body)?body.length:null,
    errorCode:!response.ok?body?.code??null:null});
}
const out = 'outputs/security-audit-20261027';
fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'production-anonymous-access.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({supabaseUrl:base,productionLink:report.productionLink,noApiKeyStatus:report.noApiKeyStatus,
  tables:report.tables.length,readableTables:report.tables.filter(t=>t.sampleRowVisible).map(t=>t.table),
  sensitiveTables:report.tables.filter(t=>/customer|order|stripe|audit|reward|address|profile|email/i.test(t.table)),
  anonymousRpcNames:report.anonymousRpcNames,rlsMetadata:report.rlsMetadata},null,2));
