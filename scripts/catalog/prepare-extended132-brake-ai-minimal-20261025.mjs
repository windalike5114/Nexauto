import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { POPULAR_EXTENDED_80_VEHICLE_GROUPS } from "./popular-vehicle-models.mjs";

const ROOT = process.cwd();
const SOURCE = path.join(ROOT, "outputs", "extended132-brake-knowledge-phase1-20261025");
const OUT = path.join(ROOT, "outputs", "extended132-brake-ai-minimal-20261025");
const INPUTS = {
  summary: path.join(SOURCE, "summary.json"),
  conditional: path.join(SOURCE, "conditional-reference-fitments.jsonl"),
  review: path.join(SOURCE, "multi-candidate-review.jsonl"),
  rearDrum: path.join(SOURCE, "rear-drum-not-applicable.jsonl"),
  snapshot: path.join(ROOT, "outputs", "brake-alias-group-review-round5-20261025", "after-snapshot.json")
};

const phase = JSON.parse(fs.readFileSync(INPUTS.summary, "utf8"));
if (phase.coverage?.baseline_application_years !== 4781 || phase.coverage?.baseline_percent !== 63.43) {
  throw new Error("Refusing stale baseline: expected corrected 4,781 AY / 63.43%.");
}
const rows = dedupe([...readJsonl(INPUTS.conditional), ...readJsonl(INPUTS.review)]);
const rearDrums = readJsonl(INPUTS.rearDrum);
const snapshot = JSON.parse(fs.readFileSync(INPUTS.snapshot, "utf8"));
const yearsByApp = groupSet(snapshot.years.filter((row) => Number(row.model_year) >= 2000 && Number(row.model_year) <= 2026),
  (row) => row.application_id, (row) => Number(row.model_year));
const groupMeta = new Map(POPULAR_EXTENDED_80_VEHICLE_GROUPS.filter((group) => group.rank >= 104 && group.rank <= 132)
  .map((group) => [group.label, group]));
const phaseGroup = new Map((phase.groups ?? []).map((group) => [group.group, group]));

const tasks = [];
const deferred = [];
for (const row of rows) {
  const record = compact(row);
  const decision = classify(row);
  if (decision.queue === "task") tasks.push(buildTask(record, decision));
  else deferred.push(buildDeferred(record, decision));
}
assignPriorities(tasks, "EXT132-BRAKE-AI");
assignPriorities(deferred, "EXT132-BRAKE-DEF");

const summary = {
  generated_at: new Date().toISOString(),
  mode: "minimal_ai_research_package_report_only",
  scope: { ranks: [104, 132], model_years: [2000, 2026], product_line: "brake_pad",
    applications: phase.counts.applications, application_years: phase.counts.application_years },
  corrected_baseline: {
    knowledge_application_years: phase.coverage.baseline_application_years,
    knowledge_percent: phase.coverage.baseline_percent,
    knowledge_applications: phase.coverage.baseline_any_knowledge_applications,
    full_axle_application_years: phase.coverage.baseline_full_axle_knowledge_application_years
  },
  policy: {
    task: "Only a shared platform+body+position question with one DB candidate, no live conflict, no existing same-DB coverage, and no caliper/disc/OE/PR/production-date or generation split.",
    deferred: "Multiple DBs, live conflicts, missing platform identity, deep configuration discriminators, already-covered confirmations, and database-unrepresentable splits.",
    rear_drum: "Rear shoe/drum evidence is excluded from both tasks and missing rear-pad research.",
    upper_bound: "Per-row research_scope_ay_upper_bound is affected scope, not additive projected coverage. The phase report's deduplicated new-coverage ceiling is authoritative."
  },
  inputs: {
    conditional_rows: readJsonl(INPUTS.conditional).length,
    review_rows: readJsonl(INPUTS.review).length,
    rows_after_deduplication: rows.length,
    audits: Object.fromEntries(Object.entries(INPUTS).map(([name, file]) => [name, auditFile(file)]))
  },
  tasks: summarize(tasks),
  deferred: summarize(deferred),
  deferred_reasons: countBy(deferred, (row) => row.deferred_reason),
  application_year_ceiling: {
    task_research_scope_ay_upper_bound: summarize(tasks).research_scope_ay_upper_bound,
    deferred_research_scope_ay_upper_bound: summarize(deferred).research_scope_ay_upper_bound,
    potential_new_knowledge_ay_upper_bound: phase.coverage.local_evidence_upper_bound_new_application_years,
    potential_total_knowledge_ay_upper_bound: phase.coverage.baseline_application_years + phase.coverage.local_evidence_upper_bound_new_application_years,
    potential_total_knowledge_percent_upper_bound: phase.coverage.local_evidence_upper_bound_percent,
    note: "All potential new AY are deferred; tasks.jsonl contributes zero publishable or projected AY until a later validated result exists."
  },
  rear_drum_excluded: { output_rows_without_pad_evidence: rearDrums.length,
    known_exempt_applications: phase.counts.rear_drum_exempt_applications,
    applications_in_output_rows: new Set(rearDrums.flatMap((row) => row.application_ids ?? [])).size },
  priority: {
    coverage: "Descending research-scope AY, then rank/platform/position.",
    commercial: "Descending fleetCount * group knowledge-gap rate; proxy only.",
    tier: "P1 first 20 by coverage priority, P2 next 40, P3 remainder."
  },
  safeguards: [
    "No web browsing or AI search was performed while preparing this package.",
    "No production database read or write was performed by this script.",
    "No full catalog/source rows are copied into tasks or deferred records.",
    "DB references are not NexAuto NBP SKUs and no NBP was synthesized."
  ]
};

fs.mkdirSync(OUT, { recursive: true });
writeJsonl(path.join(OUT, "tasks.jsonl"), tasks);
writeJsonl(path.join(OUT, "deferred.jsonl"), deferred);
fs.writeFileSync(path.join(OUT, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
fs.writeFileSync(path.join(OUT, "README"), readme(summary));
if (process.env.EXT132_AI_RUNNER) fs.copyFileSync(path.resolve(ROOT, process.env.EXT132_AI_RUNNER), path.join(OUT, "rerun.mjs"));
console.log(JSON.stringify({ output_dir: OUT, tasks: summary.tasks, deferred: summary.deferred,
  new_knowledge_ay_upper_bound: summary.application_year_ceiling.potential_new_knowledge_ay_upper_bound }, null, 2));

function classify(row) {
  const candidates = unique(row.candidate_db ?? []);
  const current = unique(row.live_published_db ?? []);
  const reasons = unique([...(row.decision_reasons ?? []), ...((row.sources ?? []).map((source) => source.original_reason).filter(Boolean))]);
  const joined = reasons.join("|");
  const blockers = [];
  if (candidates.length > 1 || /multiple_db|multiple_brake_configurations/.test(joined)) blockers.push("multiple_db");
  if (current.some((db) => !candidates.includes(db)) || candidates.some((db) => current.length && !current.includes(db))
    || /published_online_db_conflict/.test(joined)) blockers.push("published_conflict");
  if (/caliper|disc|OE|PR|production|generation|body_mismatch|drive_mismatch|configuration_discriminator/.test(joined)) blockers.push("deep_or_unrepresentable_split");
  if (!row.platform || /missing_platform_identity/.test(joined)) blockers.push("missing_platform_identity");
  if (/review_only_source_evidence/.test(joined)) blockers.push("review_only_evidence");
  if (/already_covered_by_same_published_db/.test(joined) && candidates.length === 1 && current.includes(candidates[0])) blockers.push("already_covered_same_db");
  if (candidates.length !== 1) blockers.push(candidates.length ? "not_unique" : "no_candidate");
  if (!blockers.length) return { queue: "task", reason: "direct_authoritative_catalog_single_db_confirmation", blockers: [] };
  return { queue: "deferred", reason: deferredReason(blockers), blockers: unique(blockers) };
}

function compact(row) {
  const ids = unique(row.application_ids ?? []).sort();
  const years = unique(ids.flatMap((id) => [...(yearsByApp.get(id) ?? [])])).sort((a, b) => a - b);
  const meta = groupMeta.get(row.group) ?? {};
  const coverage = phaseGroup.get(row.group) ?? {};
  return {
    rank: row.rank, family: row.group, make: row.make, models: unique(row.models ?? []),
    platform: row.platform || "", body: row.body || "unknown", position: row.position,
    candidate_set: unique(row.candidate_db ?? []), current_published_set: unique(row.live_published_db ?? []),
    application_ids: ids, applications: ids.length, years, year_from: years[0] ?? null, year_to: years.at(-1) ?? null,
    research_scope_ay_upper_bound: applicationYearKeys(ids).length,
    fleet_count: meta.fleetCount ?? null,
    group_baseline_knowledge_percent: coverage.baseline_knowledge_percent ?? null,
    commercial_gap_proxy: meta.fleetCount && Number.isFinite(coverage.baseline_knowledge_percent)
      ? Math.round(meta.fleetCount * (1 - coverage.baseline_knowledge_percent / 100)) : null
  };
}

function buildTask(record, decision) {
  return { task_id: "", coverage_priority: 0, commercial_priority: 0, priority_tier: "", ...record,
    task_reason: decision.reason,
    question: `Use an authoritative Bendix or mainstream brake application catalog to confirm exactly one ${record.position} DB reference for ${record.make} ${record.models.join("/")} ${record.platform} ${record.body}, ${record.year_from}-${record.year_to}.`,
    required_output: { conclusion: "confirmed|unable_to_determine", bendix_db: "DB...", position: record.position,
      source_catalog: "", source_locator: "", notes: "" },
    stop_condition: "Return unable_to_determine immediately if the catalog gives multiple DBs or requires caliper, disc, OE, PR code, production date, or a split the database cannot express.",
    production_write: false };
}

function buildDeferred(record, decision) {
  return { deferred_id: "", coverage_priority: 0, commercial_priority: 0, priority_tier: "", ...record,
    deferred_reason: decision.reason, blocker_tags: decision.blockers,
    next_requirement: requirement(decision.reason), production_write: false };
}

function assignPriorities(rows, prefix) {
  rows.sort((a, b) => b.research_scope_ay_upper_bound - a.research_scope_ay_upper_bound || a.rank - b.rank
    || a.platform.localeCompare(b.platform) || a.position.localeCompare(b.position));
  rows.forEach((row, index) => { row.coverage_priority = index + 1; row.priority_tier = index < 20 ? "P1" : index < 60 ? "P2" : "P3";
    if ("task_id" in row) row.task_id = stableId(prefix, row); else row.deferred_id = stableId(prefix, row); });
  [...rows].sort((a, b) => (b.commercial_gap_proxy ?? -1) - (a.commercial_gap_proxy ?? -1)
    || b.research_scope_ay_upper_bound - a.research_scope_ay_upper_bound).forEach((row, index) => { row.commercial_priority = index + 1; });
}

function deferredReason(blockers) {
  if (blockers.includes("multiple_db")) return "multi_db_requires_caliper_disc_oe_pr_or_production_split";
  if (blockers.includes("published_conflict")) return "published_conflict_requires_manual_catalog_governance";
  if (blockers.includes("deep_or_unrepresentable_split")) return "deep_configuration_or_unrepresentable_split";
  if (blockers.includes("already_covered_same_db")) return "already_covered_no_ai_task";
  if (blockers.includes("missing_platform_identity")) return "missing_platform_identity";
  return "not_directly_answerable_as_one_db";
}
function requirement(reason) {
  if (reason.startsWith("multi_db") || reason.startsWith("deep_")) return "Resolve caliper/disc/OE/PR/production-date or generation split and confirm the database can represent it.";
  if (reason.startsWith("published_conflict")) return "Manual governance review of existing published DB relations before any research or replacement.";
  if (reason === "missing_platform_identity") return "Repair platform/chassis identity first.";
  if (reason === "already_covered_no_ai_task") return "None; the same DB is already published.";
  return "Obtain stronger local identity/evidence before assigning AI research.";
}
function summarize(rows) {
  const ids = unique(rows.flatMap((row) => row.application_ids));
  return { questions: rows.length, applications: ids.length, research_scope_ay_upper_bound: applicationYearKeys(ids).length,
    by_priority_tier: countBy(rows, (row) => row.priority_tier) };
}
function readme(summary) {
  return `Extended-132 Brake AI Minimal Package - 2026-10-25\n\n` +
    `Baseline\n- Rank 104-132, 2000-2026: ${summary.scope.applications} applications / ${summary.scope.application_years} AY.\n` +
    `- Corrected knowledge baseline: ${summary.corrected_baseline.knowledge_application_years} AY (${summary.corrected_baseline.knowledge_percent}%).\n\n` +
    `AI queue\n- tasks.jsonl: ${summary.tasks.questions} questions / ${summary.tasks.applications} applications / ${summary.tasks.research_scope_ay_upper_bound} affected AY ceiling.\n` +
    `- No row met the strict direct-one-catalog/one-DB/no-conflict rule; an empty task file is intentional.\n` +
    `- deferred.jsonl: ${summary.deferred.questions} compact platform+body+position records / ${summary.deferred.applications} applications / ${summary.deferred.research_scope_ay_upper_bound} affected AY ceiling.\n` +
    `- Deduplicated possible new knowledge ceiling remains ${summary.application_year_ceiling.potential_new_knowledge_ay_upper_bound} AY; all of it is deferred.\n\n` +
    `Rules\n- Multiple DBs or caliper/disc/OE/PR/production-date/generation splits never enter tasks.\n` +
    `- Rear drum/shoe evidence (${summary.rear_drum_excluded.known_exempt_applications} known exempt applications; ${summary.rear_drum_excluded.output_rows_without_pad_evidence} explicit output rows) is excluded, not counted as a rear-pad gap.\n` +
    `- No full source rows, source text, or catalog snapshot is copied into this package. No NBP is generated.\n\n` +
    `Re-run\n- From the repository root: node outputs/extended132-brake-ai-minimal-20261025/rerun.mjs\n`;
}

function dedupe(values) { const map = new Map(); for (const row of values) { const key = [row.group_id, row.platform, row.body, row.position,
  (row.candidate_db ?? []).join("/"), (row.application_ids ?? []).join("/")].join("|"); if (!map.has(key)) map.set(key, row); } return [...map.values()]; }
function applicationYearKeys(ids) { return unique(ids.flatMap((id) => [...(yearsByApp.get(id) ?? [])].map((year) => `${id}|${year}`))); }
function groupSet(values, keyFn, valueFn) { const out = new Map(); for (const value of values) { const key = keyFn(value); const set = out.get(key) ?? new Set(); set.add(valueFn(value)); out.set(key, set); } return out; }
function countBy(values, keyFn) { const out = {}; for (const value of values) { const key = keyFn(value); out[key] = (out[key] ?? 0) + 1; } return out; }
function unique(values) { return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ""))]; }
function readJsonl(file) { return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse); }
function stableId(prefix, row) { return `${prefix}-${crypto.createHash("sha256").update([row.rank, row.platform, row.body, row.position,
  row.candidate_set.join("/"), row.application_ids.join("/")].join("|")).digest("hex").slice(0, 12)}`; }
function auditFile(file) { const bytes = fs.readFileSync(file); return { path: path.relative(ROOT, file).replace(/\\/g, "/"), bytes: bytes.length,
  sha256: crypto.createHash("sha256").update(bytes).digest("hex"), modified_at: fs.statSync(file).mtime.toISOString() }; }
function writeJsonl(file, values) { fs.writeFileSync(file, values.map((value) => JSON.stringify(value)).join("\n") + (values.length ? "\n" : "")); }
