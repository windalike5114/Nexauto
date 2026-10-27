import fs from 'node:fs';
import path from 'node:path';
const ROOT=path.resolve('outputs/brake-review-sample-audit-20261025');
const read=f=>JSON.parse(fs.readFileSync(path.join(ROOT,f),'utf8'));
const sources={
 NIBK_CX3:{url:'https://nibk.jp/catalogue/cars/brake/659353/PN25001S',publisher:'NiBK',
  locator:'Cross Reference BENDIX AUS DB2227; CX-3 02.15~ /1500/S5-DPT#/DK5AW/Rear Brake PN25001',
  scope:'实际打开厂家目录；PN25001S为PN25001性能变体，页面明确列变体关系及澳洲DB交叉号。'},
 BENDIX_HILUX:{url:'https://assets.bendix.com.au/bendix-anz/downloads/Bendix-New-Releases-11-24_Applications_Brake-Pads_PRJ-08701.pdf',publisher:'Bendix',
  locator:'2024-11新发布适配表，PDF第9页，TOYOTA / DB2245 / GUN126、GUN126R / Rear Axle',
  scope:'实际读取PDF文字；截图抓取失败，不宣称完成版面图像复核。所列为2015年以后GUN车型，不支持样本2000–2005旧代际外推。'},
 NIBK_FORESTER:{url:'https://www.nibk.jp/catalogue/bikes/brake/659364/PN7415S',publisher:'NiBK',
  locator:'BENDIX AUS DB1379；Forester 08.98–06.02 /2500/EJ254/SF9/Rear Brake PN7415',
  scope:'实际打开厂家页面；只支持明确SF9 2.5范围，不把SUV/Wagon全局互换，也不背书所有SF_配置。'},
 SB_FORESTER:{url:'https://sbparts.jp/catalogue/23682',publisher:'SB Parts',
  locator:'BP27415 rear axle; cross DB1379; Forester SF9 2.5 EJ254 08.98–06.02',
  scope:'实际打开厂家目录，作为同一规格的辅助交叉来源。'},
 BOSCH_CAMRY:{url:'https://d347awuzx0kdse.cloudfront.net/autoline/content-file/Bosch_Brake_Pad_Vehicle_Applications_Catalogue_PDF.pdf',publisher:'Bosch Automotive Aftermarket（经销商托管原厂目录）',
  locator:'2010/2011目录，印刷页B128 / PDF第128页；Camry/Vienta MCV20 Jul.97–Aug.02 3.0 DB1345/DB422',
  scope:'实际读取原厂PDF文字，适用澳洲市场；截图抓取失败。支持样本2000–2001，不据此证明完整application中的1996。'},
 NIBK_FOCUS:{url:'https://nibk.jp/catalogue/bikes/brake/659324/PN2702S',publisher:'NiBK',
  locator:'Cross Reference DB1763；Focus II 01.05–09.12 /1800/KKDA115PS/SDN-HB-EST；Rear Brake PN2702与FN51001并列',
  scope:'实际打开厂家目录；有后盘片与鼓刹蹄选项，不能假定所有目标配置均为盘刹。'},
 ICER_AUDI:{url:'https://catalogonuevo.icerbrakes.com/Producto/Details?idProducto=181362',publisher:'ICER Brakes',
  locator:'181362 Front/Ate-Teves；Cross Reference B.M. DB1427；A4 II B6 8E2 /S4 quattro /BBK BHF/03.2003–12.2004',
  scope:'实际打开厂家目录；有旧DB的直接支持，但本轮未核清与DB2193同时出现的条件，不能宣称唯一。'}
};
const decisions={
 S01:{category:'old_match_not_releasable',result:'发现相反DB证据',
  conclusion:'DK5AW实际应按CX-3查证，NiBK对同底盘1.5柴油后轴给PN25001/DB2227，旧关系是Mazda3源行的DB2331。车型误分把正确源数据用到了错误车型，单个旧DB并不安全。',
  evidence:['NIBK_CX3'],next:'先纠正或确认车型归属，保留原application ID；DB2227对应现有NBP1263，仅列后续复核候选，不自动替换。'},
 S02:{category:'unresolved',result:'未取得直接适配证据',conclusion:'9B1与1J1底盘关系尚未证实，不能用旧DB1492已保存这一点代替证明。',evidence:[],next:'保留待审，查直接配置级DB或车辆代码对应证据。'},
 S03:{category:'conditional_support',result:'旧DB有条件支持',conclusion:'NiBK有Focus II KKDA 1.8柴油、2005–2012后轴PN2702/DB1763支持，但同一配置行还列鼓刹蹄FN51001。须确认后盘/后鼓，不能全量恢复。',evidence:['NIBK_FOCUS'],next:'确认目标后轴为盘刹后再列恢复候选。'},
 S04:{category:'old_match_not_releasable',result:'旧跨代外推依据不成立',conclusion:'目标是2005年2.7L、SUV/RWD；旧DB2245源行却来自2015年后Hilux VIII 2.8L/4WD。厂家所读DB2245页同样列GUN后代际，不支持本样本。未宣称厂家目录已穷尽所有市场。',evidence:['BENDIX_HILUX'],next:'不能因平台源仅一个DB就恢复；应确认真实车型和该年款后轴结构。'},
 S05:{category:'positive_support_limited_scope',result:'旧DB在明确子配置获支持',conclusion:'NiBK/SB均有Forester SF9 2.5/EJ254后轴DB1379，覆盖样本2000–2002。旧审核仅因NexAuto写Wagon、源写SUV而拦截，存在标签误拦。不能把此结论扩大到全部SF_或全库Wagon/SUV。',evidence:['NIBK_FORESTER','SB_FORESTER'],next:'按SF9 2.5子配置建立窄范围规则；原application完整年份含1998，需保留生产月份及子码条件。'},
 S06:{category:'unresolved',result:'未取得直接适配证据',conclusion:'ZZE111R Wagon与已给Sedan/Liftback源行的后刹适配仍未证实；不能仅靠DB422源中唯一就放行。',evidence:[],next:'查本车身配置的后盘/后鼓及DB证据。'},
 S07:{category:'unresolved',result:'驱动和年款范围尚未解决',conclusion:'ACU20R 2.4 FWD目标2000–2007，而旧源仅3.3 AWD、2003–2007。DB1518可能共用，但本轮未取得直接覆盖目标的厂家证据，不能称审核过严已证明。',evidence:[],next:'保留待审，查2.4 FWD直接后轴适配。'},
 S08:{category:'unresolved',result:'未取得AWD直接适配证据',conclusion:'DE3AS AWD原DB1941只由2/Demio FWD源行提供。共享车系不足以在本轮证明四驱车型前片一定相同。',evidence:[],next:'查DE3AS/ZJ-VE AWD直接DB或OEM交叉，不只查车型身份。'},
 S09:{category:'old_match_not_releasable',result:'旧跨代外推依据不成立',conclusion:'RZN149 1997–2004后轴DB2245被2015年以后GUN代际4WD源行支撑。泛化的_N1_标签复用到多个代际，不能当作唯一物理底盘。',evidence:['BENDIX_HILUX'],next:'保留待审；先查此RWD旧代际是否后鼓及对应部件。'},
 S10:{category:'positive_support_limited_scope',result:'统计范围年份内旧DB获支持',conclusion:'Bosch厂家目录有MCV20 3.0于1997–2002前片DB1345，支持样本2000–2001；本地DB1267来源是5S-FE 2.2L，可与1MZ-FE 3.0区别。原application还含1996，这一完整边界未被该目录证明。',evidence:['BOSCH_CAMRY'],next:'可按明确年款/发动机消歧，但整条application恢复前补1996边界证据，不能只证明2000年后的部分便无条件挂产品。'},
 S11:{category:'conditional_support',result:'旧DB有支持，唯一性未证实',conclusion:'ICER厂家目录确有8E2/S4 BBK 4.2/2003–2004前片及DB1427交叉；但本地还列DB2193，本轮未取得排他性配置条件。',evidence:['ICER_AUDI'],next:'保留配置条件待审；不能把目录某一行支持当作另一DB已排除。'},
 S12:{category:'old_match_not_releasable',result:'旧DB不在该年款筛选后候选中',conclusion:'旧DB1482依据混用了多代_N1_及更早年份。原审核在2015/RWD配置下留下DB1741、DB1985，不含旧DB1482。本轮未新增选定替代号，也不声称已证明全部实体装车不兼容。',evidence:[],next:'不能按旧单一记录恢复；保留2015具体底盘/VSC等条件待审。'}
};
const samples=read('samples.json').map(s=>({...s,...decisions[s.sample_id]}));
const categories=Object.fromEntries([...new Set(samples.map(s=>s.category))].map(c=>[c,samples.filter(s=>s.category===c).length]));
const report={report_date:'2026-10-25',source_snapshot_date:'2026-10-24',sample_size:12,method:read('candidate-counts.json').sample_design,
 categories,overall_accuracy_rate:null,
 accuracy_notice:'原因分层且不同车型的12例是诊断样本，不是全库正确率估计。未核实不算正确；正面支持也不等于无条件整条恢复。',
 main_finding:'既有标签/年款过严导致的误拦，也有单一旧DB配错车型或跨代的实际风险，不支持整批恢复至74.19%。',
 source_truth_scope:'已打开正文的厂家证据逐项列出；没有证据的4例明确未解决；PDF只完成文字读取，截图失败。',
 source_data_vs_match:'供应商源数据高置信度不等于把它连接到任意NexAuto application也高置信度。',
 production_changed:false,publications_restored:0,sources,samples};
fs.writeFileSync(path.join(ROOT,'review-results.json'),JSON.stringify(report,null,2));
const counts=read('candidate-counts.json').popular50_2000_2026_pending;
const lines=[
 '待审刹车片分层抽查与规则说明（2026-10-25）',
 '范围：2026-10-24保存快照；本轮只诊断，不修改数据库、不恢复发布。',
 '',
 `热门50/2000–2026待审关系：${counts.relations}条，涉及${counts.applications}个application。`,
 '每条关系本身都保存1个旧DB。这只是旧系统选择过一个号，不代表候选唯一。',
 `同底盘/同位置源DB：未建立底盘映射${counts.platform_db_histogram.zero}条，单一源DB${counts.platform_db_histogram.one}条，多源DB${counts.platform_db_histogram.multiple}条。`,
 '293条单一源DB中，207条是驱动不一致，86条是车身不一致；不是293条无冲突可直接发布。',
 '263条在车身/驱动/年份等筛完后仍有多个DB；另2条筛后唯一DB与旧DB不同。',
 '',
 '规则为什么变严：',
 '首次strict审计要求明确底盘映射、相容车身/驱动、完整年款、发动机及排量覆盖，并且不靠单一可售SKU或供体推断唯一。',
 '随后unique-first已放宽缺失字段和唯一DB的发动机复用，恢复5127条关系。因此当前剩余并不主要是发动机没有逐条对应，而是映射缺失、已知矛盾及多个DB。',
 '',
 '12例诊断结果：2例原DB在明确范围获正面支持，2例有条件支持，4例旧匹配不能直接放行，4例未解决。不是全库正确率。',
 '',
 ...samples.flatMap(s=>[
  `${s.sample_id} ${s.stratum} ${s.make} ${s.model} ${s.series} ${s.position}；统计年份${s.years.join(',')}；旧DB${s.old_assigned_db.join('/')}`,
  `  结果：${s.result}。${s.conclusion}`,
  `  后续：${s.next}`,
  ...s.evidence.map(id=>`  来源：${sources[id].publisher}；${sources[id].locator}；${sources[id].url}`),
  ''
 ]),
 '建议：继续沿用底盘+位置主键及缺项不阻止真正唯一候选的方向；按规则族分开验证。',
 '可放宽的是同一车型族已证实的车身命名差异、已确认底盘别名、和有明确配置消歧的情形；采用窄范围规则。',
 '不能放宽的是跨代际、2WD/4WD已知矛盾、后盘/后鼓未知、多候选无区分字段，以及车型归属明显不正确。',
 '是否批量恢复必须依据具体规则族的验证，不按这12例合算一个“正确率”便全库恢复。',
 '数据库写入：0。'
 ];
fs.writeFileSync(path.join(ROOT,'抽查结论与候选解释.txt'),lines.join('\n')+'\n');
console.log(JSON.stringify({sample_size:12,categories,overall_accuracy_rate:null,production_changed:false,
  report:path.join(ROOT,'抽查结论与候选解释.txt')},null,2));
