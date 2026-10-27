import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";
import {
  SOURCE_CODE,
  buildBrakePadReviewGroups,
  buildOilFilterReviewGroups,
  prepareFitmentV6,
  productNotes
} from "./deploy-fitment-v6.mjs";

const DEFAULT_BRAKE_FILE = String.raw`C:\Users\Sanli\Desktop\database\deliver\brake_verified.xlsx`;
const DEFAULT_OIL_FILE = String.raw`C:\Users\Sanli\Desktop\database\deliver\oil_verified.xlsx`;

function normalizeRef(value) {
  return String(value ?? "").trim().toUpperCase();
}

export function readReviewedDecisions(file, productType, { allowBlank = false } = {}) {
  if (!fs.existsSync(file)) throw new Error(`Missing reviewed workbook: ${file}`);
  const workbook = XLSX.readFile(file, { raw: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { range: 4, defval: "", raw: false });
  return rows.filter((row) => row.review_id).flatMap((row) => {
    const decision = normalizeRef(row.verified_supplier_ref);
    if (!decision) {
      if (allowBlank) return [];
      throw new Error(`Blank decision in ${file}: ${row.review_id}`);
    }
    return [{
      review_id: String(row.review_id).trim(),
      application_id: String(row.application_id).trim(),
      product_type: productType,
      position: productType === "brake_pad" ? String(row.position).trim().toLowerCase() : "engine",
      candidates: [1, 2, 3, 4, 5]
        .map((index) => normalizeRef(row[`candidate_ref_${index}`]))
        .filter(Boolean),
      decision,
      selected_refs: decision === "NONE"
        ? []
        : String(row.verified_supplier_ref).split(/\s*\|\s*/).map(normalizeRef).filter(Boolean)
    }];
  });
}

function fitmentGroupKey(row) {
  return `${row.product_type}:${row.application_id}:${row.position}`;
}

function fitmentRowKey(row) {
  return `${fitmentGroupKey(row)}:${row.sku}`;
}

export function applyReviewedDecisions(prepared, decisions) {
  const supplierRefBySku = new Map([
    ...prepared.brakeCatalog.map((row) => [row.sku, normalizeRef(row.supplierRef)]),
    ...prepared.oilCatalog.map((row) => [row.sku, normalizeRef(row.supplierRef)])
  ]);
  const skuBySupplierRef = new Map();
  for (const [sku, supplierRef] of supplierRefBySku) {
    const skus = skuBySupplierRef.get(supplierRef) ?? [];
    skus.push(sku);
    skuBySupplierRef.set(supplierRef, skus);
  }

  const groups = groupBy(prepared.productFitments, fitmentGroupKey);
  const decisionByKey = new Map();
  for (const decision of decisions) {
    const decisionKey = fitmentGroupKey(decision);
    if (decisionByKey.has(decisionKey)) throw new Error(`Duplicate reviewed decision: ${decisionKey}`);
    const group = groups.get(decisionKey);
    if (!group?.length) {
      if (decision.decision === "NONE") {
        decisionByKey.set(decisionKey, decision);
        continue;
      }
      throw new Error(`Reviewed decision has no current fitment candidates: ${decision.review_id}`);
    }
    for (const supplierRef of decision.selected_refs) {
      if (!decision.candidates.includes(supplierRef)) {
        throw new Error(`${decision.review_id} selected ${supplierRef}, which is not a listed candidate.`);
      }
      const matchingSkus = skuBySupplierRef.get(supplierRef) ?? [];
      if (!matchingSkus.length) throw new Error(`${decision.review_id} selected unknown supplier ref ${supplierRef}.`);
      if (!group.some((row) => matchingSkus.includes(row.sku))) {
        throw new Error(`${decision.review_id} selected ${supplierRef}, but its SKU is absent from the current fitment group.`);
      }
    }
    decisionByKey.set(decisionKey, decision);
  }

  const productFitments = prepared.productFitments.map((row) => {
    const decision = decisionByKey.get(fitmentGroupKey(row));
    if (!decision) return row;
    const selected = decision.selected_refs.includes(supplierRefBySku.get(row.sku));
    return {
      ...row,
      fitment_status: selected ? "published" : "review",
      fitment_status_reason: decision.decision === "NONE"
        ? "manual_review_no_compatible_candidate"
        : selected
          ? "manual_review_confirmed_supplier_reference"
          : "manual_review_rejected_supplier_reference",
      manual_review_id: decision.review_id,
      manual_review_decision: decision.decision
    };
  });

  const unresolvedFitments = productFitments.filter((row) => !decisionByKey.has(fitmentGroupKey(row)));
  return {
    productFitments,
    unresolvedFitments,
    decisionByKey,
    supplierRefBySku
  };
}

function buildReport(prepared, reviewed, decisions, brakeFile, oilFile) {
  const beforePublished = new Set(prepared.productFitments.filter((row) => row.fitment_status === "published").map(fitmentRowKey));
  const afterPublished = new Set(reviewed.productFitments.filter((row) => row.fitment_status === "published").map(fitmentRowKey));
  const oilReviews = buildOilFilterReviewGroups(reviewed.unresolvedFitments, prepared.oilCatalog);
  const brakeReviews = buildBrakePadReviewGroups(reviewed.unresolvedFitments, prepared.brakeCatalog);
  return {
    source: SOURCE_CODE,
    workbooks: {
      brake: fileIdentity(brakeFile),
      oil: fileIdentity(oilFile)
    },
    decisions: {
      total: decisions.length,
      brake_pad: decisions.filter((row) => row.product_type === "brake_pad").length,
      oil_filter: decisions.filter((row) => row.product_type === "oil_filter").length,
      none: decisions.filter((row) => row.decision === "NONE").length,
      selected: decisions.filter((row) => row.decision !== "NONE").length,
      multiple_selected: decisions.filter((row) => row.selected_refs.length > 1).length
    },
    fitments: {
      total: reviewed.productFitments.length,
      published_before: countBy(prepared.productFitments.filter((row) => row.fitment_status === "published"), (row) => row.product_type),
      published_after: countBy(reviewed.productFitments.filter((row) => row.fitment_status === "published"), (row) => row.product_type),
      newly_published: [...afterPublished].filter((value) => !beforePublished.has(value)).length,
      withdrawn: [...beforePublished].filter((value) => !afterPublished.has(value)).length,
      review_after: countBy(reviewed.productFitments.filter((row) => row.fitment_status === "review"), (row) => row.product_type)
    },
    unresolved_review_groups: {
      brake_pad: brakeReviews.length,
      oil_filter: oilReviews.length
    },
    brakeReviews,
    oilReviews
  };
}

async function inspectProduction(db, productFitments) {
  const variantRows = await selectAll(db.from("product_variants").select("id,sku"));
  const variantBySku = new Map(variantRows.map((row) => [row.sku, row.id]));
  const missingSkus = [...new Set(productFitments.map((row) => row.sku).filter((sku) => !variantBySku.has(sku)))];
  if (missingSkus.length) throw new Error(`Production is missing product SKUs: ${missingSkus.join(", ")}`);
  return {
    variantBySku,
    current_source_rows: await filteredCount(db, "vehicle_catalog_product_fitments", "source", SOURCE_CODE)
  };
}

async function applyToProduction(db, prepared, reviewed, report, inspection) {
  const backupDir = await writeBackup(db, report);
  const payload = reviewed.productFitments.map((row) => ({
    application_id: row.application_id,
    product_variant_id: inspection.variantBySku.get(row.sku),
    position: row.position || "vehicle",
    fitment_status: row.fitment_status,
    source: SOURCE_CODE,
    notes: [
      productNotes(row),
      row.manual_review_id ? `manual_review=${row.manual_review_id}` : "",
      row.manual_review_decision ? `decision=${row.manual_review_decision}` : ""
    ].filter(Boolean).join("; ")
  }));
  await upsertRows(db, "vehicle_catalog_product_fitments", payload, "application_id,product_variant_id,position");

  for (const prefix of ["fitment_v6_brake_%", "fitment_v6_oil_%"]) {
    const { error } = await db.from("fitment_review_queue")
      .update({
        review_status: "dismissed",
        resolution_notes: "Rebuilt after verified supplier-reference workbook import.",
        reviewed_at: new Date().toISOString()
      })
      .like("issue_type", prefix)
      .in("review_status", ["open", "in_progress"]);
    if (error) throw error;
  }
  await insertRows(db, "fitment_review_queue", [...report.brakeReviews, ...report.oilReviews]);

  const sourceRows = await filteredCount(db, "vehicle_catalog_product_fitments", "source", SOURCE_CODE);
  const published = await filteredPairCount(db, "vehicle_catalog_product_fitments", "source", SOURCE_CODE, "fitment_status", "published");
  const expectedPublished = reviewed.productFitments.filter((row) => row.fitment_status === "published").length;
  if (sourceRows !== payload.length) throw new Error(`Production fitment count mismatch: ${sourceRows}/${payload.length}`);
  if (published !== expectedPublished) throw new Error(`Production published count mismatch: ${published}/${expectedPublished}`);
  const brakeReviewCount = await filteredLikePairCount(db, "fitment_review_queue", "issue_type", "fitment_v6_brake_%", "review_status", "open");
  const oilReviewCount = await filteredLikePairCount(db, "fitment_review_queue", "issue_type", "fitment_v6_oil_%", "review_status", "open");
  if (brakeReviewCount !== report.brakeReviews.length) throw new Error(`Brake review queue mismatch: ${brakeReviewCount}/${report.brakeReviews.length}`);
  if (oilReviewCount !== report.oilReviews.length) throw new Error(`Oil review queue mismatch: ${oilReviewCount}/${report.oilReviews.length}`);
  return {
    backup_dir: backupDir,
    source_rows: sourceRows,
    published,
    review: sourceRows - published,
    brake_review_groups: brakeReviewCount,
    oil_review_groups: oilReviewCount
  };
}

async function writeBackup(db, report) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = path.resolve("tmp", "production-backups", `reviewed-fitments-${stamp}`);
  fs.mkdirSync(directory, { recursive: true });
  const rows = await selectAll(db.from("vehicle_catalog_product_fitments").select("*"));
  const content = JSON.stringify(rows, null, 2);
  fs.writeFileSync(path.join(directory, "vehicle_catalog_product_fitments.json"), content);
  fs.writeFileSync(path.join(directory, "manifest.json"), JSON.stringify({
    created_at: new Date().toISOString(),
    source: SOURCE_CODE,
    rows: rows.length,
    sha256: crypto.createHash("sha256").update(content).digest("hex"),
    reviewed_workbooks: report.workbooks
  }, null, 2));
  return directory;
}

function fileIdentity(file) {
  const content = fs.readFileSync(file);
  return {
    path: path.resolve(file),
    bytes: content.length,
    sha256: crypto.createHash("sha256").update(content).digest("hex")
  };
}

function countBy(rows, keyFn) {
  const result = {};
  for (const row of rows) {
    const key = keyFn(row);
    result[key] = (result[key] ?? 0) + 1;
  }
  return result;
}

function groupBy(rows, keyFn) {
  const result = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    const group = result.get(key) ?? [];
    group.push(row);
    result.set(key, group);
  }
  return result;
}

export function mergeReviewedDecisions(baseDecisions, updateDecisions) {
  const merged = new Map(baseDecisions.map((decision) => [fitmentGroupKey(decision), decision]));
  const overrides = [];
  for (const decision of updateDecisions) {
    const key = fitmentGroupKey(decision);
    const previous = merged.get(key);
    if (previous) {
      overrides.push({
        key,
        previous_review_id: previous.review_id,
        previous_decision: previous.decision,
        updated_review_id: decision.review_id,
        updated_decision: decision.decision
      });
    }
    merged.set(key, decision);
  }
  return { decisions: [...merged.values()], overrides };
}

function chunks(rows, size = 500) {
  const result = [];
  for (let index = 0; index < rows.length; index += size) result.push(rows.slice(index, index + size));
  return result;
}

async function insertRows(db, table, rows) {
  for (const group of chunks(rows)) {
    if (!group.length) continue;
    const { error } = await db.from(table).insert(group);
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

async function upsertRows(db, table, rows, onConflict) {
  for (const group of chunks(rows)) {
    if (!group.length) continue;
    const { error } = await db.from(table).upsert(group, { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

async function selectAll(query, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
}

async function filteredCount(db, table, column, value) {
  const { count, error } = await db.from(table).select("*", { count: "exact", head: true }).eq(column, value);
  if (error) throw error;
  return count ?? 0;
}

async function filteredPairCount(db, table, firstColumn, firstValue, secondColumn, secondValue) {
  const { count, error } = await db.from(table).select("*", { count: "exact", head: true })
    .eq(firstColumn, firstValue).eq(secondColumn, secondValue);
  if (error) throw error;
  return count ?? 0;
}

async function filteredLikePairCount(db, table, firstColumn, firstValue, secondColumn, secondValue) {
  const { count, error } = await db.from(table).select("*", { count: "exact", head: true })
    .like(firstColumn, firstValue).eq(secondColumn, secondValue);
  if (error) throw error;
  return count ?? 0;
}

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isCli) {
  const valueAfter = (flag, fallback) => {
    const index = process.argv.indexOf(flag);
    return index >= 0 ? path.resolve(process.argv[index + 1]) : fallback;
  };
  const brakeFile = valueAfter("--brake", DEFAULT_BRAKE_FILE);
  const oilFile = valueAfter("--oil", DEFAULT_OIL_FILE);
  const baseBrakeFile = valueAfter("--base-brake", "");
  const baseOilFile = valueAfter("--base-oil", "");
  const allowBlank = process.argv.includes("--allow-blank");
  const prepared = prepareFitmentV6();
  const baseDecisions = [
    ...(baseBrakeFile ? readReviewedDecisions(baseBrakeFile, "brake_pad") : []),
    ...(baseOilFile ? readReviewedDecisions(baseOilFile, "oil_filter") : [])
  ];
  const updateDecisions = [
    ...readReviewedDecisions(brakeFile, "brake_pad", { allowBlank }),
    ...readReviewedDecisions(oilFile, "oil_filter", { allowBlank })
  ];
  const merged = mergeReviewedDecisions(baseDecisions, updateDecisions);
  const decisions = merged.decisions;
  const reviewed = applyReviewedDecisions(prepared, decisions);
  const report = buildReport(prepared, reviewed, decisions, brakeFile, oilFile);
  console.log(JSON.stringify({
    ...report,
    brakeReviews: undefined,
    oilReviews: undefined,
    partial_import: {
      allow_blank: allowBlank,
      base_decisions: baseDecisions.length,
      update_decisions: updateDecisions.length,
      overrides: merged.overrides.length,
      override_details: merged.overrides
    }
  }, null, 2));

  loadEnv(path.resolve(".env.local"));
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Supabase service credentials.");
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const inspection = await inspectProduction(db, reviewed.productFitments);
  console.log(JSON.stringify({ production_before: inspection.current_source_rows }, null, 2));
  if (process.argv.includes("--apply")) {
    console.log(JSON.stringify({ applied: await applyToProduction(db, prepared, reviewed, report, inspection) }, null, 2));
  } else if (!process.argv.includes("--report-only")) {
    throw new Error("Choose --report-only or --apply.");
  }
}
