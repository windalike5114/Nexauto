import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "outputs", "core103-fitment-ai-minimal-20261025");
const INPUTS = {
  wiper: path.join(ROOT, "outputs", "core103-wiper-phase-20261025", "multi-candidate-review.jsonl"),
  brakeConditional: path.join(ROOT, "outputs", "core103-brake-knowledge-phase1-20261025", "conditional-reference-fitments.jsonl"),
  brakeMulti: path.join(ROOT, "outputs", "core103-brake-knowledge-phase1-20261025", "multi-candidate-review.jsonl"),
  snapshot: path.join(ROOT, "outputs", "brake-alias-group-review-round5-20261025", "after-snapshot.json")
};

const wiperRows = readJsonl(INPUTS.wiper);
const brakeRows = dedupeBrake([...readJsonl(INPUTS.brakeConditional), ...readJsonl(INPUTS.brakeMulti)]);
const snapshot = JSON.parse(fs.readFileSync(INPUTS.snapshot, "utf8"));
const variantById = new Map(snapshot.variants.map((row) => [row.variant_id, row]));
const appById = new Map(snapshot.applications.map((row) => [row.application_id, row]));
const yearsByApp = groupSet(snapshot.years.filter((row) => Number(row.model_year) >= 2000 && Number(row.model_year) <= 2026), (row) => row.application_id, (row) => Number(row.model_year));

const normalized = [];
for (const row of wiperRows) normalized.push(normalizeWiper(row));
for (const row of brakeRows) normalized.push(...normalizeBrake(row));
const grouped = groupCases(normalized);

const tasks = [];
const deferred = [];
for (const item of grouped) {
  const classification = classify(item);
  if (classification.queue === "task") tasks.push(buildTask(item, classification));
  else deferred.push(buildDeferred(item, classification));
}
tasks.sort(prioritySort);
tasks.forEach((row, index) => { row.task_id = stableId("FITAI", row); row.priority = index + 1; row.priority_tier = index < 20 ? "P1" : index < 60 ? "P2" : "P3"; });
deferred.sort(prioritySort);
deferred.forEach((row, index) => { row.deferred_id = stableId("FITDEF", row); row.priority = index + 1; });

const summary = {
  generated_at: new Date().toISOString(),
  mode: "minimal_ai_research_package_report_only",
  scope: "Core-103 unresolved wiper and brake-pad fitment questions, model years 2000-2026",
  policy: {
    task: "Only questions that an authoritative vehicle/application catalog can answer directly with one wiper configuration or one Bendix DB reference.",
    deferred: "Multiple configurations/DBs needing caliper, disc, OE, PR code, production-date research, an unrepresentable split, or no remaining AI action.",
    grouping: "product line + make/model family + series/chassis + body/position + candidate set",
    coverage: "Application-year upper bound only. Review results do not count as coverage until separately validated and published."
  },
  input: {
    rows: { wiper_multi_candidate: wiperRows.length, brake_conditional: readLineCount(INPUTS.brakeConditional), brake_multi_candidate: readLineCount(INPUTS.brakeMulti) },
    brake_rows_after_cross_file_dedup: brakeRows.length,
    files: Object.fromEntries(Object.entries(INPUTS).map(([name, file]) => [name, auditFile(file)]))
  },
  tasks: summarize(tasks),
  deferred: summarize(deferred),
  deferred_reasons: countBy(deferred, (row) => row.deferred_reason),
  safeguards: [
    "No web browsing, AI search, or production database write was performed.",
    "No full source rows or catalog snapshots are copied into tasks.",
    "Brake DB numbers remain references, never synthesized NBP SKUs.",
    "Rear drum/shoe cases are excluded from missing rear-pad research."
  ]
};

fs.mkdirSync(OUT, { recursive: true });
writeJsonl(path.join(OUT, "tasks.jsonl"), tasks);
writeJsonl(path.join(OUT, "deferred.jsonl"), deferred);
fs.writeFileSync(path.join(OUT, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
fs.writeFileSync(path.join(OUT, "README"), readme(summary));
console.log(JSON.stringify({ output_dir: OUT, tasks: summary.tasks, deferred: summary.deferred, deferred_reasons: summary.deferred_reasons }, null, 2));

function normalizeWiper(row) {
  return {
    product_line: "wiper", family: row.family, make: row.make, models: [row.model], series_chassis: row.series_code || row.series_name || "",
    body: row.body_style || "unknown", position: "front_configuration", candidate_set: unique(row.candidate_configurations ?? []),
    current_set: unique(row.current_configurations ?? []), application_ids: unique(row.application_ids ?? []),
    input_reasons: [row.reason], source_kind: "core103_wiper_review", input_rows: 1
  };
}

function normalizeBrake(row) {
  const idsByBody = new Map();
  for (const id of row.application_ids ?? []) {
    const application = appById.get(id); const body = variantById.get(application?.variant_id)?.body_style || "unknown";
    const values = idsByBody.get(body) ?? []; values.push(id); idsByBody.set(body, values);
  }
  if (!idsByBody.size) idsByBody.set("unknown", []);
  return [...idsByBody].map(([body, applicationIds]) => ({
    product_line: "brake_pad", family: row.group, make: row.make, models: row.models ?? [], series_chassis: row.platform || "",
    body, position: row.position, candidate_set: unique(row.candidate_db ?? []), current_set: unique(row.live_published_db ?? []),
    application_ids: unique(applicationIds), input_reasons: unique([row.decision, ...(row.decision_reasons ?? [])]),
    rear_shoe_references: unique(row.rear_brake_shoe_references ?? []), source_kind: "core103_brake_review", input_rows: 1
  }));
}

function groupCases(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = [row.product_line, norm(row.make), norm(row.family), norm(row.series_chassis), norm(row.body), row.position, row.candidate_set.join("/")].join("|");
    const item = map.get(key) ?? { product_line: row.product_line, family: row.family, make: row.make, models: new Set(),
      series_chassis: row.series_chassis, body: row.body, position: row.position, candidate_set: row.candidate_set,
      current_set: new Set(), application_ids: new Set(), input_reasons: new Set(), source_kinds: new Set(),
      rear_shoe_references: new Set(), input_rows: 0 };
    row.models.forEach((value) => item.models.add(value)); row.current_set.forEach((value) => item.current_set.add(value));
    row.application_ids.forEach((value) => item.application_ids.add(value)); row.input_reasons.forEach((value) => item.input_reasons.add(value));
    (row.rear_shoe_references ?? []).forEach((value) => item.rear_shoe_references.add(value)); item.source_kinds.add(row.source_kind);
    item.input_rows += row.input_rows; map.set(key, item);
  }
  return [...map.values()].map((item) => {
    const applicationIds = [...item.application_ids].sort();
    const yearKeys = applicationYearKeys(applicationIds);
    const years = unique(yearKeys.map((key) => Number(key.split("|")[1]))).sort((a, b) => a - b);
    return { ...item, models: [...item.models].sort(), current_set: [...item.current_set].sort(), application_ids: applicationIds,
      applications: applicationIds.length, application_years: yearKeys.length, years, year_from: years[0] ?? null,
      year_to: years.at(-1) ?? null, input_reasons: [...item.input_reasons].sort(), source_kinds: [...item.source_kinds].sort(),
      rear_shoe_references: [...item.rear_shoe_references].sort() };
  });
}

function classify(item) {
  const reasons = item.input_reasons.join("|");
  if (item.product_line === "brake_pad") {
    if (reasons.includes("rear_drum_not_pad_gap")) return { queue: "deferred", reason: "rear_drum_resolved_not_ai_task" };
    if (reasons.includes("already_covered_by_same_published_db") && item.candidate_set.length === 1) return { queue: "deferred", reason: "already_covered_no_ai_task" };
    if (item.current_set.some((value) => !item.candidate_set.includes(value))) return { queue: "deferred", reason: "published_conflict_requires_manual_catalog_governance" };
    if (item.candidate_set.length > 1) return { queue: "deferred", reason: "multi_db_requires_caliper_disc_oe_pr_or_production_split" };
    if (!item.series_chassis || item.body === "unknown") return { queue: "deferred", reason: "missing_catalog_identity" };
    if (item.candidate_set.length === 1) return { queue: "task", reason: "authoritative_catalog_can_confirm_single_db" };
    return { queue: "deferred", reason: "no_brake_pad_candidate" };
  }
  if (!item.series_chassis || item.body === "unknown") return { queue: "deferred", reason: "missing_catalog_identity" };
  if (reasons.includes("multiple_front_configurations") || item.candidate_set.length > 1) {
    return { queue: "deferred", reason: "multiple_wiper_configurations_or_unrepresentable_split" };
  }
  return { queue: "task", reason: item.candidate_set.length === 1
    ? "authoritative_catalog_can_confirm_single_configuration" : "authoritative_catalog_can_supply_missing_configuration" };
}

function buildTask(item, classification) {
  const common = compactRecord(item);
  const question = item.product_line === "wiper"
    ? `Use an authoritative wiper/vehicle application catalog to determine one front driver/passenger/rear configuration for ${item.make} ${item.models.join("/")} ${item.series_chassis} ${item.body}, ${item.year_from}-${item.year_to}.`
    : `Use an authoritative brake application catalog to confirm the single ${item.position} Bendix DB reference for ${item.make} ${item.models.join("/")} ${item.series_chassis} ${item.body}, ${item.year_from}-${item.year_to}.`;
  return { task_id: "", priority: 0, priority_tier: "", ...common, coverage_ay_upper_bound: item.application_years,
    task_reason: classification.reason, question,
    authoritative_sources_required: item.product_line === "wiper" ? "manufacturer or authoritative blade application catalog" : "Bendix/manufacturer brake application catalog",
    required_output: item.product_line === "wiper"
      ? { conclusion: "confirmed|unable_to_determine", configuration: "driver/passenger/rear inches", source_url: "", source_locator: "", notes: "" }
      : { conclusion: "confirmed|unable_to_determine", bendix_db: "DB...", position: item.position, source_url: "", source_locator: "", notes: "" },
    stop_condition: item.product_line === "wiper"
      ? "Stop and return unable_to_determine if the authoritative catalog gives multiple configurations or implies a year/body split the application IDs cannot express."
      : "Stop and return unable_to_determine if the authoritative catalog requires a caliper/OE/PR/production-date discriminator, gives multiple DBs, or implies a split the application IDs cannot express." };
}

function buildDeferred(item, classification) {
  return { deferred_id: "", priority: 0, ...compactRecord(item), coverage_ay_upper_bound: item.application_years,
    deferred_reason: classification.reason,
    next_requirement: deferredRequirement(classification.reason), production_write: false };
}

function compactRecord(item) {
  return { product_line: item.product_line, family: item.family, make: item.make, models: item.models,
    series_chassis: item.series_chassis, body: item.body, position: item.position, years: item.years,
    candidate_set: item.candidate_set, current_published_set: item.current_set, application_ids: item.application_ids,
    applications: item.applications, application_years: item.application_years, input_reasons: item.input_reasons };
}

function deferredRequirement(reason) {
  if (reason === "multi_db_requires_caliper_disc_oe_pr_or_production_split") return "Obtain caliper, disc diameter, OE/PR code, or production-date discriminator and confirm the database can represent the result.";
  if (reason === "multiple_wiper_configurations_or_unrepresentable_split") return "Establish a deterministic year/body split and confirm the application schema can represent it.";
  if (reason === "published_conflict_requires_manual_catalog_governance") return "Manual review of existing published relation and authoritative replacement evidence.";
  if (reason === "missing_catalog_identity") return "Correct or complete model/platform/body identity before fitment research.";
  if (reason === "rear_drum_resolved_not_ai_task") return "None; retain rear drum/shoe evidence and do not count a rear-pad gap.";
  if (reason === "already_covered_no_ai_task") return "None; same DB is already published.";
  return "Additional local evidence or catalog identity is required.";
}

function summarize(rows) {
  const byLine = {};
  for (const line of ["wiper", "brake_pad"]) {
    const selected = rows.filter((row) => row.product_line === line);
    byLine[line] = { questions: selected.length, applications: new Set(selected.flatMap((row) => row.application_ids)).size,
      coverage_ay_upper_bound: unique(selected.flatMap((row) => applicationYearKeys(row.application_ids))).length };
  }
  return { questions: rows.length, by_product_line: byLine };
}

function prioritySort(a, b) {
  const lineOrder = { wiper: 0, brake_pad: 1 };
  return (b.application_years - a.application_years) || (lineOrder[a.product_line] - lineOrder[b.product_line])
    || a.family.localeCompare(b.family) || a.series_chassis.localeCompare(b.series_chassis);
}
function dedupeBrake(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = [row.group_id, row.platform, row.position, (row.candidate_db ?? []).join("/"), (row.application_ids ?? []).join("/")].join("|");
    if (!map.has(key)) map.set(key, row);
  }
  return [...map.values()];
}
function applicationYearKeys(ids) { return unique(ids.flatMap((id) => [...(yearsByApp.get(id) ?? [])].map((year) => `${id}|${year}`))); }
function groupSet(values, keyFn, valueFn) { const out = new Map(); for (const value of values) { const key = keyFn(value); const set = out.get(key) ?? new Set(); set.add(valueFn(value)); out.set(key, set); } return out; }
function countBy(values, keyFn) { const out = {}; for (const value of values) { const key = keyFn(value); out[key] = (out[key] ?? 0) + 1; } return out; }
function norm(value) { return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
function stableId(prefix, row) { return `${prefix}-${crypto.createHash("sha256").update([row.product_line, row.family, row.series_chassis, row.body, row.position, row.candidate_set.join("/"), row.application_ids.join("/")].join("|")).digest("hex").slice(0, 12)}`; }
function unique(values) { return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ""))]; }
function readJsonl(file) { return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse); }
function readLineCount(file) { return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).length; }
function auditFile(file) { const bytes = fs.readFileSync(file); return { path: path.relative(ROOT, file).replace(/\\/g, "/"), bytes: bytes.length,
  sha256: crypto.createHash("sha256").update(bytes).digest("hex"), modified_at: fs.statSync(file).mtime.toISOString() }; }
function writeJsonl(file, values) { fs.writeFileSync(file, values.map((value) => JSON.stringify(value)).join("\n") + (values.length ? "\n" : "")); }
function readme(summary) {
  return `Core-103 Fitment AI Minimal Package - 2026-10-25\n\n` +
    `Purpose\n- tasks.jsonl contains only compact questions expected to be answerable from one authoritative application catalog.\n` +
    `- deferred.jsonl contains deep caliper/OE/PR/production-date work, unrepresentable splits, identity gaps, and rows that need no AI action.\n` +
    `- No raw catalog rows are copied into either queue.\n\n` +
    `Priority\n- Sorted by application-year upper bound, then product line and family.\n` +
    `- P1 is the first 20 questions, P2 the next 40, and P3 the remainder.\n` +
    `- coverage_ay_upper_bound is a ceiling, not projected published coverage.\n\n` +
    `Counts\n- Tasks: ${summary.tasks.questions}; wiper AY ceiling ${summary.tasks.by_product_line.wiper.coverage_ay_upper_bound}; brake-pad AY ceiling ${summary.tasks.by_product_line.brake_pad.coverage_ay_upper_bound}.\n` +
    `- Deferred: ${summary.deferred.questions}; wiper AY ceiling ${summary.deferred.by_product_line.wiper.coverage_ay_upper_bound}; brake-pad AY ceiling ${summary.deferred.by_product_line.brake_pad.coverage_ay_upper_bound}.\n\n` +
    `Rules\n- Return unable_to_determine when a direct authoritative catalog does not produce one result.\n` +
    `- Do not infer across generations or invent NBP SKUs.\n` +
    `- Do not treat rear drum/shoe evidence as a missing rear brake pad.\n`;
}
