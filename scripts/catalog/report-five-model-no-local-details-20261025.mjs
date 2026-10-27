import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const root = process.cwd();
for (const line of fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (!match) continue;
  process.env[match[1].trim()] = match[2].trim().replace(/^['"]|['"]$/g, "");
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
const groups = new Set(["Audi A4 / S4 Avant", "Volkswagen Golf", "Nissan Navara", "Toyota Corolla", "Suzuki Swift"]);
const unresolved = fs.readFileSync(path.join(root, "outputs", "brake-priority-unique-references-20261025", "unresolved.jsonl"), "utf8")
  .trim().split(/\r?\n/).filter(Boolean).map(JSON.parse)
  .filter((row) => groups.has(row.group) && row.reason === "no_local_reference_candidate");
const ids = unresolved.map((row) => row.application_id);

const [applications, series, variants, powertrains, links, codes] = await Promise.all([
  selectIn("vehicle_catalog_applications", "application_id", ids),
  fetchAll("vehicle_catalog_series", "series_id,code"),
  fetchAll("vehicle_catalog_variants", "variant_id,body_style,drive_type,display_name"),
  fetchAll("vehicle_catalog_powertrains", "powertrain_id,display_name,displacement_cc,fuel_type"),
  fetchAll("vehicle_catalog_powertrain_engine_codes", "powertrain_id,engine_code_id,is_primary"),
  fetchAll("vehicle_catalog_engine_codes", "engine_code_id,code"),
]);

const seriesById = new Map(series.map((row) => [row.series_id, row]));
const variantsById = new Map(variants.map((row) => [row.variant_id, row]));
const powertrainsById = new Map(powertrains.map((row) => [row.powertrain_id, row]));
const codesById = new Map(codes.map((row) => [row.engine_code_id, row.code]));
const codesByPowertrain = new Map();
for (const link of links) {
  if (!codesByPowertrain.has(link.powertrain_id)) codesByPowertrain.set(link.powertrain_id, []);
  codesByPowertrain.get(link.powertrain_id).push(codesById.get(link.engine_code_id));
}
const unresolvedById = new Map(unresolved.map((row) => [row.application_id, row]));
const output = applications.map((application) => {
  const missing = unresolvedById.get(application.application_id);
  const variant = variantsById.get(application.variant_id);
  const powertrain = powertrainsById.get(application.powertrain_id);
  return {
    application_id: application.application_id,
    group: missing.group,
    series: seriesById.get(application.series_id)?.code ?? null,
    body: variant?.body_style ?? null,
    drive: variant?.drive_type ?? null,
    years: missing.years,
    powertrain: powertrain?.display_name ?? null,
    displacement_cc: powertrain?.displacement_cc ?? null,
    engine_codes: (codesByPowertrain.get(application.powertrain_id) ?? []).filter(Boolean).sort(),
  };
}).sort((a, b) => a.group.localeCompare(b.group) || a.series.localeCompare(b.series));

const outputPath = path.join(root, "outputs", "brake-priority-unique-references-20261025", "no-local-five-model-details.json");
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ output: path.relative(root, outputPath), rows: output.length, details: output }, null, 2));

async function fetchAll(table, columns) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) return rows;
  }
}

async function selectIn(table, column, values) {
  const rows = [];
  for (let index = 0; index < values.length; index += 100) {
    const { data, error } = await db.from(table).select("*").in(column, values.slice(index, index + 100));
    if (error) throw error;
    rows.push(...(data ?? []));
  }
  return rows;
}
