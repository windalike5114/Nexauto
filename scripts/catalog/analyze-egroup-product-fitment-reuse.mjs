import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";
import { classifyBrakePadFitments, classifyOilFilterFitments } from "./deploy-fitment-v6.mjs";

const ROOT = process.cwd();
const INPUT_DIR = path.join(ROOT, "outputs", "egroup-fitment-reuse-20261024", "legacy-source-rematch");
const CATALOG_DIR = path.join(ROOT, "outputs", "vehicle-library-egroup-20261024", "package");
const OUTPUT_DIR = path.join(ROOT, "outputs", "egroup-fitment-reuse-20261024");

const brake = classifyBrakePadFitments(readCsv(path.join(INPUT_DIR, "brakepad_product_application_test.csv")));
const oil = classifyOilFilterFitments(readCsv(path.join(INPUT_DIR, "oilfilter_product_application_test.csv")));
const applications = readCsv(path.join(CATALOG_DIR, "vehicle_application.csv"));
const years = readCsv(path.join(CATALOG_DIR, "application_year.csv"));
const yearsByApplication = groupBy(years, (row) => row.application_id);
const egroupIds = new Set(applications.map((row) => row.application_id));

loadEnv(path.join(ROOT, ".env.local"));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const [productVariants, productionFitments] = await Promise.all([
  fetchAll("product_variants", "id,sku,active"),
  fetchAll("vehicle_catalog_product_fitments", "application_id,product_variant_id,position,fitment_status,source"),
]);
const productionSkus = new Set(productVariants.map((row) => row.sku));
const existingEgroupFitments = productionFitments.filter((row) => egroupIds.has(row.application_id));

const brakePublished = brake.filter((row) => row.fitment_status === "published");
const oilPublished = oil.filter((row) => row.fitment_status === "published");
const brakeReview = brake.filter((row) => row.fitment_status === "review");
const oilReview = oil.filter((row) => row.fitment_status === "review");

const report = {
  generated_at: new Date().toISOString(),
  egroup_applications: applications.length,
  currently_linked_product_fitment_rows: existingEgroupFitments.length,
  brake_pad: summarize("brake_pad", brake, brakePublished, brakeReview),
  oil_filter: summarize("oil_filter", oil, oilPublished, oilReview),
  product_catalog_check: {
    brake_candidate_skus: new Set(brake.map((row) => row.sku)).size,
    brake_candidate_skus_missing_in_production: [...new Set(brake.map((row) => row.sku).filter((sku) => !productionSkus.has(sku)))],
    oil_candidate_skus: new Set(oil.map((row) => row.sku)).size,
    oil_candidate_skus_missing_in_production: [...new Set(oil.map((row) => row.sku).filter((sku) => !productionSkus.has(sku)))],
  },
  policy: {
    brake_pad: "Auto-use only high-confidence, position-compatible, single-candidate rows with Series confirmed where the application has Series.",
    oil_filter: "Auto-use only high-confidence exact/cleaned-exact model matches, a single SKU candidate, and Series confirmed where present. Engine-code-only matches remain review under the current publication policy.",
  },
};

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUTPUT_DIR, "product-fitment-report.json"), `${JSON.stringify(report, null, 2)}\n`);
writeCsv(path.join(OUTPUT_DIR, "product-fitment-safe-candidates.csv"), [...brakePublished, ...oilPublished]);
writeCsv(path.join(OUTPUT_DIR, "product-fitment-review-candidates.csv"), [...brakeReview, ...oilReview]);
console.log(JSON.stringify(report, null, 2));

function summarize(productType, all, published, review) {
  const publishedApplications = new Set(published.map((row) => row.application_id));
  const candidateApplications = new Set(all.map((row) => row.application_id));
  return {
    candidate_rows: all.length,
    candidate_applications: candidateApplications.size,
    candidate_application_years: countApplicationYears(candidateApplications),
    safe_rows: published.length,
    safe_applications: publishedApplications.size,
    safe_application_years: countApplicationYears(publishedApplications),
    review_rows: review.length,
    review_applications: new Set(review.map((row) => row.application_id)).size,
    confidence: countBy(all, (row) => row.match_confidence),
    safe_by_position: countBy(published, (row) => row.position),
    review_reasons: countBy(review, (row) => row.fitment_status_reason),
    safe_skus: new Set(published.map((row) => row.sku)).size,
    product_type: productType,
  };
}

function countApplicationYears(ids) {
  let count = 0;
  for (const id of ids) count += (yearsByApplication.get(id) ?? []).length;
  return count;
}

async function fetchAll(table, columns) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`Could not read ${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

function readCsv(file) {
  const book = XLSX.readFile(file, { raw: false });
  return XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { defval: "", raw: false });
}
function writeCsv(file, rows) {
  const sheet = XLSX.utils.json_to_sheet(rows);
  fs.writeFileSync(file, `\uFEFF${XLSX.utils.sheet_to_csv(sheet)}`, "utf8");
}
function groupBy(rows, keyFn) {
  const result = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    const values = result.get(key) ?? [];
    values.push(row);
    result.set(key, values);
  }
  return result;
}
function countBy(rows, keyFn) {
  const result = {};
  for (const row of rows) {
    const key = keyFn(row) || "(blank)";
    result[key] = (result[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(result).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])));
}
function loadEnv(file) {
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}
