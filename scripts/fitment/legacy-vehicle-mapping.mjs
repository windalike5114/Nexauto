import {
  extractChassisCodes,
  inferBodyStyles,
  normalizeCatalogKey,
  normalizeCatalogText
} from "./vehicle-catalog-normalization.mjs";
import { canonicalMakeKey, matchWiperObservation } from "./vehicle-wiper-matcher.mjs";

export function mapLegacyApplication(application, canonicalRows, canonicalApplicationByKey) {
  const make = normalizeCatalogText(application.make);
  const rawModel = normalizeCatalogText(application.model);
  const model = resolveCanonicalModelName(make, rawModel, canonicalRows);
  const detail = buildLegacyDetail(rawModel, model, application.start_raw, application.end_raw);
  const reasons = [];

  if (!model) reasons.push("No safe canonical model name match.");
  if (!application.year_start) reasons.push("Missing production start year.");
  if (!application.driver_length_in || !application.passenger_length_in) reasons.push("Missing required front wiper lengths.");

  const observation = {
    parse_status: reasons.length ? "review" : "accepted",
    normalized_values: {
      make,
      make_key: normalizeCatalogKey(make),
      model: model ?? rawModel,
      model_key: normalizeCatalogKey(model ?? rawModel),
      detail,
      year_start: application.year_start,
      month_start: application.month_start,
      year_end: application.year_end,
      month_end: application.month_end,
      open_ended: !application.year_end,
      body_styles: inferBodyStyles(`${rawModel} ${detail}`),
      chassis_codes: extractChassisCodes(detail),
      driver_length_in: application.driver_length_in,
      passenger_length_in: application.passenger_length_in,
      rear_length_in: application.rear_length_in
    }
  };
  const match = matchWiperObservation(observation, canonicalRows);
  const target = match.suggested_target;
  const targetKey = target ? `${target.row_number}:${target.application_mapping_index ?? 0}` : null;
  const vehicleApplicationId = targetKey ? canonicalApplicationByKey.get(targetKey) ?? null : null;
  const status = match.status === "matched" && vehicleApplicationId ? "matched" : match.status === "matched" ? "review" : match.status;

  return {
    legacy_vehicle_application_id: application.id,
    legacy_model_id: application.model_id,
    make,
    legacy_model: rawModel,
    year_start: application.year_start,
    year_end: application.year_end,
    wiper_configuration: [application.driver_length_in, application.passenger_length_in, application.rear_length_in],
    extracted_chassis_codes: observation.normalized_values.chassis_codes,
    extracted_body_styles: observation.normalized_values.body_styles,
    status,
    canonical_model: model,
    vehicle_fitment_application_id: vehicleApplicationId,
    confidence: status === "matched" ? 0.95 : null,
    reasons: [...new Set([...reasons, ...(match.reasons ?? []), ...(match.status === "matched" && !vehicleApplicationId
      ? ["Canonical application mapping is missing."]
      : [])])],
    match
  };
}

export function resolveCanonicalModelName(make, rawModel, canonicalRows) {
  const makeKey = canonicalMakeKey(normalizeCatalogKey(make));
  const models = [...new Map(canonicalRows
    .filter((row) => canonicalMakeKey(row.make_key) === makeKey)
    .map((row) => [row.model_key, row.model]))
    .entries()]
    .map(([key, name]) => ({ key, name }));
  const rawKey = normalizeCatalogKey(rawModel);
  const exact = models.find((model) => model.key === rawKey);
  if (exact) return exact.name;

  const candidates = models
    .filter((model) => rawKey.startsWith(`${model.key} `))
    .sort((left, right) => right.key.length - left.key.length);
  for (const candidate of candidates) {
    const suffix = normalizeCatalogText(rawModel).slice(candidate.name.length).trim();
    if (isSafeVersionSuffix(suffix)) return candidate.name;
  }
  return null;
}

export function isSafeVersionSuffix(value) {
  const suffix = normalizeCatalogText(value);
  if (!suffix) return false;
  if (/^[–—-]\s*\S/.test(suffix)) return true;

  const bodyPattern = /\b(sedan|saloon|wagon|estate|hatch|hatchback|liftback|ute|utility|van|coupe|convertible|cab|suv|pickup|roadster)\b/gi;
  const withoutBodies = suffix.replace(bodyPattern, " ").replace(/\b(series|mk)\b/gi, " ");
  const tokens = withoutBodies.split(/[\s,()/–—-]+/).filter(Boolean);
  const isCode = (token) => /^(?:[A-Z]{1,3}|(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]{2,})$/.test(token);
  return (withoutBodies !== suffix || tokens.some(isCode)) && tokens.every(isCode);
}

function buildLegacyDetail(rawModel, canonicalModel, ...rawRanges) {
  const suffix = canonicalModel && rawModel.toLowerCase().startsWith(canonicalModel.toLowerCase())
    ? rawModel.slice(canonicalModel.length).replace(/^\s*[–—-]\s*/, "").trim()
    : rawModel;
  return normalizeCatalogText([suffix, ...rawRanges].filter(Boolean).join(" "));
}
