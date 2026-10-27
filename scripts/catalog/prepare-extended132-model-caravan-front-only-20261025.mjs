import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const INPUT = path.resolve(ROOT, "outputs/extended132-model-caravan-nv350-wiper-20261025/blocked.jsonl");
const SOURCE = path.resolve(ROOT, "outputs/wipertech-enrichment-20261022/wipertech_enriched_data.json");
const OUT = path.resolve(ROOT, "outputs/extended132-model-caravan-nv350-front-only-20261025");
const rows = readJsonl(INPUT);
if (rows.length !== 9) throw new Error(`Expected 9 E26 Bus rows, found ${rows.length}.`);

const source = JSON.parse(fs.readFileSync(SOURCE, "utf8"));
const sourceRows = [...(source.enriched ?? []), ...(source.sourceRows ?? [])];
const evidence = sourceRows.find((row) => String(row.vehicle_id) === "2202");
if (!evidence) throw new Error("Missing WiperTech vehicle_id 2202.");
const evidenceKey = [evidence.driver_in || "-", evidence.passenger_in || "-", evidence.rear_in || "-"].join("/");
if (String(evidence.make).toUpperCase() !== "NISSAN" || String(evidence.model).toUpperCase() !== "CARAVAN"
  || String(evidence.series).toUpperCase() !== "E26, NV350" || String(evidence.body).toLowerCase() !== "van"
  || Number(evidence.year_from) !== 2012 || Number(evidence.year_to) !== 2026 || evidenceKey !== "17/17/-") {
  throw new Error(`Unexpected WiperTech 2202 identity/configuration: ${JSON.stringify(evidence)}`);
}

const safe = rows.map((row) => {
  const years = [...row.years].map(Number).sort((a, b) => a - b);
  const sourceIds = (row.chassis_only_source_vehicle_ids ?? []).map(String);
  if (row.make !== "NISSAN" || row.model !== "NV350" || row.generation !== "e26_nv350"
    || !/E26$/.test(row.series_code) || row.body_style !== "bus" || row.applications !== 1
    || row.application_ids?.length !== 1 || years.length !== 15 || years[0] !== 2012 || years.at(-1) !== 2026
    || row.chassis_only_candidate_configurations?.join(",") !== "17/17/-" || sourceIds.join(",") !== "2202") {
    throw new Error(`Out-of-policy Caravan row: ${JSON.stringify(row)}`);
  }
  return {
    application_id: row.application_ids[0],
    source_task_ids: ["CARAVAN-E26-FRONT-ONLY-2202"],
    make: row.make,
    model: row.model,
    series_code: row.series_code,
    body_style: row.body_style,
    years_2000_2026: years,
    all_nexauto_years: years,
    expected_configuration_key: "17/17/-",
    expected_rear_status: "unknown",
    source_url: "local:outputs/wipertech-enrichment-20261022/wipertech_enriched_data.json#vehicle_id=2202",
    source_locator: "WiperTech vehicle_id=2202; Nissan Caravan E26/NV350 Van; 2012-2026; front 17/17; rear unspecified",
    evidence_policy: "Exact E26/NV350 platform and full years establish the front pair. Van-to-Bus propagation is front-only; rear remains unknown and is not inferred.",
    failures: [],
  };
}).sort((a, b) => a.application_id.localeCompare(b.application_id));

if (new Set(safe.map((row) => row.application_id)).size !== 9) throw new Error("Duplicate Caravan target application IDs.");
if (safe.reduce((sum, row) => sum + row.years_2000_2026.length, 0) !== 135) throw new Error("Caravan target AY mismatch.");

fs.mkdirSync(OUT, { recursive: true });
writeJsonl(path.join(OUT, "safe-to-publish.jsonl"), safe);
writeJsonl(path.join(OUT, "remaining-blocked.jsonl"), []);
const summary = {
  generated_at: new Date().toISOString(),
  mode: "report-only",
  production_writes: false,
  policy: "E26/NV350 exact-platform front-only propagation; rear remains unknown across Van/Bus body distinction",
  source: { path: rel(SOURCE), vehicle_id: "2202", sha256: sha256(SOURCE), configuration_key: evidenceKey },
  targets: { applications: safe.length, application_years: 135, configuration_key: "17/17/-" },
  safeguards: [
    "E25 review candidate 20/19/- is explicitly excluded.",
    "Only series ending E26 and model NV350 Bus are included.",
    "Rear is unknown, not not-applicable, and no rear length is inferred from the Van source.",
    "Publication still requires a fresh production conflict and duplicate check."
  ]
};
fs.writeFileSync(path.join(OUT, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ output: rel(OUT), ...summary.targets }, null, 2));

function readJsonl(file) { const text = fs.readFileSync(file, "utf8").trim(); return text ? text.split(/\r?\n/).map(JSON.parse) : []; }
function writeJsonl(file, values) { fs.writeFileSync(file, values.map((row) => JSON.stringify(row)).join("\n") + (values.length ? "\n" : "")); }
function sha256(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function rel(file) { return path.relative(ROOT, file).replaceAll("\\", "/"); }
