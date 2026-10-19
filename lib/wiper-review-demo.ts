import reviewRows from "@/data/wiper-high-confidence-demo.json";

type DemoReviewRow = (typeof reviewRows)[number];

export type WiperReviewDemo = DemoReviewRow & {
  confidencePercent: number;
  reasonLabel: string;
};

export type WiperReviewVehicle = {
  make?: string;
  model?: string;
  year?: string;
  chassis?: string;
  body?: string;
  engine?: string;
};

export function findHighConfidenceWiperReview(vehicle: WiperReviewVehicle): WiperReviewDemo | null {
  const year = Number(vehicle.year);
  const chassisCodes = new Set(splitChassisCodes(vehicle.chassis));
  if (!Number.isInteger(year) || chassisCodes.size === 0) return null;

  const match = reviewRows.find((row) => normalize(row.make) === normalize(vehicle.make)
    && normalize(row.model) === normalize(vehicle.model)
    && year >= row.yearStart
    && year <= row.yearEnd
    && row.chassisCodes.some((code) => chassisCodes.has(normalizeCode(code)))
    && compatibleDescriptor(row.body, vehicle.body)
    && compatibleDescriptor(row.engine, vehicle.engine));

  if (!match) return null;
  return {
    ...match,
    confidencePercent: Math.round(match.confidence * 100),
    reasonLabel: match.reason === "generation_start_matches_wiper_range_start"
      ? "Vehicle generation start matches the supplier wiper range"
      : "Nearest supplier range to this vehicle generation"
  };
}

function compatibleDescriptor(expected: string, actual?: string) {
  if (!expected || !actual) return true;
  return normalize(expected) === normalize(actual);
}

function splitChassisCodes(value?: string) {
  return String(value ?? "")
    .split(/[,/|]+/)
    .map(normalizeCode)
    .filter(Boolean);
}

function normalizeCode(value: string) {
  return normalize(value).replace(/[^a-z0-9]/g, "");
}

function normalize(value?: string) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}
