import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const root=process.cwd(), out=path.join(root,'outputs/storefront-optimization-20261027');
fs.mkdirSync(out,{recursive:true});
if(!fs.existsSync(path.join(out,'before-manifest.json'))){
  const files=[];
  function walk(dir){for(const entry of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())walk(file);else if(/\.(tsx?|mjs|json|sql)$/.test(file)){const data=fs.readFileSync(path.join(root,file));fs.mkdirSync(path.dirname(path.join(out,'before',file)),{recursive:true});fs.writeFileSync(path.join(out,'before',file),data);files.push({file:file.replaceAll('\\','/'),sha256:crypto.createHash('sha256').update(data).digest('hex')});}}}
  for(const dir of ['app','components','lib','data','tests','supabase/migrations'])walk(dir);
  fs.writeFileSync(path.join(out,'before-manifest.json'),JSON.stringify({createdAt:new Date().toISOString(),gitHead:'See before-git-head.txt',files},null,2));
}
for(const line of fs.readFileSync('.env.local','utf8').split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)=(.*)$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^['"]|['"]$/g,'');}
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
async function all(table,columns='*',filter=q=>q){const rows=[];for(let from=0;;from+=1000){const r=await filter(db.from(table).select(columns)).range(from,from+999);if(r.error)throw new Error(`${table}: ${r.error.message}`);rows.push(...r.data);if(r.data.length<1000)return rows;}}
const counts={};for(const table of ['vehicle_catalog_applications','vehicle_catalog_product_fitments','vehicle_catalog_wiper_fitments','products','product_variants','wiper_sets']){const r=await db.from(table).select('*',{head:true,count:'exact'});if(r.error)throw new Error(`${table}: ${r.error.message}`);counts[table]=r.count;}
const samples=[];
for(const [make,model,year] of [['TOYOTA','COROLLA',2017],['TOYOTA','AQUA',2021],['TOYOTA','HILUX',2020],['MAZDA','3',2016]]){
 const apps=await all('vehicle_catalog_search','*',q=>q.ilike('make_name',make).ilike('model_name',model).eq('model_year',year));
 const ids=apps.map(a=>a.application_id);
 const fits=ids.length?await all('vehicle_catalog_product_fitments','*',q=>q.in('application_id',ids).eq('fitment_status','published')):[];
 const wipers=ids.length?await all('vehicle_catalog_wiper_fitments','*',q=>q.in('application_id',ids).eq('fitment_status','published')):[];
 const groups=Object.values(Object.groupBy(apps,a=>[a.body_style,a.engine_name?.split(/—|\s-\s/)[0]?.replace(/\s*\d+-cyl/ig,''),a.drive_type].join(' · '))).map(members=>({label:[members[0].body_style,members[0].engine_name?.split(/—|\s-\s/)[0]?.replace(/\s*\d+-cyl/ig,''),members[0].drive_type].join(' · '),applications:members.length,productVariants:new Set(fits.filter(f=>members.some(m=>m.application_id===f.application_id)).map(f=>f.product_variant_id)).size,wiperConfigurations:new Set(wipers.filter(f=>members.some(m=>m.application_id===f.application_id)).map(f=>f.wiper_configuration_id)).size}));
 samples.push({make,model,year,applications:apps,productFitments:fits,wiperFitments:wipers,groups});
}
const [products,variants,attributes,sets]=await Promise.all([all('products','id,slug,name,category_slug,price,active,visibility_status,content_status,commerce_status,checkout_enabled'),all('product_variants','id,product_id,sku,price,active,attributes'),all('product_attributes'),all('wiper_sets')]);
const report={createdAt:new Date().toISOString(),readOnly:true,counts,samples,products,variants,attributes,sets};
fs.writeFileSync(path.join(out,'database-audit.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({counts,samples:samples.map(s=>({make:s.make,model:s.model,year:s.year,applications:s.applications.length,groups:s.groups})),productsByCategory:Object.fromEntries(Object.entries(Object.groupBy(products,p=>p.category_slug)).map(([k,v])=>[k,v.length])),attributeKeys:[...new Set(attributes.flatMap(a=>Object.keys(a.attributes||{})))]},null,2));
