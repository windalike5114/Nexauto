import crypto from "node:crypto";

const BODY_STYLE_ALIASES = [
  ["cab_chassis", /\bcab\s*chassis\b/i],
  ["convertible", /\b(convertible|cabriolet|roadster|spider)\b/i],
  ["hatchback", /\b(hatch|hatchback)\b/i],
  ["sedan", /\b(sedan|saloon)\b/i],
  ["wagon", /\b(wagon|estate|touring)\b/i],
  ["coupe", /\bcoup[eé]\b/i],
  ["minivan", /\b(minivan|mpv|people mover)\b/i],
  ["pickup", /\bpick[ -]?up\b/i],
  ["ute", /\bute\b/i],
  ["van", /\bvan\b/i],
  ["suv", /\b(suv|crossover)\b/i],
  ["bus", /\bbus\b/i]
];

export const APPROVED_FRONT_WIPER_LENGTHS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 26, 28, 30]);
export const APPROVED_REAR_WIPER_LENGTHS = new Set([8, 10, 11, 12, 13, 14, 15, 16]);

export function cleanText(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .normalize("NFKC")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\uFFFD/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalKey(value) {
  return cleanText(value)
    .toLocaleLowerCase("en-NZ")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function compactPartKey(value) {
  return cleanText(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function slugify(value) {
  return normalKey(value).replace(/\s+/g, "-");
}

export function nullableYear(value) {
  const text = cleanText(value);
  if (!text) return null;
  const year = Number.parseInt(text, 10);
  return Number.isInteger(year) && year >= 1886 && year <= 2100 ? year : null;
}

export function inferBodyStyle(value) {
  const text = cleanText(value);
  for (const [style, pattern] of BODY_STYLE_ALIASES) {
    if (pattern.test(text)) return style;
  }
  return text ? "other" : "unknown";
}

export function splitCodes(value) {
  const text = cleanText(value);
  if (!text) return [];
  return unique(text.split(/\s*[,;|]\s*/).map(cleanText).filter(Boolean));
}

export function splitBatteryRecommendations(value) {
  const text = cleanText(value);
  if (!text) return [];
  return unique(text.split(/\s+\/\s+/).map(cleanText).filter(Boolean));
}

export function parseFilterDetail(value) {
  const text = cleanText(value);
  if (!text) return { supplierPartNumber: "", crossReferences: [] };
  const match = text.match(/^([^()]+?)(?:\s*\(([^)]+)\))?$/);
  if (!match) return { supplierPartNumber: text, crossReferences: [] };
  return {
    supplierPartNumber: cleanText(match[1]),
    crossReferences: match[2] ? splitCodes(match[2]) : []
  };
}

export function parseBatteryCode(value) {
  const code = cleanText(value);
  const upper = code.toUpperCase();
  let technology = "unknown";
  if (/\bAGM\b/.test(upper) || upper.endsWith("AGM")) technology = "AGM";
  else if (/\bEFB\b/.test(upper) || upper.endsWith("EFB")) technology = "EFB";
  else if (/\bMF\b/.test(upper) || upper.endsWith("MF")) technology = "MF";

  let format = "unknown";
  if (upper.startsWith("DIN")) format = "DIN";
  else if (/^(?:NS|N|[0-9]{2,3}[A-Z])/.test(upper)) format = "JIS_or_supplier_code";

  return { code, technology, format };
}

export function parseVehicleRow(row, rowNumber) {
  const sourceVehicleId = cleanText(row[0]);
  const make = cleanText(row[1]);
  const model = cleanText(row[2]);
  const chassisRaw = cleanText(row[3]);
  const bodyRaw = cleanText(row[4]);
  const engine = cleanText(row[5]);
  const yearStart = nullableYear(row[6]);
  const yearEnd = nullableYear(row[7]);
  const notes = [];

  if (!sourceVehicleId) notes.push("missing_source_vehicle_id");
  if (!make) notes.push("missing_make");
  if (!model) notes.push("missing_model");
  if (!chassisRaw) notes.push("missing_chassis_code");
  if (!yearStart) notes.push("missing_or_invalid_year_start");
  if (yearEnd !== null && yearStart !== null && yearEnd < yearStart) notes.push("invalid_year_range");

  const rejected = !sourceVehicleId || !make || !model || notes.includes("invalid_year_range");
  const status = rejected ? "rejected" : notes.length ? "review" : "accepted";
  const chassisCodes = splitCodes(chassisRaw);
  const rangeLabel = yearStart ? `${yearStart}-${yearEnd ?? "ON"}` : "Year unknown";
  const generationName = [chassisRaw || "Chassis unknown", rangeLabel].join(" · ");
  const bodyStyle = inferBodyStyle(bodyRaw);
  const variantName = [bodyRaw || "Body unknown", engine || "Engine unknown"].join(" · ");

  return {
    row_number: rowNumber,
    source_vehicle_id: sourceVehicleId,
    make,
    make_key: normalKey(make),
    model,
    model_key: normalKey(model),
    chassis_raw: chassisRaw,
    chassis_codes: chassisCodes,
    body_raw: bodyRaw,
    body_style: bodyStyle,
    engine_code: engine || null,
    year_start: yearStart,
    year_end: yearEnd,
    generation_name: generationName,
    generation_key: normalKey(`${chassisRaw || "unknown"} ${rangeLabel}`),
    variant_name: variantName,
    variant_key: normalKey(`${bodyRaw || "unknown"} ${engine || "unknown"}`),
    market: "NZ",
    steering_side: "RHD",
    parse_status: status,
    parse_notes: notes
  };
}

export function validateWiperRow(row, rowNumber) {
  const driver = numericOrNull(row[5]);
  const passenger = numericOrNull(row[7]);
  const rear = numericOrNull(row[9]);
  const notes = [];
  if (driver === null || !APPROVED_FRONT_WIPER_LENGTHS.has(driver)) notes.push("invalid_driver_length");
  if (passenger !== null && !APPROVED_FRONT_WIPER_LENGTHS.has(passenger)) notes.push("invalid_passenger_length");
  if (rear !== null && !APPROVED_REAR_WIPER_LENGTHS.has(rear)) notes.push("invalid_rear_length");
  if (rear === null) notes.push("rear_not_provided_unknown_not_no_rear");
  return {
    row_number: rowNumber,
    make: cleanText(row[0]),
    model: cleanText(row[1]),
    year_range: cleanText(row[2]),
    driver_length_in: driver,
    passenger_length_in: passenger,
    rear_length_in: rear,
    connector_type: cleanText(row[10]),
    parse_status: notes.some((note) => note.startsWith("invalid_")) ? "review" : "accepted",
    parse_notes: notes
  };
}

export function stableHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function numericOrNull(value) {
  const text = cleanText(value);
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}
