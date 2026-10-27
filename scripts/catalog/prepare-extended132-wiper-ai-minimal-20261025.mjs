import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const INPUT = path.join(ROOT, "outputs", "extended132-wiper-phase-20261025", "multi-candidate-review.jsonl");
const OUT = path.join(ROOT, "outputs", "extended132-wiper-ai-minimal-20261025");
const EXTENDED132_APPLICATION_YEARS = 46_676;

if (process.argv.includes("--apply")) throw new Error("This script is report-only and never writes production.");

const inputRows = readJsonl(INPUT);
const grouped = groupQuestions(inputRows);
assertNoCrossQuestionApplicationOverlap(grouped);
const tasks = [];
const deferred = [];

for (const item of grouped) {
  const decision = classify(item);
  if (decision.queue === "task") tasks.push(buildTask(item, decision));
  else deferred.push(buildDeferred(item, decision));
}

tasks.sort(prioritySort);
tasks.forEach((row, index) => {
  row.task_id = stableId("EXT132-WIPER-AI", row);
  row.priority = index + 1;
  row.priority_tier = priorityTier(row.coverage_ay_upper_bound);
});
deferred.sort(prioritySort);
deferred.forEach((row, index) => {
  row.deferred_id = stableId("EXT132-WIPER-DEF", row);
  row.priority = index + 1;
  row.priority_tier = priorityTier(row.coverage_ay_upper_bound);
});

const summary = {
  generated_at: new Date().toISOString(),
  mode: "minimal_ai_research_package_report_only",
  production_writes: false,
  scope: {
    popular_ranks: [104, 132],
    model_years: [2000, 2026],
    product_line: "wiper",
    extended132_application_year_denominator: EXTENDED132_APPLICATION_YEARS
  },
  policy: {
    grouping: "make/model family + series/chassis + body + sorted candidate configuration set",
    tasks: "Identity-complete questions where one authoritative wiper catalog lookup can return one full driver/passenger/rear configuration.",
    deferred: "Missing identity, cross-generation risk, multiple configurations, or a year/body split that may not be representable by the current application IDs.",
    coverage_ay_upper_bound: "Maximum application-years addressable if the whole compact question is uniquely resolved; not publishable coverage until separately validated and published.",
    priority: "Descending AY upper bound, then popular rank, family, series/chassis, and body. P1 >=20 AY, P2 5-19 AY, P3 1-4 AY."
  },
  input: {
    rows: inputRows.length,
    unique_questions_after_grouping: grouped.length,
    source: auditFile(INPUT)
  },
  tasks: summarize(tasks),
  deferred: summarize(deferred),
  task_reasons: countBy(tasks, (row) => row.task_reason),
  deferred_reasons: countBy(deferred, (row) => row.deferred_reason),
  safeguards: [
    "No web browsing, AI search, or production database write was performed.",
    "No original source_rows or raw supplier rows are copied into the package.",
    "A confirmed research answer still requires separate source validation, conflict checks, and report-only publication preparation.",
    "Tasks must return unable_to_determine when one authoritative lookup yields multiple configurations or a required split."
  ]
};

fs.mkdirSync(OUT, { recursive: true });
writeJsonl(path.join(OUT, "tasks.jsonl"), tasks);
writeJsonl(path.join(OUT, "deferred.jsonl"), deferred);
fs.writeFileSync(path.join(OUT, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
fs.writeFileSync(path.join(OUT, "README"), readme(summary));

console.log(JSON.stringify({ output_dir: OUT, tasks: summary.tasks, deferred: summary.deferred,
  task_reasons: summary.task_reasons, deferred_reasons: summary.deferred_reasons }, null, 2));

function groupQuestions(rows) {
  const map = new Map();
  for (const row of rows) {
    if (Number(row.rank) < 104 || Number(row.rank) > 132) throw new Error(`Out-of-scope rank: ${row.rank}`);
    const candidates = unique(row.candidate_configurations ?? []).sort();
    const family = row.popular_group || `${row.make} ${row.model}`.trim();
    const seriesChassis = String(row.series_code || row.series_name || "").trim();
    const body = String(row.body_style || "unknown").trim().toLowerCase();
    const key = [norm(row.make), norm(family), norm(seriesChassis), norm(body), candidates.join("/")].join("|");
    const item = map.get(key) ?? {
      rank: Number(row.rank), group_id: row.group_id, family, make: row.make, models: new Set(),
      series_chassis: seriesChassis, body, candidate_set: candidates, application_ids: new Set(),
      application_years_sum: 0, years: new Set(), input_reasons: new Set(), input_rows: 0
    };
    item.rank = Math.min(item.rank, Number(row.rank));
    item.models.add(row.model);
    for (const id of row.application_ids ?? []) {
      item.application_ids.add(id);
    }
    item.application_years_sum += Number(row.application_years ?? 0);
    for (const year of row.years ?? []) item.years.add(Number(year));
    item.input_reasons.add(row.reason);
    item.input_rows += 1;
    map.set(key, item);
  }
  return [...map.values()].map((item) => {
    const years = [...item.years].sort((a, b) => a - b);
    return {
      ...item,
      models: [...item.models].filter(Boolean).sort(),
      application_ids: [...item.application_ids].sort(),
      applications: item.application_ids.size,
      application_years: item.application_years_sum,
      years,
      year_from: years[0] ?? null,
      year_to: years.at(-1) ?? null,
      input_reasons: [...item.input_reasons].filter(Boolean).sort()
    };
  });
}

function classify(item) {
  const reasons = new Set(item.input_reasons);
  if (!item.series_chassis || item.body === "unknown") {
    return { queue: "deferred", reason: reasons.has("missing_series_code_cross_generation_risk")
      ? "missing_series_or_cross_generation_identity" : "missing_catalog_identity" };
  }
  if (item.candidate_set.length > 1 || reasons.has("multiple_front_configurations")) {
    return { queue: "deferred", reason: reasons.has("incomplete_year_coverage")
      ? "multiple_configurations_or_year_split" : "multiple_configurations_or_unrepresentable_split" };
  }
  if (reasons.has("incomplete_year_coverage")) {
    return { queue: "deferred", reason: "incomplete_year_evidence_may_require_split" };
  }
  return { queue: "task", reason: item.candidate_set.length === 1
    ? "one_catalog_lookup_can_confirm_single_configuration"
    : "one_catalog_lookup_can_supply_single_configuration" };
}

function buildTask(item, decision) {
  const candidateText = item.candidate_set.length ? ` Candidate to confirm: ${item.candidate_set[0]}.` : "";
  return {
    task_id: "", priority: 0, priority_tier: "", ...compact(item),
    coverage_ay_upper_bound: item.application_years,
    extended132_pp_upper_bound: round(item.application_years / EXTENDED132_APPLICATION_YEARS * 100, 4),
    task_reason: decision.reason,
    question: `In one authoritative manufacturer or blade application catalog, determine the single driver/passenger/rear wiper configuration for ${item.make} ${item.models.join("/")} ${item.series_chassis} ${item.body}, ${item.year_from}-${item.year_to}.${candidateText}`,
    required_output: {
      conclusion: "confirmed|unable_to_determine",
      configuration: "driver/passenger/rear inches",
      applicability_years: "YYYY-YYYY",
      source_url: "",
      source_locator: "catalog row/page/vehicle selector",
      notes: ""
    },
    stop_condition: "Return unable_to_determine if the catalog gives multiple configurations, crosses a generation, requires a discriminator absent from the application IDs, or implies a year/body split the database cannot express."
  };
}

function buildDeferred(item, decision) {
  return {
    deferred_id: "", priority: 0, priority_tier: "", ...compact(item),
    coverage_ay_upper_bound: item.application_years,
    extended132_pp_upper_bound: round(item.application_years / EXTENDED132_APPLICATION_YEARS * 100, 4),
    deferred_reason: decision.reason,
    next_requirement: deferredRequirement(decision.reason),
    production_write: false
  };
}

function compact(item) {
  return {
    rank: item.rank, group_id: item.group_id, family: item.family, make: item.make, models: item.models,
    series_chassis: item.series_chassis, body: item.body, years: item.years,
    candidate_set: item.candidate_set, application_ids: item.application_ids,
    applications: item.applications, application_years: item.application_years,
    input_reasons: item.input_reasons, input_rows: item.input_rows
  };
}

function deferredRequirement(reason) {
  if (reason === "missing_series_or_cross_generation_identity" || reason === "missing_catalog_identity") {
    return "Correct or complete series/chassis and generation identity before wiper research.";
  }
  if (reason === "multiple_configurations_or_year_split" || reason === "incomplete_year_evidence_may_require_split") {
    return "Establish authoritative year boundaries and confirm the current application IDs can represent every segment.";
  }
  return "Identify the deterministic series/body/year discriminator and confirm the database can represent the split.";
}

function summarize(rows) {
  const applicationIds = unique(rows.flatMap((row) => row.application_ids));
  const ay = rows.reduce((sum, row) => sum + row.application_years, 0);
  return {
    questions: rows.length,
    applications: applicationIds.length,
    coverage_ay_upper_bound: ay,
    extended132_pp_upper_bound: round(ay / EXTENDED132_APPLICATION_YEARS * 100, 4),
    by_priority_tier: countBy(rows, (row) => row.priority_tier)
  };
}

function assertNoCrossQuestionApplicationOverlap(rows) {
  const seen = new Map();
  for (const row of rows) for (const id of row.application_ids) {
    if (seen.has(id)) throw new Error(`Application ${id} appears in more than one compact question`);
    seen.set(id, true);
  }
}

function prioritySort(a, b) {
  return (b.application_years - a.application_years) || (a.rank - b.rank) || a.family.localeCompare(b.family)
    || a.series_chassis.localeCompare(b.series_chassis) || a.body.localeCompare(b.body);
}
function priorityTier(ay) { return ay >= 20 ? "P1" : ay >= 5 ? "P2" : "P3"; }
function stableId(prefix, row) { return `${prefix}-${crypto.createHash("sha256").update([
  row.make, row.family, row.series_chassis, row.body, row.candidate_set.join("/"), row.application_ids.join("/")
].join("|")).digest("hex").slice(0, 12)}`; }
function norm(value) { return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
function unique(values) { return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ""))]; }
function round(value, digits = 2) { const factor = 10 ** digits; return Math.round((value + Number.EPSILON) * factor) / factor; }
function countBy(values, keyFn) { const out = {}; for (const value of values) { const key = keyFn(value); out[key] = (out[key] ?? 0) + 1; } return out; }
function readJsonl(file) { return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse); }
function auditFile(file) { const bytes = fs.readFileSync(file); return { path: path.relative(ROOT, file).replace(/\\/g, "/"),
  bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex"), modified_at: fs.statSync(file).mtime.toISOString() }; }
function writeJsonl(file, values) { fs.writeFileSync(file, values.map((value) => JSON.stringify(value)).join("\n") + (values.length ? "\n" : "")); }

function readme(summary) {
  return `Extended-132 Wiper Minimal AI Package - 2026-10-25\n\n` +
    `Scope\n- Only popular ranks 104-132 and model years 2000-2026.\n- Input is the existing multi-candidate review report; no production write or web lookup occurs.\n\n` +
    `Queues\n- tasks.jsonl: ${summary.tasks.questions} compact one-catalog questions; AY ceiling ${summary.tasks.coverage_ay_upper_bound} (${summary.tasks.extended132_pp_upper_bound}pp of Extended-132).\n` +
    `- deferred.jsonl: ${summary.deferred.questions} questions; AY ceiling ${summary.deferred.coverage_ay_upper_bound} (${summary.deferred.extended132_pp_upper_bound}pp).\n` +
    `- Raw supplier source rows are not copied. Candidate configurations are retained only as compact decision choices.\n\n` +
    `Priority\n- Sort order is descending application-year ceiling, then popular rank and identity.\n` +
    `- P1 >=20 AY; P2 5-19 AY; P3 1-4 AY. coverage_ay_upper_bound is a ceiling, not projected publishable coverage.\n\n` +
    `Research contract\n- Use one authoritative manufacturer or blade application catalog.\n` +
    `- Return one driver/passenger/rear configuration with applicability years and a precise source locator.\n` +
    `- Return unable_to_determine when there is more than one configuration, a generation boundary, a missing discriminator, or an unrepresentable split.\n` +
    `- Any confirmed answer still needs a separate validation and report-only publication batch.\n`;
}
