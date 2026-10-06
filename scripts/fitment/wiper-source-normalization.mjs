import { normalizeWiperLength } from "./wiper-normalization.mjs";
import {
  extractChassisCodes,
  inferBodyStyles,
  normalizeCatalogKey,
  normalizeCatalogText,
  parseCatalogDateRange
} from "./vehicle-catalog-normalization.mjs";

const MISSING_MARKERS = new Set(["", "-", "—", "–", "n/a", "na", "none", "null"]);

export function parseWiperObservation(input) {
  const make = normalizeCatalogText(input.make);
  const model = normalizeCatalogText(input.model);
  const detail = normalizeCatalogText(input.detail);
  const notes = [...(input.notes ?? [])];
  const dateRange = input.date_range ?? parseCatalogDateRange(input.year_range);
  const driver = normalizeSourceWiperLength(input.driver, "front", input.unit);
  const passenger = normalizeSourceWiperLength(input.passenger, "front", input.unit);
  const rear = normalizeSourceWiperLength(input.rear, "rear", input.unit);

  if (!make) notes.push("Missing make.");
  if (!model) notes.push("Missing model.");
  if (!dateRange.ok) notes.push(`Could not parse year range: ${normalizeCatalogText(input.year_range)}`);
  if (!driver.value) notes.push(driver.issue ?? "Missing driver wiper length.");
  if (!passenger.value) notes.push(passenger.issue ?? "Missing passenger wiper length.");
  if (rear.issue) notes.push(rear.issue);

  const bodyStyles = input.body_styles ?? inferBodyStyles(`${model} ${detail}`);
  const chassisCodes = input.chassis_codes ?? extractChassisCodes(detail);
  const blocking = (
    !make
    || !model
    || !dateRange.ok
    || !driver.value
    || !passenger.value
    || Boolean(driver.issue)
    || Boolean(passenger.issue)
    || Boolean(rear.issue)
  );

  return {
    source_code: input.source_code,
    row_number: input.row_number,
    raw_values: input.raw_values ?? {},
    normalized_values: {
      make,
      make_key: normalizeCatalogKey(make),
      model,
      model_key: normalizeCatalogKey(model),
      detail,
      year_start: dateRange.year_start,
      month_start: dateRange.month_start,
      year_end: dateRange.year_end,
      month_end: dateRange.month_end,
      open_ended: dateRange.open_ended,
      body_styles: bodyStyles,
      chassis_codes: chassisCodes,
      driver_length_in: driver.value,
      passenger_length_in: passenger.value,
      rear_length_in: rear.value,
      rear_status: rear.issue ? "invalid" : rear.value ? "provided" : "missing",
      raw_driver_value: driver.raw,
      raw_passenger_value: passenger.raw,
      raw_rear_value: rear.raw,
      evidence: input.evidence ?? null,
      market: input.market ?? "NZ",
      steering_side: input.steering_side ?? "RHD"
    },
    parse_status: blocking ? "review" : "accepted",
    parse_notes: [...new Set(notes.filter(Boolean))]
  };
}

export function normalizeSourceWiperLength(value, position, unit = "in") {
  const raw = value === null || value === undefined
    ? ""
    : String(value).normalize("NFKC").replace(/\s+/g, " ").trim();
  if (isMissingMarker(raw)) return { value: null, raw, issue: null };

  const normalizedRaw = normalizeCatalogText(raw);
  const valueWithUnit = unit === "mm" && !/(?:mm|毫米)/i.test(normalizedRaw)
    ? `${normalizedRaw}mm`
    : normalizedRaw;
  return normalizeWiperLength(valueWithUnit, position);
}

export function parseSeparateYearFields(startValue, endValue) {
  const start = parseSingleYearField(startValue, false);
  const end = parseSingleYearField(endValue, true);
  const ok = start.ok && end.ok && (end.open_ended || end.year >= start.year);

  return {
    ok,
    match: null,
    index: -1,
    year_start: start.year,
    month_start: start.month,
    year_end: end.open_ended ? null : end.year,
    month_end: end.open_ended ? null : end.month,
    open_ended: end.open_ended
  };
}

export function expandCombinedModels(value) {
  const text = normalizeCatalogText(value);
  if (!text) return [];
  return text.split(/\s*,\s*/).map(normalizeCatalogText).filter(Boolean);
}

function parseSingleYearField(value, allowOpenEnded) {
  const raw = normalizeCatalogText(value);
  if (allowOpenEnded && /^(?:on|present|current)$/i.test(raw)) {
    return { ok: true, year: null, month: null, open_ended: true };
  }

  const fourDigit = raw.match(/^((?:19|20)\d{2})$/);
  if (fourDigit) {
    return { ok: true, year: Number(fourDigit[1]), month: null, open_ended: false };
  }

  const monthYear = raw.match(/^(\d{1,2})\/(\d{2}|(?:19|20)\d{2})$/);
  if (!monthYear) return { ok: false, year: null, month: null, open_ended: false };

  const month = Number(monthYear[1]);
  const numericYear = Number(monthYear[2]);
  const year = monthYear[2].length === 2
    ? numericYear >= 50 ? 1900 + numericYear : 2000 + numericYear
    : numericYear;

  return {
    ok: month >= 1 && month <= 12,
    year,
    month,
    open_ended: false
  };
}

function isMissingMarker(value) {
  return MISSING_MARKERS.has(normalizeCatalogKey(value));
}
