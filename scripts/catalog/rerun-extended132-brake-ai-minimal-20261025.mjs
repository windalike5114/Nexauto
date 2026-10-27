process.env.EXT132_AI_RUNNER = "scripts/catalog/rerun-extended132-brake-ai-minimal-20261025.mjs";
const modulePath = import.meta.url.replace(/\\/g, "/").includes("/outputs/")
  ? "../../scripts/catalog/prepare-extended132-brake-ai-minimal-20261025.mjs"
  : "./prepare-extended132-brake-ai-minimal-20261025.mjs";
await import(modulePath);
