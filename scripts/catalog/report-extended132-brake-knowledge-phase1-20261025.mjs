process.env.BRAKE_TARGET_RANK_MIN = "104";
process.env.BRAKE_TARGET_RANK_MAX = "132";
process.env.BRAKE_PHASE_OUTPUT = "outputs/extended132-brake-knowledge-phase1-20261025";
process.env.BRAKE_PHASE_RUNNER = "scripts/catalog/report-extended132-brake-knowledge-phase1-20261025.mjs";

const reportModule = import.meta.url.replace(/\\/g, "/").includes("/outputs/")
  ? "../../scripts/catalog/report-core103-brake-knowledge-phase1-20261025.mjs"
  : "./report-core103-brake-knowledge-phase1-20261025.mjs";

await import(reportModule);
