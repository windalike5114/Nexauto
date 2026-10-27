process.env.SPRINTER_BRAKE_RUNNER = "scripts/catalog/rerun-extended132-model-sprinter-brake-20261025.mjs";
const modulePath = import.meta.url.replace(/\\/g, "/").includes("/outputs/")
  ? "../../scripts/catalog/report-extended132-model-sprinter-brake-20261025.mjs"
  : "./report-extended132-model-sprinter-brake-20261025.mjs";
await import(modulePath);
