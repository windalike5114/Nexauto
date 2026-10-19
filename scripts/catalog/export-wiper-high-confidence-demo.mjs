import fs from "node:fs/promises";
import path from "node:path";

const inputPath = path.resolve(process.argv[2] ?? "tmp/fitment-v4/fitment-v4-manifest.json");
const outputPath = path.resolve(process.argv[3] ?? "data/wiper-high-confidence-demo.json");
const minimumConfidence = Number(process.argv[4] ?? 0.8);
const manifest = JSON.parse(await fs.readFile(inputPath, "utf8"));

const rows = manifest.manualReview
  .filter((row) => row.category === "wiper")
  .filter((row) => row.suggested_configuration_key && Number(row.suggestion_confidence) >= minimumConfidence)
  .map((row) => ({
    applicationKey: String(row.application_key ?? ""),
    make: String(row.make ?? ""),
    model: String(row.model ?? ""),
    chassisCodes: splitCodes(row.chassis),
    body: String(row.body ?? ""),
    engine: String(row.engine ?? ""),
    yearStart: Number(row.year_start),
    yearEnd: Number(row.year_end),
    suggestedConfiguration: parseConfiguration(row.suggested_configuration_key),
    candidateRanges: String(row.candidate_ranges ?? ""),
    confidence: Number(row.suggestion_confidence),
    reason: String(row.suggestion_reason ?? "")
  }))
  .sort((left, right) => left.make.localeCompare(right.make)
    || left.model.localeCompare(right.model)
    || left.yearStart - right.yearStart
    || left.applicationKey.localeCompare(right.applicationKey));

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputPath, minimumConfidence, rows: rows.length }, null, 2));

function splitCodes(value) {
  return String(value ?? "")
    .split(/[,/|]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseConfiguration(value) {
  const [driver, passenger, rear] = String(value).split("/");
  return {
    driverLengthIn: Number(driver),
    passengerLengthIn: Number(passenger),
    rearLengthIn: rear && rear !== "-" ? Number(rear) : null
  };
}
