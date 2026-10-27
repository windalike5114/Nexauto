import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { normalKey } from "./enrich-wipertech-fitments.mjs";

const SOURCE_CODE = "WIPERTECH_VERIFIED_CHASSIS_BRIDGE_2026_10_24";
const OUTPUT_DIR = path.resolve("outputs/wipertech-verified-chassis-bridges-20261024");
const SOURCE_DIR = "C:/Users/Sanli/Desktop/database/wipertech";
const RULES = [
  {
    id: "toyota_hiace_h200_bus",
    make: "TOYOTA",
    model: "HIACE",
    seriesCodes: ["KDH203R", "LH202R", "LH212R", "TRH200"],
    bodyStyles: ["bus"],
    sourceVehicleIds: ["2906", "2907"],
    expectedSourceConfigurations: ["22/21/18", "22/21/18"],
    configurationKey: "22/21/18",
    rationale: "NexAuto exact chassis codes are H200; WiperTech 200 Series Bus and Van independently agree on the complete configuration"
  },
  {
    id: "toyota_gun156_fortuner_alias",
    make: "TOYOTA",
    model: "HILUX",
    seriesCodes: ["GUN156"],
    bodyStyles: ["suv"],
    sourceVehicleIds: ["2895"],
    expectedSourceConfigurations: ["22/16/12"],
    configurationKey: "22/16/12",
    rationale: "GUN156 is the Fortuner N15/N16 SUV chassis even though NexAuto currently files the application under Hilux"
  },
  {
    id: "mitsubishi_outlander_cw5w_zg_zh_alias",
    make: "MITSUBISHI",
    model: "OUTLANDER",
    seriesCodes: ["CW5W"],
    bodyStyles: ["suv"],
    sourceVehicleIds: ["2145"],
    expectedSourceConfigurations: ["24/20/12"],
    configurationKey: "24/20/12",
    rationale: "CW5W is the Japanese chassis code for the second-generation Outlander represented by the WiperTech ZG/ZH 2006-2012 record"
  },
  {
    id: "toyota_corolla_nze14x_front_only",
    make: "TOYOTA",
    model: "COROLLA",
    seriesCodes: ["NZE141", "NZE144"],
    bodyStyles: ["sedan"],
    sourceVehicleIds: ["2843", "2844"],
    expectedSourceConfigurations: ["26/14/14", "26/14/14"],
    configurationKey: "26/14/-",
    rationale: "WiperTech E150 Sedan and E140 Wagon records corroborate the 26/14 front pair; rear is omitted because the NexAuto applications are sedans"
  },
  {
    id: "toyota_prado_120_series",
    make: "TOYOTA",
    model: "PRADO",
    seriesCodes: ["GRJ120", "GRJ121", "GRJ125", "KDJ120", "KDJ121", "KDJ125", "TRJ120", "TRJ125"],
    bodyStyles: ["suv"],
    sourceVehicleIds: ["2944"],
    expectedSourceConfigurations: ["22/21/17"],
    configurationKey: "22/21/17",
    rationale: "NexAuto 120/121/125 chassis codes are members of the WiperTech Land Cruiser Prado 120 Series platform"
  },
  {
    id: "toyota_prado_150_series",
    make: "TOYOTA",
    model: "PRADO",
    seriesCodes: ["GDJ150", "GDJ151", "GRJ150", "GRJ150R", "GRJ150W", "GRJ151", "KDJ150", "KDJ150R", "KDJ155", "KDJ155R", "TRJ150R", "TRJ150W"],
    bodyStyles: ["suv"],
    sourceVehicleIds: ["2943"],
    expectedSourceConfigurations: ["26/20/12"],
    configurationKey: "26/20/12",
    rationale: "NexAuto 150/151/155 chassis codes are members of the WiperTech Land Cruiser Prado 150 Series platform"
  },
  {
    id: "toyota_prado_j251",
    make: "TOYOTA",
    model: "PRADO",
    seriesCodes: ["GDJ251"],
    bodyStyles: ["suv"],
    sourceVehicleIds: ["2942"],
    expectedSourceConfigurations: ["22/20/12"],
    configurationKey: "22/20/12",
    rationale: "GDJ251 is an exact J251 chassis member of the WiperTech Land Cruiser Prado J251 source"
  },
  {
    id: "toyota_prius_zw40_family",
    make: "TOYOTA",
    model: "PRIUS",
    seriesCodes: ["ZVW40W", "ZVW41W"],
    bodyStyles: ["mpv"],
    sourceVehicleIds: ["2972", "2975", "2976"],
    expectedSourceConfigurations: ["26/14/10", "26/14/10", "26/14/10"],
    configurationKey: "26/14/10",
    rationale: "Prius Alpha, Prius Plus and Prius V WiperTech sources independently agree for the ZW40 family"
  },
  {
    id: "toyota_vitz_xp90_hatch",
    make: "TOYOTA",
    model: "VITZ",
    seriesCodes: ["KSP90", "KSP90R", "NCP90R", "NCP91R", "NCP95", "NLP90R", "NSP90R", "SCP90R", "ZSP90R"],
    bodyStyles: ["hatchback"],
    sourceVehicleIds: ["3035"],
    expectedSourceConfigurations: ["24/14/12"],
    configurationKey: "24/14/12",
    rationale: "The listed Toyota chassis codes are XP90 hatch variants; NexAuto years remain authoritative after platform confirmation"
  },
  {
    id: "toyota_vitz_xp90_sedan",
    make: "TOYOTA",
    model: "VITZ",
    seriesCodes: ["NCP93"],
    bodyStyles: ["sedan"],
    sourceVehicleIds: ["3036"],
    expectedSourceConfigurations: ["22/14/-"],
    configurationKey: "22/14/-",
    rationale: "NCP93 is the XP90 sedan/Belta body; the rear position is intentionally absent for the sedan"
  },
  {
    id: "toyota_vitz_xp130_hatch",
    make: "TOYOTA",
    model: "VITZ",
    seriesCodes: ["KSP130", "NCP130R", "NCP131R", "NHP130", "NSP130", "NSP135"],
    bodyStyles: ["hatchback"],
    sourceVehicleIds: ["3034"],
    expectedSourceConfigurations: ["28/-/12"],
    configurationKey: "28/-/12",
    rationale: "The listed Toyota chassis codes are XP130 hatch variants; WiperTech records the single front blade plus rear blade"
  },
  {
    id: "toyota_vitz_xp210_hatch",
    make: "TOYOTA",
    model: "VITZ",
    seriesCodes: ["KSP210", "MXPA10", "MXPA11", "MXPA12", "MXPA15", "MXPH10", "MXPH15"],
    bodyStyles: ["hatchback"],
    sourceVehicleIds: ["3033"],
    expectedSourceConfigurations: ["24/16/12"],
    configurationKey: "24/16/12",
    rationale: "The listed Toyota chassis codes are XP210 Yaris/Vitz hatch variants"
  },
  {
    id: "toyota_vitz_gr_yaris",
    make: "TOYOTA",
    model: "VITZ",
    seriesCodes: ["GXPA16"],
    bodyStyles: ["hatchback"],
    sourceVehicleIds: ["3013"],
    expectedSourceConfigurations: ["24/16/12"],
    configurationKey: "24/16/12",
    rationale: "GXPA16 is the GR Yaris chassis and uses the dedicated WiperTech Yaris GR source"
  },
  {
    id: "mazda_3_bl_hatch",
    make: "MAZDA",
    models: ["3", "AXELA"],
    seriesPrefixes: ["BL"],
    bodyStyles: ["hatchback"],
    sourceVehicleIds: ["1626"],
    expectedSourceConfigurations: ["24/19/14"],
    configurationKey: "24/19/14",
    rationale: "BL-prefixed Mazda 3/Axela hatch chassis map to WiperTech Mazda 3 BL Hatch"
  },
  {
    id: "mazda_axela_bl_sedan",
    make: "MAZDA",
    model: "AXELA",
    seriesPrefixes: ["BL"],
    bodyStyles: ["sedan"],
    sourceVehicleIds: ["1627"],
    expectedSourceConfigurations: ["21/19/14"],
    configurationKey: "21/19/14",
    rationale: "BL-prefixed Axela sedan chassis map to WiperTech Mazda 3 BL Sedan"
  },
  {
    id: "mazda_axela_bm_hatch",
    make: "MAZDA",
    model: "AXELA",
    seriesPrefixes: ["BM"],
    bodyStyles: ["hatchback"],
    sourceVehicleIds: ["1624"],
    expectedSourceConfigurations: ["24/18/12"],
    configurationKey: "24/18/12",
    rationale: "BM-prefixed Axela hatch chassis map to WiperTech Mazda 3 BM Hatch"
  },
  {
    id: "mazda_axela_bm_sedan",
    make: "MAZDA",
    model: "AXELA",
    seriesPrefixes: ["BM"],
    bodyStyles: ["sedan"],
    sourceVehicleIds: ["1625"],
    expectedSourceConfigurations: ["24/19/14"],
    configurationKey: "24/19/14",
    rationale: "BM-prefixed Axela sedan chassis map to WiperTech Mazda 3 BM Sedan"
  },
  {
    id: "mazda_axela_bn_hatch",
    make: "MAZDA",
    model: "AXELA",
    seriesPrefixes: ["BN"],
    bodyStyles: ["hatchback"],
    sourceVehicleIds: ["1622"],
    expectedSourceConfigurations: ["24/18/12"],
    configurationKey: "24/18/12",
    rationale: "BN-prefixed Axela hatch chassis map to WiperTech Mazda 3 BN Hatch"
  },
  {
    id: "mazda_axela_bn_sedan",
    make: "MAZDA",
    model: "AXELA",
    seriesPrefixes: ["BN"],
    bodyStyles: ["sedan"],
    sourceVehicleIds: ["1623"],
    expectedSourceConfigurations: ["24/18/12"],
    configurationKey: "24/18/12",
    rationale: "BN-prefixed Axela sedan chassis map to WiperTech Mazda 3 BN Sedan"
  },
  {
    id: "mazda_2_demio_de_sedan",
    make: "MAZDA",
    models: ["2", "DEMIO"],
    seriesPrefixes: ["DE"],
    bodyStyles: ["sedan"],
    sourceVehicleIds: ["1686"],
    expectedSourceConfigurations: ["24/16/14"],
    configurationKey: "24/16/14",
    rationale: "DE-prefixed Mazda 2/Demio sedan applications map to the WiperTech Demio DE Sedan source"
  },
  {
    id: "mazda_premacy_cw",
    make: "MAZDA",
    model: "PREMACY",
    seriesPrefixes: ["CW"],
    bodyStyles: ["mpv"],
    sourceVehicleIds: ["1708", "1640"],
    expectedSourceConfigurations: ["26/16/12", "26/16/12"],
    configurationKey: "26/16/12",
    rationale: "WiperTech Premacy CW and Mazda 5 CW independently agree on the complete configuration"
  },
  {
    id: "subaru_forester_sh",
    make: "SUBARU",
    model: "FORESTER",
    seriesPrefixes: ["SH"],
    bodyStyles: ["suv"],
    sourceVehicleIds: ["2639"],
    expectedSourceConfigurations: ["24/18/14"],
    configurationKey: "24/18/14",
    rationale: "SH-prefixed Forester chassis map to the WiperTech Forester SH platform"
  },
  {
    id: "subaru_forester_sj",
    make: "SUBARU",
    model: "FORESTER",
    seriesPrefixes: ["SJ"],
    bodyStyles: ["suv"],
    sourceVehicleIds: ["2638"],
    expectedSourceConfigurations: ["26/17/14"],
    configurationKey: "26/17/14",
    rationale: "SJ-prefixed Forester chassis map to the WiperTech Forester SJ platform"
  },
  {
    id: "subaru_forester_sk",
    make: "SUBARU",
    model: "FORESTER",
    seriesPrefixes: ["SK"],
    bodyStyles: ["suv"],
    sourceVehicleIds: ["2637"],
    expectedSourceConfigurations: ["26/16/14"],
    configurationKey: "26/16/14",
    rationale: "SK-prefixed Forester chassis map to the WiperTech Forester SK platform"
  },
  {
    id: "subaru_outback_br",
    make: "SUBARU",
    model: "OUTBACK",
    seriesPrefixes: ["BR"],
    bodyStyles: ["wagon"],
    sourceVehicleIds: ["2696"],
    expectedSourceConfigurations: ["26/19/14"],
    configurationKey: "26/19/14",
    rationale: "BR-prefixed Outback chassis map to the WiperTech Outback BR platform"
  },
  {
    id: "subaru_outback_bt",
    make: "SUBARU",
    model: "OUTBACK",
    seriesPrefixes: ["BT"],
    bodyStyles: ["wagon"],
    sourceVehicleIds: ["2694"],
    expectedSourceConfigurations: ["26/18/14"],
    configurationKey: "26/18/14",
    rationale: "BT-prefixed Outback chassis map to the WiperTech Outback BT platform"
  },
  {
    id: "mitsubishi_eclipse_cross_gk_gl",
    make: "MITSUBISHI",
    model: "ECLIPSE CROSS",
    seriesPrefixes: ["GK", "GL"],
    bodyStyles: ["suv"],
    sourceVehicleIds: ["2100", "2101"],
    expectedSourceConfigurations: ["24/20/12", "24/20/12"],
    configurationKey: "24/20/12",
    rationale: "Both WiperTech Eclipse Cross generations agree on the configuration for the NexAuto GK/GL chassis family"
  }
];

if (!process.argv.includes("--report-only") && !process.argv.includes("--apply")) {
  throw new Error("Choose --report-only or --apply.");
}

loadEnv(path.resolve(".env.local"));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const rawValidation = validateRawSources();
const data = await loadData(db);
const prepared = prepareCandidates(data);
const report = buildReport(prepared, rawValidation);
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUTPUT_DIR, "verified_chassis_bridge_report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

if (process.argv.includes("--apply")) {
  const applied = await applyCandidates(db, data, prepared, report);
  fs.writeFileSync(path.join(OUTPUT_DIR, "verified_chassis_bridge_applied.json"), JSON.stringify(applied, null, 2));
  console.log(JSON.stringify({ applied: true, ...applied }, null, 2));
}

function validateRawSources() {
  const vehicles = readCsv(path.join(SOURCE_DIR, "wipertech_vehicles.csv"));
  const mappings = readCsv(path.join(SOURCE_DIR, "wipertech_mapping.csv"));
  const wipers = readCsv(path.join(SOURCE_DIR, "wipertech_wipers.csv"));
  const vehicleById = new Map(vehicles.map((row) => [row.vehicle_id, row]));
  const wiperById = new Map(wipers.map((row) => [row.product_id, row]));
  const mappingByVehicle = groupBy(mappings, (row) => row.vehicle_id);
  const validated = [];
  for (const rule of RULES) {
    const actualConfigurations = rule.sourceVehicleIds.map((vehicleId) => {
      const vehicle = vehicleById.get(vehicleId);
      if (!vehicle) throw new Error(`Missing WiperTech vehicle ${vehicleId} for ${rule.id}.`);
      const positions = new Map();
      for (const mapping of mappingByVehicle.get(vehicleId) ?? []) {
        const wiper = wiperById.get(mapping.product_id);
        if (!wiper) throw new Error(`Missing WiperTech product ${mapping.product_id} for vehicle ${vehicleId}.`);
        positions.set(mapping.position, Number(wiper.size_inch));
      }
      return `${positions.get("driver") ?? "-"}/${positions.get("passenger") ?? "-"}/${positions.get("rear") ?? "-"}`;
    });
    if (actualConfigurations.join("|") !== rule.expectedSourceConfigurations.join("|")) {
      throw new Error(`Raw source configuration changed for ${rule.id}: ${actualConfigurations.join(", ")}.`);
    }
    validated.push({
      ruleId: rule.id,
      sourceVehicleIds: rule.sourceVehicleIds,
      sourceConfigurations: actualConfigurations,
      targetConfiguration: rule.configurationKey
    });
  }
  return validated;
}

function prepareCandidates(data) {
  const variantById = new Map(data.variants.map((row) => [row.variant_id, row]));
  const seriesById = new Map(data.series.map((row) => [row.series_id, row]));
  const modelById = new Map(data.models.map((row) => [row.model_id, row]));
  const makeById = new Map(data.makes.map((row) => [row.make_id, row]));
  const yearsByApplication = groupBy(data.years, (row) => row.application_id);
  const publishedByApplication = groupBy(data.published, (row) => row.application_id);
  const duplicates = [...publishedByApplication.entries()].filter(([, rows]) => rows.length > 1);
  if (duplicates.length) throw new Error(`Found ${duplicates.length} applications with duplicate published fitments.`);

  const candidates = [];
  const alreadyPublished = [];
  for (const application of data.applications.filter((row) => row.status === "active")) {
    const generation = seriesById.get(application.series_id);
    const variant = variantById.get(application.variant_id);
    const model = modelById.get(application.model_id);
    const make = makeById.get(model?.make_id);
    const rule = RULES.find((item) =>
      normalKey(make?.name) === normalKey(item.make) &&
      (item.models ?? [item.model]).some((name) => normalKey(model?.name) === normalKey(name)) &&
      matchesSeries(generation?.code, item) &&
      item.bodyStyles.includes(normalKey(variant?.body_style))
    );
    if (!rule) continue;
    const target = {
      applicationId: application.application_id,
      ruleId: rule.id,
      make: make.name,
      model: model.name,
      seriesCode: generation.code,
      bodyStyle: variant.body_style,
      years: (yearsByApplication.get(application.application_id) ?? []).map((row) => Number(row.model_year)).sort((a, b) => a - b),
      configurationKey: rule.configurationKey,
      sourceVehicleIds: rule.sourceVehicleIds,
      rationale: rule.rationale
    };
    if (publishedByApplication.has(application.application_id)) alreadyPublished.push(target);
    else candidates.push(target);
  }
  return { candidates, alreadyPublished, duplicates };
}

function matchesSeries(seriesCode, rule) {
  const normalized = normalKey(seriesCode);
  return (rule.seriesCodes ?? []).some((code) => normalKey(code) === normalized) ||
    (rule.seriesPrefixes ?? []).some((prefix) => normalized.startsWith(normalKey(prefix)));
}

function buildReport(prepared, rawValidation) {
  return {
    source: SOURCE_CODE,
    policy: "exact verified chassis bridge; WiperTech raw source configuration must pass local validation; front-only when rear applicability is not shared",
    rawValidation,
    candidates: prepared.candidates.length,
    candidateApplicationYears: prepared.candidates.reduce((sum, row) => sum + row.years.filter((year) => year >= 2010 && year <= 2026).length, 0),
    alreadyPublishedMatchingRule: prepared.alreadyPublished.length,
    duplicatePublishedApplicationsBefore: prepared.duplicates.length,
    byRule: countBy(prepared.candidates, (row) => row.ruleId),
    byConfiguration: countBy(prepared.candidates, (row) => row.configurationKey),
    rows: prepared.candidates
  };
}

async function applyCandidates(client, data, prepared, report) {
  const backupDir = await writeBackup(client, report);
  const configurationByKey = new Map(data.configurations.map((row) => [row.configuration_key, row.id]));
  for (const key of new Set(prepared.candidates.map((row) => row.configurationKey))) {
    if (configurationByKey.has(key)) continue;
    const [driver, passenger, rear] = key.split("/").map((value) => value === "-" ? null : Number(value));
    const { data: id, error } = await client.rpc("upsert_partial_wiper_configuration", {
      p_driver_length_in: driver,
      p_passenger_length_in: passenger,
      p_rear_length_in: rear
    });
    if (error) throw error;
    configurationByKey.set(key, id);
  }

  const now = new Date().toISOString();
  const payload = prepared.candidates.map((row) => ({
    application_id: row.applicationId,
    wiper_configuration_id: configurationByKey.get(row.configurationKey),
    fitment_status: "published",
    source: SOURCE_CODE,
    notes: [
      `rule=${row.ruleId}`,
      `configuration=${row.configurationKey}`,
      `series_code=${row.seriesCode}`,
      `body_style=${row.bodyStyle}`,
      `wipertech_vehicle_ids=${row.sourceVehicleIds.join(",")}`,
      `rationale=${row.rationale}`
    ].join("; "),
    updated_at: now
  }));
  for (const rows of chunks(payload, 200)) {
    const { error } = await client.from("vehicle_catalog_wiper_fitments").upsert(rows, { onConflict: "application_id,wiper_configuration_id" });
    if (error) throw error;
  }

  const verified = await selectInChunks(client, "vehicle_catalog_wiper_fitments", "application_id,wiper_configuration_id,fitment_status,source", "application_id", payload.map((row) => row.application_id));
  const published = verified.filter((row) => row.fitment_status === "published");
  const byApplication = groupBy(published, (row) => row.application_id);
  const expected = new Map(payload.map((row) => [row.application_id, row.wiper_configuration_id]));
  const invalid = payload.filter((row) => {
    const rows = byApplication.get(row.application_id) ?? [];
    return rows.length !== 1 || rows[0].wiper_configuration_id !== expected.get(row.application_id);
  });
  if (invalid.length) throw new Error(`Post-apply verification failed for ${invalid.length} applications.`);
  return {
    appliedAt: now,
    backupDir,
    publishedApplications: payload.length,
    publishedApplicationYears2010To2026: report.candidateApplicationYears,
    duplicateTargetApplications: 0,
    missingOrWrongTargetApplications: 0,
    totalPublishedApplications: await exactCount(client, "vehicle_catalog_wiper_fitments", (query) => query.eq("fitment_status", "published"))
  };
}

async function loadData(client) {
  const [applications, years, variants, series, models, makes, published, configurations] = await Promise.all([
    fetchAll(client, "vehicle_catalog_applications", "application_id,model_id,series_id,variant_id,status"),
    fetchAll(client, "vehicle_catalog_application_years", "application_id,model_year"),
    fetchAll(client, "vehicle_catalog_variants", "variant_id,body_style,display_name"),
    fetchAll(client, "vehicle_catalog_series", "series_id,model_id,code,display_name,status"),
    fetchAll(client, "vehicle_catalog_models", "model_id,make_id,name,status"),
    fetchAll(client, "vehicle_catalog_makes", "make_id,name,status"),
    fetchAll(client, "vehicle_catalog_wiper_fitments", "application_id,wiper_configuration_id,fitment_status,source", (query) => query.eq("fitment_status", "published")),
    fetchAll(client, "wiper_configurations", "id,configuration_key")
  ]);
  return { applications, years, variants, series, models, makes, published, configurations };
}

async function writeBackup(client, report) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = path.resolve("tmp/production-backups", `wipertech-verified-chassis-${stamp}`);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "vehicle_catalog_wiper_fitments.json"), JSON.stringify(await fetchAll(client, "vehicle_catalog_wiper_fitments", "*"), null, 2));
  fs.writeFileSync(path.join(directory, "manifest.json"), JSON.stringify({ createdAt: new Date().toISOString(), source: SOURCE_CODE, report }, null, 2));
  return directory;
}

function readCsv(file) {
  const lines = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => Object.fromEntries(parseCsvLine(line).map((value, index) => [headers[index], value])));
}

function parseCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') { value += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) { values.push(value); value = ""; }
    else value += character;
  }
  values.push(value);
  return values;
}

function loadEnv(file) {
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

function groupBy(values, keyFn) {
  const output = new Map();
  for (const value of values) {
    const key = keyFn(value);
    const rows = output.get(key) ?? [];
    rows.push(value);
    output.set(key, rows);
  }
  return output;
}

function countBy(values, keyFn) {
  const output = {};
  for (const value of values) {
    const key = keyFn(value);
    output[key] = (output[key] ?? 0) + 1;
  }
  return output;
}

function chunks(values, size) {
  const output = [];
  for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size));
  return output;
}

async function fetchAll(client, table, columns, applyFilter = (query) => query) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await applyFilter(client.from(table).select(columns)).range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

async function selectInChunks(client, table, columns, column, values) {
  const output = [];
  for (const batch of chunks([...new Set(values)], 200)) {
    const { data, error } = await client.from(table).select(columns).in(column, batch);
    if (error) throw error;
    output.push(...data);
  }
  return output;
}

async function exactCount(client, table, applyFilter = (query) => query) {
  const { count, error } = await applyFilter(client.from(table).select("*", { count: "exact", head: true }));
  if (error) throw error;
  return count ?? 0;
}
