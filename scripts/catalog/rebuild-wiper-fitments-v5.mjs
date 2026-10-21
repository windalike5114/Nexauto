import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";
import { cleanText, normalKey } from "./catalog-v3-normalization.mjs";
import { assessWiperRows, parseYearRange } from "./fitment-v4-matcher.mjs";

const PACKAGE_DIR = "C:\\Users\\Sanli\\Documents\\Codex\\2026-10-21\\referenced-chatgpt-conversation-this-is-an\\outputs\\NexAutoParts_车型库数据包\\nexautoparts_vehicle_database";
const WIPER_FILE = "C:\\Users\\Sanli\\repco_nexauto\\clean\\data\\wiper_clean.csv";

function prepare() {
  const makes = byId(readCsv(path.join(PACKAGE_DIR, "make.csv")), "make_id");
  const models = byId(readCsv(path.join(PACKAGE_DIR, "model.csv")), "model_id");
  const series = byId(readCsv(path.join(PACKAGE_DIR, "series.csv")), "series_id");
  const applications = readCsv(path.join(PACKAGE_DIR, "vehicle_application.csv"));
  const wiperRows = readMatrix(WIPER_FILE).slice(1).map((row, index) => {
    const range = parseYearRange(row[2]);
    return {
      row_number: index + 2, make: cleanText(row[0]), model: cleanText(row[1]),
      year_start: range.year_start, year_end: range.year_end,
      driver_length_in: numberOrNull(row[5]), passenger_length_in: numberOrNull(row[7]),
      rear_length_in: numberOrNull(row[9]), connector_type: cleanText(row[10])
    };
  });
  const wipersByMake = groupBy(wiperRows, (row) => normalKey(row.make));
  const published = [];
  const review = [];
  for (const app of applications) {
    const model = models.get(app.model_id);
    const make = makes.get(model.make_id);
    const vehicle = {
      make: make.name, make_key: normalKey(make.name), model: model.name, model_key: normalKey(model.name),
      chassis_raw: app.series_id ? series.get(app.series_id)?.code ?? "" : "",
      year_start: Number(app.year_from), year_end: Number(app.year_to)
    };
    const decision = assessWiperRows(vehicle, wipersByMake.get(vehicle.make_key) ?? []);
    if (decision.status === "published") published.push({
      application_id: app.application_id, configuration_key: decision.configuration_key,
      confidence: decision.confidence, source_rows: decision.evidence_rows.map((row) => row.row_number)
    });
    else if (decision.status === "review") review.push({
      application_id: app.application_id, issue: decision.reason, configurations: decision.configuration_keys
    });
  }
  return {
    published,
    review,
    report: {
      applications: applications.length, source_rows: wiperRows.length,
      published_applications: published.length, review_applications: review.length,
      unmatched_applications: applications.length - published.length - review.length,
      configurations: new Set(published.map((row) => row.configuration_key)).size
    }
  };
}

async function apply(prepared) {
  loadEnv(path.join(process.cwd(), ".env.local"));
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: clearError } = await db.from("vehicle_catalog_wiper_fitments").delete().not("application_id", "is", null);
  if (clearError) throw clearError;
  const configurationIds = new Map();
  for (const key of new Set(prepared.published.map((row) => row.configuration_key))) {
    const [driver, passenger, rear] = key.split("/");
    const { data, error } = await db.rpc("upsert_wiper_configuration", {
      p_driver_length_in: Number(driver), p_passenger_length_in: Number(passenger), p_rear_length_in: rear === "-" ? null : Number(rear)
    });
    if (error) throw error;
    configurationIds.set(key, data);
  }
  const payload = prepared.published.map((row) => ({
    application_id: row.application_id, wiper_configuration_id: configurationIds.get(row.configuration_key),
    fitment_status: "published", source: "NEXAUTO_WIPER_MAPPING_V5",
    notes: `unique make/model/year configuration; confidence=${row.confidence}; rows=${row.source_rows.join(",")}`
  }));
  for (const chunk of chunks(payload, 500)) {
    const { error } = await db.from("vehicle_catalog_wiper_fitments").upsert(chunk, { onConflict: "application_id,wiper_configuration_id" });
    if (error) throw error;
  }
  const { count, error } = await db.from("vehicle_catalog_wiper_fitments").select("*", { count: "exact", head: true });
  if (error) throw error;
  if (count !== payload.length) throw new Error(`Wiper fitment count mismatch: ${count}/${payload.length}`);
  console.log(JSON.stringify({ applied: true, rows: count }, null, 2));
}

function readCsv(file) { const book = XLSX.readFile(file, { raw: false }); return XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { defval: "", raw: false }); }
function readMatrix(file) { const book = XLSX.read(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""), { type: "string", raw: false }); return XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1, defval: "", raw: false }); }
function byId(rows, key) { return new Map(rows.map((row) => [row[key], row])); }
function groupBy(rows, keyFn) { const result = new Map(); for (const row of rows) { const key = keyFn(row); const group = result.get(key) ?? []; group.push(row); result.set(key, group); } return result; }
function numberOrNull(value) { const number = Number(cleanText(value)); return Number.isFinite(number) && cleanText(value) ? number : null; }
function chunks(rows, size) { const result = []; for (let i = 0; i < rows.length; i += size) result.push(rows.slice(i, i + size)); return result; }
function loadEnv(file) { for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) { const match = line.match(/^([^#=]+)=(.*)$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ""); } }

const prepared = prepare();
console.log(JSON.stringify(prepared.report, null, 2));
if (process.argv.includes("--apply")) await apply(prepared);
else if (!process.argv.includes("--report-only")) throw new Error("Choose --report-only or --apply.");
