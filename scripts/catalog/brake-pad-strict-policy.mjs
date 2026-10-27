// Brake-pad evidence policy. Do not reuse the wiper cross-year propagation policy.
export const POLICY_VERSION = 'BRAKE_STRICT_CONFIG_V2_2026_10_25';
export const UNIQUE_FIRST_POLICY_VERSION = 'BRAKE_UNIQUE_FIRST_V6_CONFIG_INVARIANT_2026_10_25';
export const compact = v => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export function brakeFamily(make, model) {
  const mk = {VW:'VOLKSWAGEN', FORDAUSTRALIA:'FORD'}[compact(make)] ?? compact(make);
  const md = compact(model).replace(/SERIES$/, '');
  const aliases = {MAZDA:{DEMIO:'2',MAZDA2:'2',AXELA:'3',MAZDA3:'3',ATENZA:'6',MAZDA6:'6',PREMACY:'5',MAZDA5:'5'},
    TOYOTA:{VITZ:'YARIS',KLUGER:'HIGHLANDER',LANDCRUISERPRADO:'PRADO',PRIUSC:'AQUA',
      ALPHARD:'ALPHARDVELLFIRE',VELLFIRE:'ALPHARDVELLFIRE',NOAH:'NOAHVOXY',VOXY:'NOAHVOXY',
      COROLLALEVIN:'COROLLALEVINSPRINTERTRUENO',SPRINTERTRUENO:'COROLLALEVINSPRINTERTRUENO',
      ALTIS:'COROLLA',FIELDER:'COROLLA',COROLLAFIELDER:'COROLLA',COROLLAAXIO:'COROLLA',
      HIACESBV:'HIACE',
      PREVIA:'PREVIAESTIMATARAGO',ESTIMA:'PREVIAESTIMATARAGO',TARAGO:'PREVIAESTIMATARAGO',
      PRIUSPLUS:'PRIUSV',PRIUSV:'PRIUSV'},
    NISSAN:{DUALIS:'QASHQAI',NV350:'NV350CARAVAN',CARAVAN:'NV350CARAVAN',MARCH:'MICRA'},
    KIA:{CARNIVAL:'CARNIVALGRANDCARNIVAL',GRANDCARNIVAL:'CARNIVALGRANDCARNIVAL'},
    HONDA:{FIT:'JAZZ',CIVICFERIO:'CIVIC'},
    HYUNDAI:{LANTRA:'ELANTRA',I45:'SONATA'},
    SUBARU:{LIBERTY:'LEGACY'},
    PEUGEOT:{'308SW':'308'},
    VOLKSWAGEN:{GOLFPLUS:'GOLF',GOLFVARIANT:'GOLF',GOLFSPORTWAGEN:'GOLF',GOLFALLTRACK:'GOLF'},
    MITSUBISHI:{STARWAGON:'STARWAGONDELICASPACEGEAR',DELICA:'STARWAGONDELICASPACEGEAR',SPACEGEAR:'STARWAGONDELICASPACEGEAR',
      MONTERO:'PAJERO',SHOGUN:'PAJERO',L200:'TRITON',AIRTREK:'OUTLANDER',GALANTFORTIS:'LANCER',
      PAJEROSPORT:'PAJEROSPORTCHALLENGER',CHALLENGER:'PAJEROSPORTCHALLENGER'}};
  // Allroad, performance and compound model labels are not global aliases.
  return `${mk}|${aliases[mk]?.[md] ?? md}`;
}
export function bodyKey(value) {
  const s = String(value ?? '').toLowerCase();
  if (/cab.?chassis|platform|底盘车/.test(s)) return 'cab_chassis';
  if (/pickup|pick.up|utility|\bute\b|皮卡/.test(s)) return 'pickup';
  if (/hatch|liftback|sportback|spaceback|掀背|两厢/.test(s)) return 'hatchback';
  if (/convertible|cabrio|roadster|敞篷/.test(s)) return 'convertible';
  if (/coupe|coupé|轿跑/.test(s)) return 'coupe';
  if (/sedan|saloon|limousine|轿车/.test(s)) return 'sedan';
  if (/mpv|多用途/.test(s)) return 'mpv';
  if (/suv|off.road|越野/.test(s)) return 'suv';
  if (/wagon|estate|avant|旅行/.test(s)) return 'wagon';
  if (/bus|巴士/.test(s)) return 'bus';
  if (/van|box|厢/.test(s)) return 'van';
  return '';
}
export function driveKey(value) {
  const s = String(value ?? '').toUpperCase();
  if (/AWD|4WD|4X4|四驱/.test(s)) return 'awd';
  if (/FWD|前驱/.test(s)) return 'fwd';
  if (/RWD|后驱/.test(s)) return 'rwd';
  // 4x2 / 2WD alone cannot distinguish front- and rear-wheel drive.
  return '';
}
export function chassisTokens(row) {
  return [...new Set([...String(row.seriesName ?? '').toUpperCase().matchAll(/\(([^)]+)\)/g)]
    .flatMap(m => [...m[1].split(/[,;|]+/),...m[1].split(/[,/;|]+/)])
    .map(s => s.trim().replace(/[^A-Z0-9_]/g, ''))
    .filter(s => s.length >= 2))];
}
const chassisPatternParts = value => String(value ?? '').toUpperCase()
  .split(/\s+-\s+|[,;/|]+/)
  .map(s => s.trim().replace(/[^A-Z0-9_]/g, ''))
  .filter(Boolean);
const chassisPatternRegex = pattern => new RegExp(`^${pattern.split('_').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[A-Z0-9]*')}$`);
/**
 * The vehicle catalogue uses underscore as a chassis wildcard:
 * ZN6_ = starts with ZN6, _H3_ = contains H3, _C22 = ends with C22.
 * Patterns may appear on either the NexAuto application or supplier side.
 */
export function strictChassisMatch(code, token) {
  const codes = chassisPatternParts(code), tokens = chassisPatternParts(token);
  return codes.some(a => tokens.some(b => {
    const plainA = a.replace(/_/g, ''), plainB = b.replace(/_/g, '');
    if (plainA.length < 2 || plainB.length < 2) return false;
    if (a === b) return true;
    if (a.includes('_') && !b.includes('_')) return chassisPatternRegex(a).test(b);
    if (b.includes('_') && !a.includes('_')) return chassisPatternRegex(b).test(a);
    // Two different wildcard expressions are not proof of the same chassis.
    return false;
  }));
}
/**
 * Supplier catalogues sometimes store a platform root (for example TFS, FA,
 * LW or R50) while NexAuto retains a market/body suffix (TFS77H, FA3, LW5W,
 * TAZR50). This is deliberately evaluated only after make/model family and
 * position have already matched. It is not a global substring rule.
 */
export function familyScopedDetailedChassisMatch(code, token) {
  const codes=chassisPatternParts(code),tokens=chassisPatternParts(token);
  return codes.some(rawCode=>tokens.some(rawToken=>{
    if(rawCode.includes('_')||rawToken.includes('_'))return false;
    const detailed=compact(rawCode),root=compact(rawToken);
    if(root.length<2||detailed.length<=root.length||detailed.length-root.length>4)return false;
    if(!/[A-Z]/.test(root))return false;
    return detailed.startsWith(root)||detailed.endsWith(root);
  }));
}
export function engineKeys(value) {
  return [...new Set(String(value ?? '').split('—').slice(1).join('—').split(/[/,;|]+/).map(compact).filter(Boolean))];
}
export function configEngineMatch(a, s) {
  const keys = a.engineCodes ?? engineKeys(a.engine);
  const code = keys.length > 0 && (s.engineCodes ?? []).some(c => keys.includes(compact(c)));
  const cc = Number(a.displacementCc), sc = Number(s.displacementCc);
  const displacement = cc > 0 && sc > 0 && Math.abs(cc-sc) <= Math.max(30, cc * .02);
  return code && displacement;
}
const unique = rows => [...new Set(rows.map(s => s.bendixReference).filter(Boolean))].sort();
const ids = rows => [...new Set(rows.map(s => s.sourceRowId))].sort((a,b) => a-b);
export const EVIDENCE_URLS = {
  ranger: 'https://assets.bendix.com.au/bendix-anz/downloads/Bendix-New-Releases-Vehicle-Applications-May-2023-PRJ-08340.pdf',
  rangerCrosscheck: 'https://www.terraintamer.com/4wd-products/brake-catalogue/ford-ranger-brake-pads',
};

/** An auditable verdict, not a similarity score. A unique live donor is never evidence. */
export function evaluateBrakeFitmentConservative(a, position, currentDB, familyRows) {
  const family = brakeFamily(a.make, a.model);
  const sameFamily = familyRows.filter(s => brakeFamily(s.makeName, s.modelName) === family);
  const platform = sameFamily.filter(s => s.position === position && chassisTokens(s).some(t => platformCodeMatch(family, a.series, t)));
  const years = [...new Set(a.years ?? [])].sort((x,y) => x-y);
  const reasons = [];
  const verdict = (keep, rule, used = [], extra = {}) => ({keep, rule, reasons:[...new Set(reasons)],
    platform_db:unique(platform), source_rows:ids(used), platform_source_rows:ids(platform),
    evidence_urls:[], missing_years:[], ...extra});
  if (a.status && a.status !== 'active') { reasons.push('application非active'); return verdict(false,'inactive_application'); }
  if (!platform.length) { reasons.push('没有同品牌车型及精确底盘源记录，不能仅凭年份或供体复用'); return verdict(false,'no_exact_platform'); }
  if (!years.length) { reasons.push('application缺少年份'); return verdict(false,'missing_years'); }
  const body = bodyKey(a.body), drive = driveKey(a.drive || a.variant);
  if (!body) reasons.push('车型库车身类型未知或无法可靠标准化');
  if (!drive) reasons.push('车型库驱动未知，不能把4x2自动当成后驱');
  if (reasons.length) return verdict(false,'missing_vehicle_config');
  const bodyRows = platform.filter(s => bodyKey(s.bodyStyle) === body);
  if (!bodyRows.length) { reasons.push('源表车身与application不一致'); return verdict(false,'body_mismatch'); }
  const configRows = bodyRows.filter(s => driveKey(s.driveType) === drive);
  if (!configRows.length) { reasons.push('源表驱动与application不一致'); return verdict(false,'drive_mismatch'); }
  const relevant = configRows.filter(s => years.some(y => y >= s.yearFrom && y <= s.yearTo));
  const missing = years.filter(y => !relevant.some(s => y >= s.yearFrom && y <= s.yearTo));
  if (missing.length) { reasons.push('application年份超出同车身同驱动源数据，刹车片不能自动跨年份');
    return verdict(false,'source_year_boundary',relevant,{missing_years:missing,candidate_db:unique(relevant)}); }
  // Deliberately narrow manufacturer-verified exception, not a global engine rule.
  if (family === 'FORD|RANGER' && compact(a.series) === 'PJ' && position === 'front' && drive === 'rwd'
      && ['pickup','cab_chassis'].includes(body) && Number(a.displacementCc) >= 2450 && Number(a.displacementCc) <= 2550
      && (a.engineCodes ?? engineKeys(a.engine)).some(c => compact(c) === 'WLAT16V')
      && years.every(y => y >= 2006 && y <= 2009)) {
    const exact = relevant.filter(s => s.bendixReference === 'DB1366' && configEngineMatch(a,s));
    if (years.every(y => exact.some(s => y >= s.yearFrom && y <= s.yearTo))) {
      if (currentDB !== 'DB1366') { reasons.push('PJ 2.5L后驱厂家交叉核验支持DB1366，与当前DB不一致'); return verdict(false,'verified_ranger_db_mismatch',exact,{candidate_db:['DB1366'],evidence_urls:Object.values(EVIDENCE_URLS)}); }
      return verdict(true,'manufacturer_verified_ranger_pj_25_rwd',exact,{candidate_db:['DB1366'],evidence_urls:Object.values(EVIDENCE_URLS)});
    }
  }
  const candidates = unique(relevant);
  if (candidates.length !== 1) {
    reasons.push('同底盘同车身同驱动及application年份内仍有多个DB，发动机命中不能单独消歧');
    return verdict(false,'multiple_brake_configurations',relevant,{candidate_db:candidates,
      engine_candidate_db:unique(relevant.filter(s => configEngineMatch(a,s)))});
  }
  if (candidates[0] !== currentDB) { reasons.push('严格配置源记录唯一DB与当前发布DB不同，不能自动替换'); return verdict(false,'published_db_mismatch',relevant,{candidate_db:candidates}); }
  const exactEngine = relevant.filter(s => configEngineMatch(a,s));
  const exactMissing = years.filter(y => !exactEngine.some(s => y >= s.yearFrom && y <= s.yearTo));
  if (!exactMissing.length) return verdict(true,'exact_platform_body_drive_engine_years',exactEngine,{candidate_db:candidates});
  // No unsupported engine transfer, even if the sellable subset contains one DB.
  reasons.push('源表未覆盖目标发动机及排量的全部年份，现网单一供体不能证明适用');
  return verdict(false,'unverified_engine_reuse',relevant,{candidate_db:candidates,missing_engine_years:exactMissing});
}

// Only named vehicle-family code conventions may bridge a source platform to
// a more granular local code. Never restore arbitrary substring matching.
export function platformCodeMatch(family, code, token) {
  if (strictChassisMatch(code,token)) return true;
  const a=compact(code),b=compact(token);
  // Bendix expresses the Caravan platform as E25/E26 while the NexAuto
  // backbone retains specific Japanese chassis such as VWE25 and VWME25.
  // Keep this bridge scoped to the shared Caravan/NV350 family.
  if(family==='NISSAN|NV350CARAVAN'&&['E25','E26'].includes(b)&&a.endsWith(b))return true;
  // Mercedes stores detailed type codes such as 203.006 and 205.287 while
  // supplier catalogues group the same generation as W203/S205/C205/A205.
  // Body filtering still runs after this bridge.
  if(family==='MERCEDESBENZ|CCLASS'){
    const generation=value=>compact(value).match(/^(?:W|S|C|A|CL)?(20[3-6])/)?.[1]??'';
    if(generation(a)&&generation(a)===generation(b))return true;
  }
  // European Mondeo IV code BA7 is the same generation represented by
  // MA/MB/MC in the AU/NZ supplier catalogue.  The earlier BAP/BFP/BNP body
  // codes are the hatch/sedan/wagon members of the HA-HE catalogue generation,
  // while the AU/NZ CF code is the MD generation.  Do not infer the intervening
  // B4Y/B5Y/BWY generation: the supplied Bendix extract has a real year gap for
  // that platform and mapping it to MA/MB/MC would fabricate coverage.
  if(family==='FORD|MONDEO'&&a==='BA7'&&['MA','MB','MC'].includes(b))return true;
  if(family==='FORD|MONDEO'&&['BAP','BFP','BNP'].includes(a)&&['HA','HB','HC','HD','HE'].includes(b))return true;
  if(family==='FORD|MONDEO'&&a==='CF'&&b==='MD')return true;
  // NexAuto retains Japanese detailed Lancer wagon/van chassis while Bendix
  // groups the seventh-generation family under CS_A.  This bridge establishes
  // vehicle identity only; the publication layer still refuses to choose when
  // more than one DB configuration survives the normal filters.
  if(family==='MITSUBISHI|LANCER'&&['CSW','CS2V'].includes(a)&&b==='CSA')return true;
  if (family.startsWith('TOYOTA|') && /^[A-Z]{1,4}\d{2,3}$/.test(b) && a===`${b}R`) return true;
  const prefix={
    'MAZDA|3':['BK','BL','BM','BN','BP'], 'MAZDA|6':['GG','GY','GH','GJ','GL'],
    'MAZDA|2':['DY','DE','DJ','DL'], 'MAZDA|5':['CP','CR','CW'],
    'SUBARU|IMPREZA':['GC','GF','GD','GG','GE','GH','GR','GV','GJ','GP','GK','GT','GU'],
    'SUBARU|FORESTER':['SF','SG','SH','SJ','SK','SL'],
    'SUBARU|OUTBACK':['BG','BH','BP','BR','BS','BT'],
  };
  if ((prefix[family]??[]).includes(b) && a.startsWith(b) && /^[A-Z0-9]+$/.test(a.slice(b.length)) && a.length<=b.length+4) return true;
  if (['NISSAN|XTRAIL','NISSAN|QASHQAI'].includes(family) && /^(T3[0-3]|J1[0-2])$/.test(b) && new RegExp(`^[A-Z]{0,3}${b}$`).test(a)) return true;
  return false;
}

/** User-approved unique-first publication: unknown fields are not contradictions.
 * Multiple DBs require an actually populated discriminator; a unique live donor
 * and a known different-generation chassis still cannot create a candidate.
 */
export function evaluateBrakeFitment(a, position, currentDB, familyRows) {
  const family=brakeFamily(a.make,a.model),years=[...new Set(a.years??[])].sort((x,y)=>x-y);
  const sameFamily=familyRows.filter(s=>brakeFamily(s.makeName,s.modelName)===family&&s.position===position);
  let platform=sameFamily.filter(s=>chassisTokens(s).some(t=>platformCodeMatch(family,a.series,t)));
  const warnings=[],reasons=[];let detailedChassisBridge=false,configInvariantBridge=false;
  if(!platform.length){
    const bridged=sameFamily.filter(s=>chassisTokens(s).some(t=>familyScopedDetailedChassisMatch(a.series,t)));
    if(bridged.length){platform=bridged;detailedChassisBridge=true;warnings.push('同品牌车型内采用供应商平台根码到NexAuto详细底盘码映射');}
  }
  const bridgeURLs=[];
  if(!platform.length&&family==='VOLKSWAGEN|GOLF'&&/^AU[12]$/.test(compact(a.series))){
    platform=sameFamily.filter(s=>/^GOLF VII(?: |$)/.test(s.seriesName));
    bridgeURLs.push('https://www.volkswagen-newsroom.com/en/vehicle-data-golf-7-profile-20039','https://www.volkswagen.fr/fr/entretenir-ma-volkswagen/anciens-modeles/compactes/golf-7.html');
    warnings.push('采用已核实Golf VII工厂AU与目录5G代际映射，刹车片仍按具体配置筛选');
  }
  const result=(keep,rule,used=[],extra={})=>({keep,rule,reasons:[...new Set(reasons)],warnings,
    platform_db:unique(platform),source_rows:ids(used),platform_source_rows:ids(platform),
    evidence_urls:bridgeURLs,missing_years:[],...extra});
  if(a.status&&a.status!=='active'){reasons.push('application非active');return result(false,'inactive_application');}
  if(!years.length){reasons.push('application缺少年份');return result(false,'missing_years');}
  if(!platform.length){
    // A missing chassis can be a missing-data case, but a conflicting known
    // chassis cannot be erased just because another generation has one DB.
    if(!compact(a.series)){
      platform=sameFamily.filter(s=>years.some(y=>y>=s.yearFrom&&y<=s.yearTo));
      warnings.push('目标底盘缺失，仅按同车型年份及可用配置暂发');
    }else{reasons.push('已知底盘未建立源目录映射，不能用同年其他代际代替');return result(false,'no_exact_platform');}
  }
  if(!platform.length){reasons.push('同车型年份没有源候选');return result(false,'no_exact_platform');}
  const body=bodyKey(a.body),drive=driveKey(a.drive||a.variant);
  let eligible=platform;
  if(body){const rows=eligible.filter(s=>!bodyKey(s.bodyStyle)||bodyKey(s.bodyStyle)===body);if(!rows.length){
    const dbs=unique(eligible);if(dbs.length===1&&dbs[0]===currentDB){configInvariantBridge=true;warnings.push('源目录车身分类不同，但该底盘位置所有车身仅有同一DB');}
    else{reasons.push('已知车身与所有源候选不一致');return result(false,'body_mismatch');}
  }else eligible=rows;}
  else warnings.push('目标车身缺失');
  if(drive){const rows=eligible.filter(s=>!driveKey(s.driveType)||driveKey(s.driveType)===drive);if(!rows.length){
    const dbs=unique(eligible);if(dbs.length===1&&dbs[0]===currentDB){configInvariantBridge=true;warnings.push('源目录驱动分类不同，但该底盘位置所有驱动仅有同一DB');}
    else{reasons.push('已知驱动与所有源候选不一致');return result(false,'drive_mismatch');}
  }else eligible=rows;}
  else warnings.push('目标驱动缺失');
  const allConfig=eligible;
  const overlap=eligible.filter(s=>years.some(y=>y>=s.yearFrom&&y<=s.yearTo));
  const missing=years.filter(y=>!overlap.some(s=>y>=s.yearFrom&&y<=s.yearTo));
  // Do not extend an old chassis through a year where the same catalogue has
  // already introduced another platform for the same model and axle.  This
  // catches over-wide local application ranges such as a JB43 Jimny ending up
  // with model years after the A6G/JB74 generation began.
  const competingGenerationYears=missing.filter(y=>sameFamily.some(s=>
    !platform.includes(s)&&y>=s.yearFrom&&y<=s.yearTo));
  if(competingGenerationYears.length){
    reasons.push('目标年份已有同车型其他底盘代际的源记录，不能把旧底盘唯一DB继续外推');
    return result(false,'known_generation_boundary',overlap,
      {candidate_db:unique(overlap.length?overlap:eligible),missing_years:missing,
       competing_generation_years:competingGenerationYears});
  }
  // Year can narrow candidates only when it covers the whole target. A partial
  // overlap must not silently extrapolate one DB across a possible brake change.
  if(!missing.length)eligible=overlap;
  else warnings.push(`源年款未列全目标年份：${missing.join(',')}`);
  let candidates=unique(eligible),engineNarrowed=false;
  if(candidates.length>1){
    const codes=a.engineCodes??engineKeys(a.engine);
    const exact=eligible.filter(s=>configEngineMatch(a,s));
    // Missing source codes remain plausible; never discard an unknown candidate.
    const unknown=eligible.filter(s=>!(s.engineCodes?.length)||!s.displacementCc);
    const narrowed=[...exact,...unknown];
    const narrowedDB=unique(narrowed);
    if(codes.length&&Number(a.displacementCc)>0&&exact.length&&narrowedDB.length===1){
      const engineMissing=years.filter(y=>!exact.some(s=>y>=s.yearFrom&&y<=s.yearTo));
      // Beyond source years, require agreement across all compatible chassis
      // candidates; do not extend an engine-only selection to uncovered years.
      if(!engineMissing.length){eligible=narrowed;candidates=narrowedDB;engineNarrowed=true;}
    }
  }
  if(candidates.length!==1){reasons.push('用已知车身、驱动、年份及发动机/排量后仍非唯一，需卡钳/盘径/OEM等信息');return result(false,'multiple_brake_configurations',eligible,{candidate_db:candidates,missing_years:missing,engine_candidate_db:unique(eligible.filter(s=>configEngineMatch(a,s)))});}
  if(candidates[0]!==currentDB){reasons.push('唯一候选与当前DB不同，留待确认，未自动换成其他产品');return result(false,'published_db_mismatch',eligible,{candidate_db:candidates,missing_years:missing});}
  const exact=eligible.filter(s=>configEngineMatch(a,s));
  const missingEngine=years.filter(y=>!exact.some(s=>y>=s.yearFrom&&y<=s.yearTo));
  if(missingEngine.length)warnings.push('目标发动机/排量没有完整源证据，按唯一DB暂发');
  const conservative=evaluateBrakeFitmentConservative(a,position,currentDB,familyRows);
  if(conservative.keep)return {...conservative,warnings};
  const rule=configInvariantBridge?'unique_platform_db_across_body_drive'
    :detailedChassisBridge
    ?(engineNarrowed?'family_scoped_detailed_chassis_engine_disambiguation':'family_scoped_detailed_chassis_unique')
    :(engineNarrowed?'unique_after_body_drive_year_engine_disambiguation':'unique_candidate_provisional');
  return result(true,rule,eligible,
    {candidate_db:candidates,missing_years:missing,missing_engine_years:missingEngine,provisional:true});
}
