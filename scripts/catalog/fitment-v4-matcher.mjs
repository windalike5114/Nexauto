import {
  APPROVED_FRONT_WIPER_LENGTHS,
  APPROVED_REAR_WIPER_LENGTHS,
  cleanText,
  compactPartKey,
  inferBodyStyle,
  normalKey,
  nullableYear
} from "./catalog-v3-normalization.mjs";

const DRIVE_TOKENS = ["FWD", "RWD", "AWD", "4WD"];
const BATTERY_FUEL = new Map([
  ["P", "petrol"],
  ["PETROL", "petrol"],
  ["G", "petrol"],
  ["GASOLINE", "petrol"],
  ["D", "diesel"],
  ["DIESEL", "diesel"],
  ["H", "hybrid"],
  ["HYBRID", "hybrid"],
  ["E", "electric"],
  ["EV", "electric"],
  ["ELECTRIC", "electric"]
]);

export const BATTERY_TIER_PRIORITY = {
  highly_recommended: 3,
  recommended: 2,
  fits: 1
};

export function parseYearRange(value) {
  const text = cleanText(value);
  const years = [...text.matchAll(/(?:18|19|20|21)\d{2}/g)].map((match) => Number(match[0]));
  if (!years.length) return { year_start: null, year_end: null };
  const start = years[0];
  const rawEnd = years[1] ?? years[0];
  return { year_start: start, year_end: rawEnd >= 3000 ? null : rawEnd };
}

export function yearsOverlap(leftStart, leftEnd, rightStart, rightEnd) {
  const aStart = nullableYear(leftStart) ?? Number.NEGATIVE_INFINITY;
  const aEnd = nullableYear(leftEnd) ?? Number.POSITIVE_INFINITY;
  const bStart = nullableYear(rightStart) ?? Number.NEGATIVE_INFINITY;
  const bEnd = nullableYear(rightEnd) ?? Number.POSITIVE_INFINITY;
  return Math.max(aStart, bStart) <= Math.min(aEnd, bEnd);
}

export function expandCodeField(value) {
  const values = [];
  for (const rawGroup of cleanText(value).split(/[,;]+/)) {
    const group = cleanText(rawGroup);
    if (!group) continue;
    const parts = group.split("/").map(cleanText).filter(Boolean);
    if (parts.length === 1) {
      values.push(compactPartKey(parts[0]));
      continue;
    }
    const first = parts[0].toUpperCase();
    values.push(compactPartKey(first));
    const prefixMatch = first.match(/^(.*?)([A-Z]*\d+[A-Z]*)$/);
    const engineMatch = first.match(/^(.+[-_])([A-Z0-9]+)$/);
    for (const part of parts.slice(1)) {
      const upper = part.toUpperCase();
      if (/^[A-Z]+\d/.test(upper)) values.push(compactPartKey(upper));
      else if (engineMatch && /^[A-Z]{2,4}$/.test(upper)) values.push(compactPartKey(`${engineMatch[1]}${upper}`));
      else if (prefixMatch && /^\d+[A-Z]*$/.test(upper)) {
        const digitIndex = prefixMatch[2].search(/\d/);
        values.push(compactPartKey(`${prefixMatch[1]}${prefixMatch[2].slice(0, digitIndex)}${upper}`));
      } else values.push(compactPartKey(upper));
    }
  }
  return [...new Set(values.filter(Boolean))];
}

export function extractEngineCodes(value) {
  const text = cleanText(value).toUpperCase();
  const candidates = new Set(expandCodeField(text));
  for (const match of text.matchAll(/\b[0-9A-Z]{1,6}(?:-[0-9A-Z]{2,8})+\b/g)) {
    for (const code of expandCodeField(match[0])) candidates.add(code);
  }
  for (const match of text.matchAll(/\b(?:[A-Z]{1,4}\d{1,4}[A-Z]{0,3}|\d{1,2}[A-Z]{1,4}[A-Z0-9]{0,4})\b/g)) {
    const token = compactPartKey(match[0]);
    if (/[A-Z]/.test(token) && /\d/.test(token) && token.length >= 4) candidates.add(token);
  }
  return [...candidates].filter((token) => !/^\d+(?:L|KW|CC)$/.test(token));
}

export function extractDrivetrains(value) {
  const upper = cleanText(value).toUpperCase();
  const result = new Set();
  for (const token of DRIVE_TOKENS) if (new RegExp(`\\b${token}\\b`).test(upper)) result.add(token);
  return [...result];
}

export function extractFuelTypes(value) {
  const upper = cleanText(value).toUpperCase();
  const result = new Set();
  const direct = BATTERY_FUEL.get(upper);
  if (direct) result.add(direct);
  if (/HYBRID|PETROL\s*\/\s*ELECTRIC/.test(upper)) result.add("hybrid");
  if (/\bDIESEL\b/.test(upper)) result.add("diesel");
  if (/\bPETROL\b|\bGASOLINE\b/.test(upper) && !result.has("hybrid")) result.add("petrol");
  if (/\bELECTRIC\b|\bEV\b/.test(upper) && !result.has("hybrid")) result.add("electric");
  return [...result];
}

export function extractDisplacements(value) {
  const text = cleanText(value).toUpperCase();
  const result = new Set();
  for (const match of text.matchAll(/\b(\d(?:\.\d{1,2})?)\s*L\b/g)) result.add(Number(match[1]).toFixed(2));
  if (/^\d(?:\.\d{1,2})?$/.test(text)) result.add(Number(text).toFixed(2));
  return [...result];
}

export function splitModelNames(value) {
  return [...new Set(cleanText(value).split(/\s+\/\s+|[,;]+/).map(normalKey).filter(Boolean))];
}

export function prepareVehicleForMatching(vehicle) {
  return {
    ...vehicle,
    make_key: vehicle.make_key || normalKey(vehicle.make),
    model_key: vehicle.model_key || normalKey(vehicle.model),
    chassis_keys: expandCodeField(vehicle.chassis_raw || vehicle.chassis_code || ""),
    body_style: vehicle.body_style || inferBodyStyle(vehicle.body_raw || vehicle.body || ""),
    engine_keys: extractEngineCodes(vehicle.engine_code || vehicle.engine || ""),
    drivetrains: extractDrivetrains(`${vehicle.body_raw || ""} ${vehicle.engine_code || ""}`),
    fuels: extractFuelTypes(vehicle.engine_code || vehicle.engine || ""),
    displacements: extractDisplacements(vehicle.engine_code || vehicle.engine || "")
  };
}

export function matchBatteryRow(vehicleInput, source) {
  const vehicle = prepareVehicleForMatching(vehicleInput);
  const reasons = [];
  if (vehicle.make_key !== normalKey(source.make)) return noMatch("make_mismatch");

  const sourceChassis = expandCodeField(source.chassis_code);
  const chassisMatch = intersects(vehicle.chassis_keys, sourceChassis);
  if (!sourceChassis.length) return noMatch("source_chassis_missing");
  if (!chassisMatch) return noMatch("chassis_mismatch");
  reasons.push("exact_chassis");
  return publishMatch("battery_exact_chassis", reasons, 1);
}

export function matchFilterRow(vehicleInput, source) {
  const vehicle = prepareVehicleForMatching(vehicleInput);
  const reasons = [];
  if (vehicle.make_key !== normalKey(source.make)) return noMatch("make_mismatch");

  const sourceEngines = extractEngineCodes(source.engine_code);
  if (!sourceEngines.length || !vehicle.engine_keys.length) return noMatch("engine_evidence_missing");
  if (!intersects(vehicle.engine_keys, sourceEngines)) return noMatch("engine_mismatch");
  reasons.push("exact_engine");
  return publishMatch("filter_exact_engine", reasons, 1);
}

export function assessWiperRows(vehicleInput, sourceRows) {
  const vehicle = prepareVehicleForMatching(vehicleInput);
  const candidates = sourceRows.filter((row) => {
    if (vehicle.make_key !== normalKey(row.make)) return false;
    if (!splitModelNames(row.model).includes(vehicle.model_key)) return false;
    return yearsOverlap(vehicle.year_start, vehicle.year_end, row.year_start, row.year_end);
  });
  const valid = candidates.filter(validWiperRow);
  if (!valid.length) return { status: "none", reason: "no_valid_wiper_source", candidates: [] };
  const byConfig = new Map();
  for (const row of valid) {
    const key = wiperConfigurationKey(row);
    if (!byConfig.has(key)) byConfig.set(key, []);
    byConfig.get(key).push(row);
  }
  if (byConfig.size !== 1) {
    return { status: "review", reason: "multiple_wiper_configurations_body_or_year_required", candidates: valid, configuration_keys: [...byConfig.keys()] };
  }
  const [configurationKey, evidenceRows] = [...byConfig.entries()][0];
  return {
    status: "published",
    reason: "wiper_unique_configuration_make_model_year",
    confidence: 0.95,
    configuration_key: configurationKey,
    evidence_rows: evidenceRows
  };
}

export function validWiperRow(row) {
  const driver = Number(row.driver_length_in);
  const passenger = Number(row.passenger_length_in);
  const rear = row.rear_length_in === null || row.rear_length_in === undefined || row.rear_length_in === "" ? null : Number(row.rear_length_in);
  return APPROVED_FRONT_WIPER_LENGTHS.has(driver)
    && APPROVED_FRONT_WIPER_LENGTHS.has(passenger)
    && (rear === null || APPROVED_REAR_WIPER_LENGTHS.has(rear));
}

export function wiperConfigurationKey(row) {
  const rear = row.rear_length_in === null || row.rear_length_in === undefined || row.rear_length_in === "" ? "-" : Number(row.rear_length_in);
  return `${Number(row.driver_length_in)}/${Number(row.passenger_length_in)}/${rear}`;
}

function intersects(left, right) {
  const rightSet = new Set(right);
  return left.some((value) => rightSet.has(value));
}

function noMatch(reason) {
  return { status: "none", reason, reasons: [] };
}

function reviewMatch(reason, reasons) {
  return { status: "review", reason, reasons, confidence: 0.7 };
}

function publishMatch(rule, reasons, confidence) {
  return { status: "published", rule, reasons, confidence };
}
