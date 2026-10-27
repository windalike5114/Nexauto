import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

process.loadEnvFile(".env.local");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const out = path.resolve("outputs/corolla-e150-year-correction-20261026");
fs.mkdirSync(out, { recursive: true });
const ids = ["ap_1477e218bac3d3121343", "ap_1d95324d864fbbb17bb8", "ap_74df98121df5a6400ea9"];
const model = "md_4d92dbd55bf5bd59b16f";
const sources = ["https://www.toyota-global.com/company/history_of_toyota/75years/vehicle_lineage/car/id60001525/index.html", "https://global.toyota/en/detail/132953"];
const tables = ["vehicle_catalog_application_years", "vehicle_catalog_application_provenance", "vehicle_catalog_wiper_fitments", "vehicle_catalog_product_fitments", "vehicle_catalog_part_reference_fitments"];
const put = (name, value) => fs.writeFileSync(path.join(out, name), JSON.stringify(value, null, 2));
async function checked(request) { const r = await request; if (r.error) throw new Error(r.error.message); return r.data ?? []; }
const stable = (rows) => JSON.stringify(rows.map((row) => JSON.stringify(row)).sort());
async function snapshot() {
  const state = { applications: await checked(db.from("vehicle_catalog_applications").select("*").in("application_id", ids).order("application_id")) };
  for (const table of tables) state[table] = await checked(db.from(table).select("*").in("application_id", ids));
  return state;
}
const initial = await snapshot();
assert.equal(initial.applications.length, 3);
for (const row of initial.applications) { assert.equal(row.model_id, model); assert.equal(row.year_from, 2007); assert.equal(row.status, "active"); }
const afterRows = initial.applications.map((row) => ({ ...row, year_to: 2012,
  canonical_key: [row.model_id, row.series_id, row.variant_id, row.powertrain_id, row.year_from, 2012].join("|"),
  year_status: "manufacturer_bounded_range", review_status: "year_range_corrected" }));
const collisions = await checked(db.from("vehicle_catalog_applications").select("application_id").in("canonical_key", afterRows.map((row) => row.canonical_key)));
assert.ok(collisions.every((row) => ids.includes(row.application_id)), "A target identity already exists; reconcile instead of overwriting");
const invalidYears = initial.vehicle_catalog_application_years.filter((row) => row.model_year > 2012);
const summary = { applications: 3, year_interval: "2000-2026", before_application_years: initial.vehicle_catalog_application_years.length,
  after_application_years: initial.vehicle_catalog_application_years.length - invalidYears.length, invalid_application_years_removed: invalidYears.length,
  source_urls: sources, correction: "First-generation E150 hatchback ends in 2012; keep Axio/Fielder and later hatchback applications unchanged",
  relationship_counts: Object.fromEntries(tables.filter((table) => table !== "vehicle_catalog_application_years").map((table) => [table, initial[table].length])) };
put("plan.json", { summary, before: initial.applications, after: afterRows, invalid_years: invalidYears });
if (process.argv.includes("--apply")) {
  if (invalidYears.length === 0 && initial.applications.every((row) => row.year_to === 2012)) {
    console.log(JSON.stringify({ already_applied: true, ...summary }));
  } else {
    assert.ok(!fs.existsSync(path.join(out, "before.json")), "Prior apply exists; inspect recovery state before retrying");
    for (const row of initial.applications) assert.equal(row.year_to, 2026);
    assert.equal(invalidYears.length, 42);
    put("before.json", initial);
    try {
      for (const row of afterRows) {
        const changed = await checked(db.from("vehicle_catalog_applications").update({ year_to: row.year_to, canonical_key: row.canonical_key, year_status: row.year_status, review_status: row.review_status }).eq("application_id", row.application_id).eq("year_to", 2026).select("application_id"));
        assert.equal(changed.length, 1);
      }
      const removed = await checked(db.from("vehicle_catalog_application_years").delete().in("application_id", ids).gt("model_year", 2012).select("application_id,model_year"));
      assert.equal(removed.length, 42);
      const after = await snapshot();
      assert.equal(stable(after.applications), stable(afterRows));
      assert.equal(stable(after.vehicle_catalog_application_years), stable(initial.vehicle_catalog_application_years.filter((row) => row.model_year <= 2012)));
      for (const table of tables.filter((table) => table !== "vehicle_catalog_application_years")) assert.equal(stable(after[table]), stable(initial[table]), `Relationship changed: ${table}`);
      const issueRows = ids.map((id) => ({ issue_id: "is_" + crypto.createHash("sha256").update(id + ":manufacturer-year-correction-20261026").digest("hex").slice(0, 20),
        entity_type: "application", entity_id: id, issue_code: "YEAR_RANGE_CORRECTED", severity: "info",
        details: JSON.stringify({ before: "2007-2026", after: "2007-2012", sources, audit: "corolla-e150-year-correction-20261026", relationship_ids_preserved: true }) }));
      await checked(db.from("vehicle_catalog_review_issues").upsert(issueRows, { onConflict: "issue_id" }));
      put("verified.json", { verified: true, ...summary, after });
    } catch (error) {
      await checked(db.from("vehicle_catalog_applications").upsert(initial.applications, { onConflict: "application_id" }));
      await checked(db.from("vehicle_catalog_application_years").upsert(initial.vehicle_catalog_application_years, { onConflict: "application_id,model_year" }));
      const restored = await snapshot();
      for (const key of Object.keys(initial)) assert.equal(stable(restored[key]), stable(initial[key]), `Rollback mismatch: ${key}`);
      put("rollback.json", { verified: true, error: error.message });
      throw error;
    }
  }
}
console.log(JSON.stringify(summary));
