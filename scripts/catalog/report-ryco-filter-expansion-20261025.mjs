import fs from 'node:fs';
import path from 'node:path';
import {enrich} from './import-ryco-filter-fitments-20261025.mjs';
import {OUT} from './expand-ryco-filter-knowledge-20261025.mjs';
import {DEFAULT_POPULAR_VEHICLE_GROUPS,buildPopularAliasIndex,popularGroupMatchesApplication} from './popular-vehicle-models.mjs';
import {canonicalModelKey} from './wipertech-direct-matcher.mjs';
const read=n=>JSON.parse(fs.readFileSync(path.join(OUT,n),'utf8'));
const d=read('before-snapshot.json'),p=read('plan.json'),v=read('verification.json');
if(!v.verified)throw new Error('Verification required');
const apps=enrich(d),by=new Map(apps.map(a=>[a.application_id,a])),aliases=buildPopularAliasIndex(DEFAULT_POPULAR_VEHICLE_GROUPS),variants=new Map(d.variants.map(r=>[r.variant_id,r]));
const activeProducts=new Set(d.products.filter(r=>r.active!==false&&/^NOF\d+$/.test(r.sku)).map(r=>r.id)),refBy=new Map(d.references.map(r=>[r.id,r]));
const oilBefore=new Set(d.fitments.filter(r=>r.fitment_status==='published'&&activeProducts.has(r.product_variant_id)).map(r=>r.application_id)),oilAfter=new Set([...oilBefore,...p.productWrites.map(r=>r.application_id)]);
const report=[];
for(const group of DEFAULT_POPULAR_VEHICLE_GROUPS){
 const aa=apps.filter(a=>aliases.get(canonicalModelKey(a.make,a.model))?.id===group.id&&popularGroupMatchesApplication(group,{bodyStyle:variants.get(a.variant_id)?.body_style,variantName:variants.get(a.variant_id)?.display_name})).map(a=>({...a,years:a.years.filter(y=>y>=2000&&y<=2026)})).filter(a=>a.years.length);
 const ids=new Set(aa.map(a=>a.application_id));
 const metric=covered=>{const yy=aa.flatMap(a=>a.years.map(year=>({id:a.application_id,year}))),years=[...new Set(yy.map(r=>r.year))];return {applications:aa.length,covered_applications:aa.filter(a=>covered.has(a.application_id)).length,application_years:yy.length,covered_application_years:yy.filter(r=>covered.has(r.id)).length,model_years:years.length,model_year_any:years.filter(y=>yy.some(r=>r.year===y&&covered.has(r.id))).length,model_year_full:years.filter(y=>yy.filter(r=>r.year===y).every(r=>covered.has(r.id))).length};};
 for(const type of ['oil_filter','air_filter']){
  const bp=type==='oil_filter'?oilBefore:new Set(),ap=type==='oil_filter'?oilAfter:new Set(),bk=new Set([...bp,...d.referenceFits.filter(r=>r.fitment_status==='published'&&refBy.get(r.part_reference_id)?.product_type===type).map(r=>r.application_id)]),ak=new Set([...bk,...ap,...p.referenceWrites.filter(r=>r.type===type).map(r=>r.application_id)]);
  report.push({group:group.label,type,before_product:metric(bp),after_product:metric(ap),before_knowledge:metric(bk),after_knowledge:metric(ak),product_relationship_writes:p.productWrites.filter(r=>r.type===type&&ids.has(r.application_id)).length,reference_relationship_writes:p.referenceWrites.filter(r=>r.type===type&&ids.has(r.application_id)).length});
 }
}
fs.writeFileSync(path.join(OUT,'per-popular-group-coverage.json'),JSON.stringify(report,null,2));
const productMissing=p.referenceWrites.filter(r=>r.type==='oil_filter'&&!oilAfter.has(r.application_id));
const missing=[...new Set(productMissing.map(r=>r.application_id))].map(id=>({application_id:id,make:by.get(id)?.make,model:by.get(id)?.model,series:by.get(id)?.series,engine:by.get(id)?.engine,references:[...new Set(productMissing.filter(r=>r.application_id===id).map(r=>r.reference))],classification:'product_missing_published_reference_available'}));
fs.writeFileSync(path.join(OUT,'products-to-create-review.json'),JSON.stringify(missing,null,2));
const conflict=p.conflicts.map(r=>({...r,make:by.get(r.application_id)?.make,model:by.get(r.application_id)?.model,series:by.get(r.application_id)?.series,engine:by.get(r.application_id)?.engine}));
fs.writeFileSync(path.join(OUT,'conflict-queue.json'),JSON.stringify(conflict,null,2));
const text=[
 'Ryco 机油滤芯、空气滤芯：记录分析与数据扩展（2026-10-25）',
 '',
 '匹配字段与采用规则',
 '机油滤芯：车型族/市场别名 + 发动机代码 + 年份。排量、燃料/进气配置作校验。跨底盘/车身扩展时，要求同发动机同年份的所有已观察来源配置存在共同参考编号；出现分支则保留确切底盘、车身、驱动条件。',
 '空气滤芯：车型族 + 确切底盘/系列 + 车身 + 发动机 + 年份。驱动/配置出现不同编号时保留分支，避免把同发动机当作相同空气滤盒的证明。',
 '每个目标配置的完整年份都须有来源支持；明确写有沿用/推断的记录不参与发布。排量、品牌或同底盘本身都不构成自动适配依据。',
 '',
 '来源记录观察',
 '机油滤芯：284 个多配置的车型族+发动机+年份组中，283 个有共同参考编号；2022 Corolla 2ZR-FXE 存在 Z386/Z1096 底盘分支。',
 '在同车型族/系列字段/车身/发动机/年份的多驱动记录组中，机油 118 组编号组合均一致；空气滤芯 118 组中有 27 组编号组合不同。这是配置分支的观察，不代表驱动本身是机械原因。',
 '同车型族/系列字段/车身/年份的多发动机组中，机油 110 组有 67 组编号组合不同，空气 110 组有 84 组不同；发动机不能省略。系列字段为 ALL 的组不视为已确认同一物理底盘。',
 '',
 '已写入数据库',
 '机油产品适配：新增 56 条、确认原 review 记录 3 条，共 59 条，涉及 8 个现有 SKU。',
 '参考知识适配：机油 159 条、空气 8 条，共 167 条；空气仍为独立参考产品线，未创建正式商品。',
 '来源规范化修复 67 条：63 条发动机代码开头描述得到正确解析；4 条无代码描述按底盘、车身、驱动、排量、缸数唯一对应到现有动力总成。',
 'Z9：保存用户提供的两种产品用途倾向；仅在确切 Falcon XH / 4.0L / ATG-H(MPFI) / 1996-1999 的 van 与 pickup 两条配置上关联 NOF1804。未按排量设全局阈值。',
 '',
 '覆盖率（核心103车型，2000-2026；分母38415个配置年份）',
 '机油产品：3900 -> 4190，10.15% -> 10.91%；机油知识：3905 -> 4287，10.17% -> 11.16%。',
 '空气知识：153 -> 178，0.40% -> 0.46%；空气产品仍为0。',
 '配置覆盖：机油产品636/6442，机油知识649/6442，空气知识37/6442。',
 '车型年份 any/full：机油产品600/2210、62/2210；机油知识616/2210、62/2210；空气知识61/2210、0/2210。',
 '',
 '核验与待核对',
 '所有写入已逐项回读，无重复关系，其他产品适配保持不变；重复规划产品写入0、参考写入0；覆盖结果与计划一致。',
 `现有已发布编号分歧 ${conflict.length} 组：${JSON.stringify(conflict)}。保留待审，未覆盖原有发布关系。`,
 '7条历史Z9已发布适配与新用途定位存在复核需要，列入 legacy-z9-audit.json，未仅凭用途倾向迁移。',
 `本轮新增机油知识中仍无产品覆盖的配置 ${missing.length} 个，详见 products-to-create-review.json。`,
 '完整来源证据、字段统计、逐车型覆盖、预备份和写入日志均保存在同目录。'
].join('\n');
fs.writeFileSync(path.join(OUT,'分析与扩展结果.txt'),text,'utf8');
console.log(JSON.stringify({report:'分析与扩展结果.txt',popular_group_rows:report.length,product_missing_applications:missing.length,conflicts:conflict}));
