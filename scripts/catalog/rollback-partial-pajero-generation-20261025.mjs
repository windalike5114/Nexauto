import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const BACKUP = path.join(ROOT, "tmp", "production-backups", "pajero-generation-2026-10-25T07-11-18-560Z");
const PLAN = JSON.parse(fs.readFileSync(path.join(ROOT, "outputs", "pajero-generation-correction-20261025", "apply-plan.json"), "utf8"));
const applications = read("applications.json");
const years = read("years.json");
const wipers = read("wipers.json");
const targetIds = applications.map((row) => row.application_id);
const childIds = PLAN.complex_splits.flatMap((split) => split.children.map((child) => child.application.application_id));

loadEnv(path.join(ROOT, ".env.local"));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const { error: childDeleteError } = await db.from("vehicle_catalog_applications").delete().in("application_id", childIds);
if (childDeleteError) throw childDeleteError;

const { error: yearDeleteError } = await db.from("vehicle_catalog_application_years").delete().in("application_id", targetIds);
if (yearDeleteError) throw yearDeleteError;
const { error: yearInsertError } = await db.from("vehicle_catalog_application_years").insert(years);
if (yearInsertError) throw yearInsertError;

const { error: wiperDeleteError } = await db.from("vehicle_catalog_wiper_fitments").delete().in("application_id", targetIds);
if (wiperDeleteError) throw wiperDeleteError;
const { error: wiperInsertError } = await db.from("vehicle_catalog_wiper_fitments").insert(wipers);
if (wiperInsertError) throw wiperInsertError;

for (const row of applications) {
  const { error } = await db.from("vehicle_catalog_applications").update({ year_from: row.year_from, year_to: row.year_to, year_status: row.year_status,
    canonical_key: row.canonical_key, status: row.status, review_status: row.review_status }).eq("application_id", row.application_id);
  if (error) throw error;
}

const [appsNow, yearsNow, wipersNow, childrenNow] = await Promise.all([
  selectIn("vehicle_catalog_applications", "application_id", targetIds), selectIn("vehicle_catalog_application_years", "application_id", targetIds),
  selectIn("vehicle_catalog_wiper_fitments", "application_id", targetIds), selectIn("vehicle_catalog_applications", "application_id", childIds),
]);
const verification = {
  children_removed: childrenNow.length === 0,
  applications_restored: sameRows(applications, appsNow, ["application_id", "year_from", "year_to", "year_status", "canonical_key", "status", "review_status"]),
  years_restored: sameRows(years, yearsNow, ["application_id", "model_year"]),
  wipers_restored: sameRows(wipers, wipersNow, ["application_id", "wiper_configuration_id", "fitment_status", "source", "notes"]),
};
if (!Object.values(verification).every(Boolean)) throw new Error(`Rollback verification failed: ${JSON.stringify(verification)}`);
const output = { rolled_back_at: new Date().toISOString(), backup: BACKUP, target_applications: targetIds.length, planned_children_removed: childIds.length, verification };
fs.writeFileSync(path.join(ROOT, "outputs", "pajero-generation-correction-20261025", "partial-apply-rollback.json"), JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));

function read(name) { return JSON.parse(fs.readFileSync(path.join(BACKUP, name), "utf8")); }
function sameRows(expected, actual, fields) {
  const normalize = (rows) => rows.map((row) => fields.map((field) => JSON.stringify(row[field] ?? null)).join("|")).sort();
  return JSON.stringify(normalize(expected)) === JSON.stringify(normalize(actual));
}
async function selectIn(table, field, values) { if (!values.length) return []; const { data, error } = await db.from(table).select("*").in(field, values); if (error) throw error; return data; }
function loadEnv(file) { if (!fs.existsSync(file)) return; for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) { const match = line.match(/^([^#=]+)=(.*)$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ""); } }
