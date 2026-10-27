// Narrow, evidence-reviewed rules only. Do not replace the existing global policy.
import {family,normalizeBendix,normalizeTopstar,assessPosition} from './brake-popular50-script-first-policy.mjs';
import {bodyKey,compact} from './brake-pad-strict-policy.mjs';
export const POLICY='BRAKE_VERIFIED_ALIAS_GROUPS_20261025';
export const EVIDENCE={
  focus:{url:'https://www.nibk.jp/catalogue/cars/brake/1191/PN0365',claim:'PN0365 cross DB1679; Focus II 11.2004–09.2012 SDN/HB/EST, front PN0365. Rear has PN2702 and FN51001 alternatives; no blanket rear publication.'},
  focusIdentity:{url:'https://catalogonuevo.icerbrakes.com/Producto/Details?idProducto=181651',claim:'Manufacturer application headers identify Focus II DA_/HCP/DP, DB_/FCH/DH and Focus C-MAX DM2 separately.'},
  cx5:{url:'https://www.acre.jp/mazda/cx-5.html',claim:'KE codes KEEFW/KEEAW/KE2FW/KE2AW are CX-5; same front 420. Rear changes with EPB in 2015; do not force a rear DB.'},
  cx5codes:{url:'https://www.mazda.co.jp/content/dam/mazda/official/mazda-co-jp/owner-support/accessories/info_lib-history/pdf/web_cat/cx-5/cx-5_1507.pdf',claim:'Mazda CX-5 accessories catalogue lists KE2AW/KE2FW/KEEFW/KE5AW/KE5FW chassis numbers.'},
  cx3:{url:'https://catalogonuevo.icerbrakes.com/Producto/Details?idProducto=182056',claim:'CX-3 (DK) manufacturer fitments explicitly name DK2WS/DK5FW, DK4WS/DK5AW, DK2W7/DKEFW, DK4W7/DKEAW. Identity evidence is not full brake interchange evidence.'},
  cx3front:{url:'https://www.nibk.jp/catalogue/cars/brake/503490/PN25005',claim:'PN25005 cross DB2330; direct CX-3 chassis entries. Rear PN25001 and PN5819 differ by configuration/date.'},
  cx3epb:{url:'https://www.acre.jp/mazda/cx-3.html',claim:'CX-3 2.0 rear changes to EPB type from 05.2018. 1.5 diesel and 1.8 diesel are distinct configurations. Do not publish DB2227 across the change.'},
  sfFront:{url:'https://www.nibk.jp/catalogue/bikes/brake/1669/PN7390',claim:'SF9 2.5 EJ254 08.1998–06.2002 front PN7390 cross DB1342, single front entry.'},
  sfRear:{url:'https://www.nibk.jp/catalogue/bikes/brake/659364/PN7415S',claim:'SF9 2.5 EJ254 08.1998–06.2002 rear PN7415 cross DB1379. This does not support every SF/SG configuration.'},
  golfBC1:{url:'https://www.texafrance.fr/wp-content/uploads/2022/04/Communication-TD-20-24-Mise-a-jour-V76.6.1-CAR.pdf',claim:'TEXA manufacturer PDF p30 explicitly identifies Golf VII 2012–2020 (5G1/BC1). Only identity bridge; retain source brake configuration and dates.'},
  golf9B1:{url:'https://segalcorp.com/product/segal-no-se-8188-18/',claim:'Manufacturer page names Golf IV (1J1,9B1), 1997–2005. Source DB candidates still control front/rear selection.'},
  bmw:{url:'https://www.bmw.co.uk/en/takata-airbag-recall.html',claim:'BMW explicitly lists X3 (E83,F25) separately from 3 Series. Identity correction only, not brake fitment proof.'},
  dmax:{url:'https://terraintamer.com/sq/documents/parts/brake-catalogue/257-fortified-brake-pads/file',claim:'Terrain Tamer manufacturer catalogue search extraction lists D Max TFR85 2007–2020 and TFS85 01.2007–06.2020 front DB1841F, standard flat rotor. Source closed-year/configuration support is still required.'},
  golfNorthAmerica:{url:'https://erwin.vw.com/erwin/downloadStaticFile/volkswagen/files/VW_Erwin_Build_Guide.pdf',claim:'Volkswagen erWin build guide identifies Golf/GTI AU2 and Golf SportWagen/Alltrack BX6; the saved supplier rows remain responsible for DB, position, engine and year selection.'},
  golfServiceModels:{url:'https://vw-us.erwin-store.com/erwin/showArticleProperties.do?articleId=163227',claim:'Volkswagen erWin model list identifies BX5 and BX6 as Golf Variant / Golf Alltrack / Golf Sportwagen sales types.'},
  golfBC2:{url:'https://d2pautoparts.com/products/front-axle-subframe-crossmember-for-audi-seat-skoda-and-vw-5q0199315r',claim:'Independent application catalogue groups BC2 with Golf VII 5G1/BQ1/BE1/BE2 for matching engines. Publication still requires body, drive, years and the supplier DB to remain deterministic.'},
  cx5kf:{url:'https://www.mazda.co.jp/globalassets/assets/carlife/accessories/support/info_lib/history/common/pdf/ac-catalog/cx-5/cx-5_1706.pdf',claim:'Mazda CX-5 genuine accessories catalogue explicitly lists KFEP, KF2P and KF5P chassis numbers.'},
  audiB8:{url:'https://www.schaeffler.com/remotemedien/media/_shared_media/08_media_library/01_publications/automotiveaftermarket/catalogs/download_5/july_2019/Nouveautes_LuK_VL_07-2019.pdf',claim:'Schaeffler manufacturer catalogue identifies Audi A4 B8 as 8K2/8K5. Topstar supplier rows provide the brake DB references; this identity evidence does not collapse multiple front DBs.'},
  hondaFitGs:{url:'https://www.honda.co.jp/Fit/common/pdf/fit_spec_list.pdf',claim:'Honda FIT official specifications identify 5BA-GS4/GS5/GS6/GS7 with L15Z. Exact duplicate applications under model Z are catalogue ownership errors.'},
  toyotaCamryGracia:{url:'https://www.toyota-global.com/company/history_of_toyota/75years/vehicle_lineage/car/id60002190A/index.html',claim:'Toyota official vehicle lineage identifies MCV21/MCV21W with 2MZ-FE as Camry Gracia. Exact duplicate IST/Vista/Mark II records using these Camry codes are ownership errors.'},
};
export const CX3_CODES=['DK2WS','DK4WS','DK5FW','DK5AW','DK2W7','DK4W7','DKEFW','DKEAW'];
export const RULES=[
  {id:'CX5_KE_EXPLICIT_CODES',kind:'chassis_alias',evidence:['cx5','cx5codes'],family:'MAZDA|CX5',codes:['KEEFW','KEEAW','KE2FW','KE2AW','KE5FW','KE5AW'],token:'KE'},
  {id:'CX3_DK_EXPLICIT_CODES',kind:'chassis_alias',evidence:['cx3','cx3front','cx3epb'],family:'MAZDA|CX3',codes:CX3_CODES,token:'DK'},
  {id:'GOLF_BC1_5G1',kind:'chassis_alias',evidence:['golfBC1'],family:'VOLKSWAGEN|GOLF',codes:['BC1'],token:'5G1',from:2012,to:2020},
  {id:'GOLF_BC2_5G1',kind:'chassis_alias',evidence:['golfBC2'],family:'VOLKSWAGEN|GOLF',codes:['BC2'],token:'5G1',from:2012,to:2021},
  {id:'GOLF_BX5_BX6_BA5',kind:'chassis_alias',evidence:['golfNorthAmerica','golfServiceModels'],family:'VOLKSWAGEN|GOLF',codes:['BX5','BX6'],token:'BA5',from:2013,to:2020},
  {id:'GOLF_9B1_1J1',kind:'chassis_alias',evidence:['golf9B1'],family:'VOLKSWAGEN|GOLF',codes:['9B1'],token:'1J1',from:1997,to:2005},
  {id:'CX5_KF_EXPLICIT_CODES',kind:'chassis_alias',evidence:['cx5kf'],family:'MAZDA|CX5',codes:['KFEP','KF2P','KF5P'],token:'KF',from:2016,to:2026},
  // Evidence-only rule entry for the synthetic Topstar B8 -> 8K2 rows below.
  // The token is deliberately impossible so the generic bridge loop does not
  // create a second copy of those rows.
  {id:'AUDI_A4_B8_8K2',kind:'supplier_identity_bridge',evidence:['audiB8'],family:'AUDI|A4',codes:['8K2'],token:'__SYNTHETIC_ONLY__'},
  {id:'DMAX_TFR85_TFS85',kind:'chassis_alias',evidence:['dmax'],family:'ISUZU|DMAX',codes:['TFR85'],token:'TFR',from:2007,to:2020},
  {id:'DMAX_TFS85_TFR85',kind:'chassis_alias',evidence:['dmax'],family:'ISUZU|DMAX',codes:['TFS85'],token:'TFS',from:2007,to:2020},
];
export function augmentSources(sourceRows,catalog){
  const sources=[...normalizeBendix(sourceRows),...normalizeTopstar(catalog)];
  for(const rule of RULES)for(const s of [...sources].filter(s=>s.family===rule.family&&s.tokens.includes(rule.token))){
    for(const code of rule.codes)sources.push({...s,source_id:`A:${rule.id}:${code}:${s.source_id}`,original_source_id:s.source_id,tokens:[code],rule_id:rule.id,
      bridge_years:rule.from?Array.from({length:rule.to-rule.from+1},(_,i)=>i+rule.from):undefined});
  }
  // Topstar's A4 B8 rows carry the platform in the model/engine description
  // rather than the chassis column. Create a narrow 8K2 identity bridge; front
  // DB2184/DB2186 both remain visible and therefore still require review.
  for(const p of catalog)for(const [i,r] of p.fitments.entries()){
    if(compact(r.make)!=='AUDI'||!String(r.model??'').toUpperCase().includes('A4')||compact(r.engine)!=='B8')continue;
    for(const position of ['front','rear'].filter(pos=>String(p.position).toLowerCase().includes(pos)))sources.push({
      source_id:`A:AUDI_A4_B8_8K2:${p.sku}:${i+1}:${position}`,original_source_id:`T:${p.sku}:${i+1}:${position}`,
      source_kind:'verified_supplier_identity_bridge',source_file:'brakepad_fitment_with_sku.csv (normalized catalog.json)',
      source_sku:p.sku,family:'AUDI|A4',make:'AUDI',model:'A4',series:'A4 B8 (8K2)',tokens:['8K2'],
      from:null,to:null,body:'sedan',drive:'',engine_codes:[],displacement_cc:null,position,db:p.supplierRef,
      year_kind:'not_supplied_chassis_only',rule_id:'AUDI_A4_B8_8K2'});
  }
  return sources;
}
export function identityCorrection(a){
  const f=family(a.make,a.model),code=compact(a.series);
  // Exact duplicate application cases exposed by the NexAuto catalogue: the
  // series, variant, powertrain and complete year set are present under the
  // correct model as well.  The merge processor still requires exactly one
  // canonical peer before it can apply any of these corrections.
  if(a.make==='BMW'&&a.model==='3'&&code==='I01'&&bodyKey(a.body)==='hatchback')return {model:'i3',rule_id:'BMW_I01_MISCLASSIFIED_AS_3',evidence:[]};
  if(a.make==='BMW'&&a.model==='3'&&code==='G45'&&bodyKey(a.body)==='suv')return {model:'X3',rule_id:'BMW_G45_MISCLASSIFIED_AS_3',evidence:['bmw']};
  if(a.make==='BMW'&&a.model==='3'&&code==='NA5'&&bodyKey(a.body)==='suv')return {model:'iX3',rule_id:'BMW_NA5_MISCLASSIFIED_AS_3',evidence:[]};
  if(a.make==='BMW'&&a.model==='3'&&code==='E36'&&bodyKey(a.body)==='coupe'&&a.engine_codes.some(c=>compact(c).startsWith('S54B32')))return {model:'Z3',rule_id:'BMW_Z3_E36_S54_MISCLASSIFIED_AS_3',evidence:[]};
  if(a.make==='MAZDA'&&['2','3'].includes(a.model)&&/^(BJ|BG)/.test(code))return {model:'323',rule_id:`MAZDA_323_${code}_MISCLASSIFIED_AS_${a.model}`,evidence:[]};
  if(a.make==='MAZDA'&&a.model==='2'&&/^(GF|GW)/.test(code))return {model:'626',rule_id:`MAZDA_626_${code}_MISCLASSIFIED_AS_2`,evidence:[]};
  if(a.make==='MAZDA'&&a.model==='5'&&code.startsWith('NB')&&bodyKey(a.body)==='convertible')return {model:'MX-5',rule_id:'MAZDA_MX5_NB_MISCLASSIFIED_AS_5',evidence:[]};
  if(a.make==='MAZDA'&&a.model==='5'&&code.startsWith('KE')&&bodyKey(a.body)==='suv')return {model:'CX-5',rule_id:'MAZDA_CX5_KE_MISCLASSIFIED_AS_5',evidence:['cx5','cx5codes']};
  if(a.make==='MAZDA'&&a.model==='5'&&code.startsWith('SY')&&bodyKey(a.body)==='cab_chassis')return {model:'TITAN DASH 1,0 t - 1,5 t',rule_id:'MAZDA_TITAN_DASH_SY_MISCLASSIFIED_AS_5',evidence:[]};
  if(a.make==='VOLKSWAGEN'&&a.model==='GOLF'&&['5M1','521'].includes(code))return {model:'GOLF PLUS',rule_id:'VW_GOLF_PLUS_MISCLASSIFIED_AS_GOLF',evidence:[]};
  if(a.make==='VOLKSWAGEN'&&a.model==='GOLF'&&/^(1T|5T)/.test(code)&&bodyKey(a.body)==='mpv')return {model:'TOURAN',rule_id:'VW_TOURAN_MISCLASSIFIED_AS_GOLF',evidence:[]};
  if(a.make==='TOYOTA'&&a.model==='HILUX'&&bodyKey(a.body)==='suv'&&/^(TRN21|VZN21|GRN21|KDN21|RZN21)/.test(code))return {model:'HILUX SURF',rule_id:'TOYOTA_HILUX_SURF_MISCLASSIFIED_AS_HILUX',evidence:[]};
  if(a.make==='TOYOTA'&&['YARIS','VITZ'].includes(a.model)&&bodyKey(a.body)==='mpv'&&code.startsWith('NCP2'))return {model:'FUNCARGO',rule_id:'TOYOTA_FUNCARGO_MISCLASSIFIED_AS_YARIS_VITZ',evidence:[]};
  if(a.make==='TOYOTA'&&['YARIS','VITZ'].includes(a.model)&&bodyKey(a.body)==='suv'&&code.startsWith('MXP'))return {model:'YARIS CROSS',rule_id:'TOYOTA_YARIS_CROSS_MISCLASSIFIED_AS_YARIS_VITZ',evidence:[]};
  if(a.make==='FORD'&&a.model==='E'&&String(a.body??'').toUpperCase().includes('UTILITY')&&a.engine_codes.some(c=>compact(c)==='T30VVEX'))return {model:'RANGER',rule_id:'FORD_RANGER_T30VVEX_MISCLASSIFIED_AS_E',evidence:[]};
  if(a.make==='HONDA'&&a.model==='Z'&&/^GS[4-7]$/.test(code)&&bodyKey(a.body)==='hatchback'&&a.engine_codes.some(c=>compact(c)==='L15Z'))return {model:'JAZZ',rule_id:'HONDA_FIT_JAZZ_GS_MISCLASSIFIED_AS_Z',evidence:['hondaFitGs']};
  if(a.make==='HYUNDAI'&&a.model==='SANTA FE V'&&code==='MX5'&&bodyKey(a.body)==='suv')return {model:'SANTA FE',rule_id:'HYUNDAI_SANTA_FE_V_DUPLICATE_MODEL',evidence:[]};
  if(a.make==='TOYOTA'&&['IST','VISTA','VIENTA','MARK II'].includes(a.model)&&/^(MCV20R?|MCV21W?|SAV22)$/.test(code))return {model:'CAMRY',rule_id:`TOYOTA_CAMRY_${code}_MISCLASSIFIED_AS_${compact(a.model)}`,evidence:['toyotaCamryGracia']};
  const bmwX={
    'BMW|1':{model:'X1',codes:['E84','F48','F49','U11','U12']},
    'BMW|2':{model:'X2',codes:['F39','U10']},
    'BMW|3':{model:'X3',codes:['E83','F25','G01','F97','G08']},
    'BMW|4':{model:'X4',codes:['F26','G02','F98']},
    'BMW|5':{model:'X5',codes:['E53','E70','F15','F85','G05','F95']},
    'BMW|6':{model:'X6',codes:['E71','E72','F16','F86','G06','F96']},
    'BMW|7':{model:'X7',codes:['G07']},
  }[f];
  if(bmwX?.codes.includes(code)&&bodyKey(a.body)==='suv')return {model:bmwX.model,rule_id:`BMW_${bmwX.model}_MISCLASSIFIED_AS_${a.model}`,evidence:['bmw']};
  if(f==='MAZDA|3'&&CX3_CODES.includes(code)&&bodyKey(a.body)==='suv')return {model:'CX-3',rule_id:'MAZDA_CX3_MISCLASSIFIED_AS_3',evidence:['cx3','cx3front']};
  if(f==='FORD|FOCUS'&&code==='DM2'&&bodyKey(a.body)==='mpv')return {model:'FOCUS C-MAX',rule_id:'FOCUS_CMAX_MISCLASSIFIED_AS_FOCUS',evidence:['focusIdentity']};
  return null;
}
export function assessReviewed(a,position,sources,productsByDB){
  let local=sources.filter(s=>s.family===family(a.make,a.model));
  let ruleIDs=[];const evidence=[];
  const sf=a.make==='SUBARU'&&a.model==='FORESTER'&&['SF_','SF9'].includes(a.series)
    &&bodyKey(a.body)==='wagon'&&Number(a.displacement_cc)>=2450&&Number(a.displacement_cc)<=2550
    &&a.all_years.every(y=>y>=1998&&y<=2002);
  if(sf){
    // A single verified SF9 2.5 subgroup. Never globally equate wagon and SUV.
    ruleIDs.push('FORESTER_SF9_25_WAGON_SUV');evidence.push('sfFront','sfRear');
    local=local.map(s=>s.tokens.includes('SF_')&&bodyKey(s.body)==='suv'?{...s,body:a.body,rule_id:'FORESTER_SF9_25_WAGON_SUV'}:s);
  }
  const focus=a.make==='FORD'&&a.model==='FOCUS'&&['DA_','HCP','DP','DB_','FCH','DH','FFS','DS'].includes(a.series)
    &&['hatchback','sedan','wagon'].includes(bodyKey(a.body))&&a.drive==='FWD';
  // Identity guard, not an engine-primary brake key: imported DA_ rows also
  // contain first-generation FYD/FXD/EYD/F9D/EDD/ALDA engines in 2004.
  const focusIIEngine=a.engine_codes.some(c=>/^(ASDA|ASDB|HWDA|HWDB|SHDA|SHDB|SHDC|HXDA|HXDB|SIDA|G8D[A-Z]|GPD[A-C]|HHDA|HHDB|QQD[A-C]|Q7DA|KKDA|G6D[A-Z]|IXDA|AODA|AODB|AODE|SYDA)$/.test(compact(c)));
  if(focus&&focusIIEngine&&position==='front'&&a.all_years.every(y=>y>=2004&&y<=2012)&&a.displacement_cc>=1300&&a.displacement_cc<=2050){
    local.push({source_id:`V:FOCUS_II_FRONT:${a.series}`,source_kind:'manufacturer_direct_verification',source_file:EVIDENCE.focus.url,
      family:'FORD|FOCUS',tokens:[a.series],series:'Focus II manufacturer SDN/HB/EST',position:'front',db:'DB1679',from:2004,to:2012,
      year_kind:'closed',body:a.body,drive:'fwd',engine_codes:[],displacement_cc:null,rule_id:'FOCUS_II_VERIFIED_FRONT'});
    ruleIDs.push('FOCUS_II_VERIFIED_FRONT');evidence.push('focus','focusIdentity');
  }
  const r=assessPosition(a,position,local,{productsByDB,existing:a.existing,identityFlags:identityCorrection(a)?[{kind:'confirmed_wrong_model'}]:[]});
  ruleIDs.push(...r.source_ids.map(id=>local.find(s=>s.source_id===id)?.rule_id).filter(Boolean));
  for(const id of ruleIDs)evidence.push(...(RULES.find(r=>r.id===id)?.evidence??[]));
  if(focus&&position==='rear'){
    r.status='review_brake_configuration';r.reason='Focus II厂家目录同时列后盘片PN2702和后鼓蹄FN51001；目标没有后盘/后鼓字段，不能以一个DB排除鼓刹';
    r.action='none';evidence.push('focus');
  }
  if(focus&&!focusIIEngine){
    r.status='review_identity_risk';r.reason='Focus II底盘代码下包含一代发动机/年款边界记录，本轮不把该身份矛盾当作单纯别名';r.action='none';evidence.push('focusIdentity');
  }
  if(a.make==='TOYOTA'&&a.model==='CAMRY'&&['MCV20','MCV20R'].includes(a.series)&&a.all_years.includes(1996)){
    r.status='review_year_or_config';r.reason='MCV20 3.0已读Bosch目录始于1997，1996年不能由旧表3VZ-FE行代替1MZ-FE证明';r.action='none';
  }
  if(family(a.make,a.model)==='MAZDA|CX3'&&position==='rear'&&a.all_years.some(y=>y>=2018)){
    r.status='review_brake_configuration';r.reason='CX-3后片存在2018电子手刹切换；旧源单DB不能排除EPB配置，需确认手刹/生产月份或后片DB';r.action='none';evidence.push('cx3epb','cx3front');
  }
  r.rule_ids=[...new Set(ruleIDs)];r.evidence_keys=[...new Set(evidence)];r.evidence_urls=r.evidence_keys.map(k=>EVIDENCE[k].url);
  return r;
}
