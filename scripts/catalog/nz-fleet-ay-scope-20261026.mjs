import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { canonicalModelKey } from './wipertech-direct-matcher.mjs';
import { groupsForPopularScope, buildPopularAliasIndex, popularGroupMatchesApplication } from './popular-vehicle-models.mjs';

export const groups = groupsForPopularScope('extended80');
const aliases = buildPopularAliasIndex(groups);
const byRank = new Map(groups.map(g => [g.rank,g]));
const compact = value => String(value??'').toLowerCase().replace(/[^a-z0-9]/g,'');
export function resolveFamily(make, model, body, identity='') {
  const mk=compact(make), mod=compact(model);
  let group;
  if(mk==='toyota' && mod==='landcruiser' && /(?:prado|(?:kdj|gdj|trj|grj|lj|rzj|vzj)(?:90|95|120|121|125|150|151|155|250|251)|jte[a-z0-9]{0,6}3fj|^gj[xl]s)/i.test(compact(identity))) group=byRank.get(38);
  else if(mk==='mazda' && mod==='mazda2') group=byRank.get(7);
  else if(mk==='mazda' && mod==='mazda3') group=byRank.get(21);
  else if(mk==='lexus' && /^rx\d/.test(mod)) group=byRank.get(49);
  else if(mk==='bmw' && (/^(?:316|318|320|323|325|328|330|335|340)[a-z]*$/.test(mod)||mod==='m3')) group=byRank.get(40);
  else group=aliases.get(canonicalModelKey(make,model));
  if(group && popularGroupMatchesApplication(group,{bodyStyle:body})) return {key:group.id,label:group.label,popular:true};
  return {key:canonicalModelKey(make,model),label:`${make} ${model}`,popular:false};
}

export async function loadNZFleetIndex() {
  const source='C:/Users/Sanli/Downloads';
  const files=fs.readdirSync(source).filter(name=>/^VehicleYear-20\d{2}\.csv$/i.test(name)&&Number(name.match(/\d{4}/)[0])<=2026).sort();
  if(files.length!==27) throw new Error(`Expected 27 year files, found ${files.length}`);
  const families=new Map(),rawModels=new Map(),bodies=new Map(),fileAudit=[];
  let total=0,invalid=0;
  for(const name of files){
    let headers,ix,count=0;
    const file=path.join(source,name);
    for await(const line of readline.createInterface({input:fs.createReadStream(file,{encoding:'utf8'}),crlfDelay:Infinity})){
      if(!headers){headers=parseCsvLine(line.replace(/^\uFEFF/,''));ix=Object.fromEntries(['MAKE','MODEL','CLASS','VEHICLE_YEAR','BODY_TYPE','CHASSIS7','INDUSTRY_MODEL_CODE','MVMA_MODEL_CODE','SUBMODEL','VIN11'].map(k=>[k,headers.indexOf(k)]));if(Object.values(ix).some(v=>v<0))throw Error(`Missing columns: ${name}`);continue;}
      if(!line)continue;
      const row=parseCsvLine(line);if(row.length!==headers.length){invalid++;continue;}
      if(!['MA','MB','MC','NA'].includes(row[ix.CLASS].trim()))continue;
      const year=Number(row[ix.VEHICLE_YEAR]);if(year<2000||year>2026||!Number.isInteger(year))continue;
      const make=row[ix.MAKE].trim(),model=row[ix.MODEL].trim(),body=row[ix.BODY_TYPE].trim();
      const identity=['CHASSIS7','INDUSTRY_MODEL_CODE','MVMA_MODEL_CODE','SUBMODEL','VIN11'].map(k=>row[ix[k]]).join(' ');
      const family=resolveFamily(make,model,body,identity);
      const entry=families.get(family.key)??{...family,count:0,years:{},raw_models:{},body_types:{}};
      entry.count++;entry.years[year]=(entry.years[year]??0)+1;entry.raw_models[`${make}|${model}`]=(entry.raw_models[`${make}|${model}`]??0)+1;entry.body_types[body]=(entry.body_types[body]??0)+1;
      families.set(family.key,entry);bodies.set(body,(bodies.get(body)??0)+1);
      const rawKey=`${make}|${model}`;rawModels.set(rawKey,(rawModels.get(rawKey)??0)+1);
      total++;count++;
    }
    const stat=fs.statSync(file);fileAudit.push({file:name,bytes:stat.size,modified_at:stat.mtime.toISOString(),light_records:count});
    if(fileAudit.length%5===0)console.error(`Fleet scope: ${fileAudit.length}/${files.length} year files`);
  }
  if(invalid)throw Error(`${invalid} invalid CSV records require review`);
  return {generated_at:new Date().toISOString(),total,invalid,families:[...families.values()],body_types:Object.fromEntries(bodies),file_audit:fileAudit,policy:'CLASS MA/MB/MC/NA, VEHICLE_YEAR 2000-2026. Families normalized using maintained popular aliases; Prado split precedes LandCruiser alias; MINI hatch body filter applied. No personal or vehicle identifiers retained.'};
}
function parseCsvLine(line){const out=[];let value='',quoted=false;for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){if(quoted&&line[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}else if(ch===','&&!quoted){out.push(value);value='';}else value+=ch;}out.push(value);return out;}
