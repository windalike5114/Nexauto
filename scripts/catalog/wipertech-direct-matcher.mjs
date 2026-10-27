import { normalKey } from "./enrich-wipertech-fitments.mjs";

export const APPROVED_FRONT_WIPER_LENGTHS = new Set([12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 26, 27, 28, 30]);
export const APPROVED_REAR_WIPER_LENGTHS = new Set([8, 10, 11, 12, 13, 14, 15, 16]);
export const MIN_SOURCE_WIPER_LENGTH_IN = 5;
export const MAX_SOURCE_WIPER_LENGTH_IN = 40;

const MODEL_ALIASES = new Map([
  ["mercedesbenz|sprinter35t", "mercedesbenz|sprinter"]
]);

const BODY_ALIASES = new Map([
  ["sport utility vehicle", "suv"], ["station wagon", "wagon"], ["estate", "wagon"],
  ["hatch", "hatchback"], ["liftback", "hatchback"], ["saloon", "sedan"],
  ["crew cab pickup", "ute"], ["double cab pickup", "ute"], ["pickup", "ute"],
  ["panel van", "van"], ["cargo van", "van"], ["minivan", "van"]
]);

export function canonicalModelKey(make, model) {
  // Spaces, punctuation and market typography are not model identity:
  // TOWN ACE=TOWNACE, F-150=F150, ID.4=ID4. Make remains part of the key.
  const makeKey = compactIdentity(make);
  let modelKey = compactIdentity(model);
  if (makeKey === "bmw") modelKey = modelKey.replace(/series/g, "");
  if (makeKey === "mercedesbenz") modelKey = modelKey.replace(/class/g, "");
  const key = `${makeKey}|${modelKey}`;
  return MODEL_ALIASES.get(key) ?? key;
}

export function wiperTechFrontKey(record) {
  const driver = Number(record.positions?.driver?.sizeInch);
  const passenger = Number(record.positions?.passenger?.sizeInch);
  if (!APPROVED_FRONT_WIPER_LENGTHS.has(driver) || !APPROVED_FRONT_WIPER_LENGTHS.has(passenger)) return null;
  return `${driver}/${passenger}`;
}

export function resolveWiperTechApplication(application, sourceRows) {
  const years = uniqueNumbers(application.years).sort((a, b) => a - b);
  if (!years.length) return reviewDecision("missing_application_years", []);

  const modelKey = canonicalModelKey(application.make, application.model);
  const base = sourceRows.filter((row) => canonicalModelKey(row.make, row.model) === modelKey && wiperTechFrontKey(row));
  if (!base.length) return reviewDecision("no_make_model_source", []);

  const chassisDecision = authoritativeSeriesDecision(application, base, false);
  if (chassisDecision) return chassisDecision;

  const yearCandidates = candidatesByYear(years, base);
  const missingYears = years.filter((year) => !yearCandidates.get(year)?.length);
  if (missingYears.length) return reviewDecision("incomplete_year_coverage", base, {
    missingYears,
    candidateFrontKeys: uniqueStrings(base.map(wiperTechFrontKey)),
    candidateVehicleIds: uniqueStrings(base.map((row) => row.vehicleId))
  });

  const direct = uniqueFrontDecision(years, yearCandidates, "unique_make_model_year");
  if (direct) return direct;

  const fullRangeGroups = groupBy(base, wiperTechFrontKey);
  const fullRangeDecisions = [...fullRangeGroups.values()]
    .map((rows) => completeUniqueDecision(years, rows, "single_configuration_covers_full_application_range"))
    .filter(Boolean);
  if (fullRangeDecisions.length === 1) return fullRangeDecisions[0];

  const appSeries = seriesTokens(`${application.seriesCode ?? ""} ${application.seriesName ?? ""}`);
  if (appSeries.size) {
    const seriesRows = base.filter((row) => seriesTokensMatch(appSeries, seriesTokens(row.series)));
    const seriesDecision = completeUniqueDecision(years, seriesRows, "exact_series_full_year_coverage");
    if (seriesDecision) return seriesDecision;
  }

  const body = bodyKey(application.bodyStyle ?? application.variantName);
  if (body) {
    const bodyRows = base.filter((row) => bodyKey(row.body) === body);
    const bodyDecision = completeUniqueDecision(years, bodyRows, "exact_body_full_year_coverage");
    if (bodyDecision) return bodyDecision;
  }

  const currentFrontKey = application.currentFrontKey ?? null;
  if (currentFrontKey) {
    const corroboratingRows = base.filter((row) => wiperTechFrontKey(row) === currentFrontKey);
    const corroborated = completeUniqueDecision(years, corroboratingRows, "existing_published_configuration_corroborated");
    if (corroborated) return corroborated;
  }

  return reviewDecision("multiple_front_configurations", base, {
    candidateFrontKeys: uniqueStrings(base.map(wiperTechFrontKey)),
    candidateVehicleIds: uniqueStrings(base.map((row) => row.vehicleId))
  });
}

export function resolveWiperTechPartialApplication(application, sourceRows) {
  const years = uniqueNumbers(application.years).sort((a, b) => a - b);
  if (!years.length) return reviewDecision("missing_application_years", []);

  const modelKey = canonicalModelKey(application.make, application.model);
  const modelRows = sourceRows.filter((row) => canonicalModelKey(row.make, row.model) === modelKey && wiperTechPartialKey(row));
  if (!modelRows.length) return reviewDecision("no_make_model_source", []);
  const frontRows = modelRows.filter(wiperTechPartialFrontKey);
  if (!frontRows.length) return resolveRearOnlyApplication(years, modelRows);

  const chassisDecision = authoritativeSeriesDecision(application, frontRows, true);
  if (chassisDecision) return chassisDecision;

  const yearCandidates = candidatesByYear(years, frontRows);
  const missingYears = years.filter((year) => !yearCandidates.get(year)?.length);
  if (missingYears.length) return reviewDecision("incomplete_year_coverage", frontRows, {
    missingYears,
    candidateConfigurationKeys: uniqueStrings(frontRows.map(wiperTechPartialKey)),
    candidateVehicleIds: uniqueStrings(frontRows.map((row) => row.vehicleId))
  });

  const direct = uniqueFrontWithIndependentRearDecision(years, yearCandidates, "unique_make_model_year");
  if (direct) return direct;

  const fullRangeGroups = groupBy(frontRows, wiperTechPartialFrontKey);
  const fullRangeDecisions = [...fullRangeGroups.values()]
    .map((rows) => completeUniqueFrontDecision(years, rows, "single_front_configuration_covers_full_application_range"))
    .filter(Boolean);
  if (fullRangeDecisions.length === 1) return fullRangeDecisions[0];

  const appSeries = seriesTokens(`${application.seriesCode ?? ""} ${application.seriesName ?? ""}`);
  if (appSeries.size) {
    const seriesRows = frontRows.filter((row) => seriesTokensMatch(appSeries, seriesTokens(row.series)));
    const seriesDecision = completeUniqueFrontDecision(years, seriesRows, "exact_series_full_year_coverage");
    if (seriesDecision) return seriesDecision;
  }

  const body = bodyKey(application.bodyStyle ?? application.variantName);
  if (body) {
    const bodyRows = frontRows.filter((row) => bodyKey(row.body) === body);
    const bodyDecision = completeUniqueFrontDecision(years, bodyRows, "exact_body_full_year_coverage");
    if (bodyDecision) return bodyDecision;
  }

  return reviewDecision("multiple_wipertech_configurations", frontRows, {
    candidateConfigurationKeys: uniqueStrings(frontRows.map(wiperTechPartialKey)),
    candidateVehicleIds: uniqueStrings(frontRows.map((row) => row.vehicleId))
  });
}

export function isValidSourceWiperLength(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= MIN_SOURCE_WIPER_LENGTH_IN && number <= MAX_SOURCE_WIPER_LENGTH_IN;
}

export function wiperTechPartialKey(record) {
  const driver = sourceLengthOrNull(record.positions?.driver?.sizeInch);
  const passenger = sourceLengthOrNull(record.positions?.passenger?.sizeInch);
  const rear = sourceLengthOrNull(record.positions?.rear?.sizeInch);
  if (driver === null && passenger === null && rear === null) return null;
  return `${driver ?? "-"}/${passenger ?? "-"}/${rear ?? "-"}`;
}

export function wiperTechPartialFrontKey(record) {
  const driver = sourceLengthOrNull(record.positions?.driver?.sizeInch);
  const passenger = sourceLengthOrNull(record.positions?.passenger?.sizeInch);
  if (driver === null && passenger === null) return null;
  return `${driver ?? "-"}/${passenger ?? "-"}`;
}

function authoritativeSeriesDecision(application, rows, allowPartial) {
  const appSeries = seriesTokens(`${application.seriesCode ?? ""} ${application.seriesName ?? ""}`);
  if (!appSeries.size) return null;
  const matchingRows = rows.filter((row) => seriesTokensMatch(appSeries, seriesTokens(row.series)));
  if (!matchingRows.length) return null;
  return allowPartial
    ? uniqueFrontAcrossRows(matchingRows, "authoritative_series_all_catalog_years")
    : uniqueCompleteFrontAcrossRows(matchingRows, "authoritative_series_all_catalog_years");
}

function uniqueFrontAcrossRows(rows, rule) {
  const supportingRows = uniqueRows(rows);
  const frontKeys = uniqueStrings(supportingRows.map(wiperTechPartialFrontKey));
  if (frontKeys.length !== 1) return null;
  const [driverLengthIn, passengerLengthIn] = frontKeys[0].split("/").map((value) => value === "-" ? null : Number(value));
  const rearValues = uniqueNumbers(supportingRows.map((row) => sourceLengthOrNull(row.positions?.rear?.sizeInch)).filter((value) => value !== null));
  const rearLengthIn = rearValues.length === 1 ? rearValues[0] : null;
  return {
    status: "published",
    rule,
    confidence: 0.995,
    frontKey: frontKeys[0],
    configurationKey: `${frontKeys[0]}/${rearLengthIn ?? "-"}`,
    driverLengthIn,
    passengerLengthIn,
    rearLengthIn,
    rearResolution: rearValues.length === 0 ? "missing" : rearValues.length === 1 ? "unique" : "ambiguous_omitted",
    sourceVehicleIds: uniqueStrings(supportingRows.map((row) => row.vehicleId)),
    supportingRows
  };
}

function uniqueCompleteFrontAcrossRows(rows, rule) {
  const supportingRows = uniqueRows(rows);
  const frontKeys = uniqueStrings(supportingRows.map(wiperTechFrontKey));
  if (frontKeys.length !== 1) return null;
  const [driverLengthIn, passengerLengthIn] = frontKeys[0].split("/").map(Number);
  const rearValues = uniqueNumbers(supportingRows.map((row) => row.positions?.rear?.sizeInch)
    .filter((value) => value !== null && value !== undefined && value !== ""));
  const rearLengthIn = rearValues.length === 1 && APPROVED_REAR_WIPER_LENGTHS.has(rearValues[0]) ? rearValues[0] : null;
  return {
    status: "published",
    rule,
    confidence: 0.995,
    frontKey: frontKeys[0],
    configurationKey: `${frontKeys[0]}/${rearLengthIn ?? "-"}`,
    driverLengthIn,
    passengerLengthIn,
    rearLengthIn,
    sourceVehicleIds: uniqueStrings(supportingRows.map((row) => row.vehicleId)),
    supportingRows
  };
}

function resolveRearOnlyApplication(years, rows) {
  const yearCandidates = candidatesByYear(years, rows);
  const missingYears = years.filter((year) => !yearCandidates.get(year)?.length);
  if (missingYears.length) return reviewDecision("incomplete_year_coverage", rows, {
    missingYears,
    candidateConfigurationKeys: uniqueStrings(rows.map(wiperTechPartialKey)),
    candidateVehicleIds: uniqueStrings(rows.map((row) => row.vehicleId))
  });
  return uniquePartialDecision(years, yearCandidates, "unique_rear_only_make_model_year")
    ?? reviewDecision("multiple_wipertech_configurations", rows, {
      candidateConfigurationKeys: uniqueStrings(rows.map(wiperTechPartialKey)),
      candidateVehicleIds: uniqueStrings(rows.map((row) => row.vehicleId))
    });
}

function completeUniqueFrontDecision(years, rows, rule) {
  if (!rows.length) return null;
  const byYear = candidatesByYear(years, rows);
  if (years.some((year) => !byYear.get(year)?.length)) return null;
  return uniqueFrontWithIndependentRearDecision(years, byYear, rule);
}

function uniqueFrontWithIndependentRearDecision(years, byYear, rule) {
  const supportingRows = uniqueRows(years.flatMap((year) => byYear.get(year) ?? []));
  const frontKeys = uniqueStrings(supportingRows.map(wiperTechPartialFrontKey));
  if (frontKeys.length !== 1) return null;
  const [driverLengthIn, passengerLengthIn] = frontKeys[0].split("/").map((value) => value === "-" ? null : Number(value));
  const rearValues = uniqueNumbers(supportingRows.map((row) => sourceLengthOrNull(row.positions?.rear?.sizeInch)).filter((value) => value !== null));
  const rearLengthIn = rearValues.length === 1 ? rearValues[0] : null;
  return {
    status: "published",
    rule,
    confidence: rule === "unique_make_model_year" || rule === "exact_series_full_year_coverage" ? 0.99 : 0.97,
    frontKey: frontKeys[0],
    configurationKey: `${frontKeys[0]}/${rearLengthIn ?? "-"}`,
    driverLengthIn,
    passengerLengthIn,
    rearLengthIn,
    rearResolution: rearValues.length === 0 ? "missing" : rearValues.length === 1 ? "unique" : "ambiguous_omitted",
    sourceVehicleIds: uniqueStrings(supportingRows.map((row) => row.vehicleId)),
    supportingRows
  };
}

function completeUniquePartialDecision(years, rows, rule) {
  if (!rows.length) return null;
  const byYear = candidatesByYear(years, rows);
  if (years.some((year) => !byYear.get(year)?.length)) return null;
  return uniquePartialDecision(years, byYear, rule);
}

function uniquePartialDecision(years, byYear, rule) {
  const supportingRows = uniqueRows(years.flatMap((year) => byYear.get(year) ?? []));
  const configurationKeys = uniqueStrings(supportingRows.map(wiperTechPartialKey));
  if (configurationKeys.length !== 1) return null;
  const [driverLengthIn, passengerLengthIn, rearLengthIn] = configurationKeys[0].split("/").map((value) => value === "-" ? null : Number(value));
  return {
    status: "published",
    rule,
    confidence: rule === "unique_make_model_year" || rule === "exact_series_full_year_coverage" ? 0.99 : 0.97,
    frontKey: `${driverLengthIn ?? "-"}/${passengerLengthIn ?? "-"}`,
    configurationKey: configurationKeys[0],
    driverLengthIn,
    passengerLengthIn,
    rearLengthIn,
    sourceVehicleIds: uniqueStrings(supportingRows.map((row) => row.vehicleId)),
    supportingRows
  };
}

function completeUniqueDecision(years, rows, rule) {
  if (!rows.length) return null;
  const byYear = candidatesByYear(years, rows);
  if (years.some((year) => !byYear.get(year)?.length)) return null;
  return uniqueFrontDecision(years, byYear, rule);
}

function uniqueFrontDecision(years, byYear, rule) {
  const supportingRows = uniqueRows(years.flatMap((year) => byYear.get(year) ?? []));
  const frontKeys = uniqueStrings(supportingRows.map(wiperTechFrontKey));
  if (frontKeys.length !== 1) return null;
  const [driverLengthIn, passengerLengthIn] = frontKeys[0].split("/").map(Number);
  const rearValues = uniqueNumbers(supportingRows.map((row) => row.positions?.rear?.sizeInch)
    .filter((value) => value !== null && value !== undefined && value !== ""));
  const rearLengthIn = rearValues.length === 1 && APPROVED_REAR_WIPER_LENGTHS.has(rearValues[0]) ? rearValues[0] : null;
  return {
    status: "published",
    rule,
    confidence: rule === "unique_make_model_year" || rule === "exact_series_full_year_coverage" ? 0.99 : 0.97,
    frontKey: frontKeys[0],
    configurationKey: `${frontKeys[0]}/${rearLengthIn ?? "-"}`,
    driverLengthIn,
    passengerLengthIn,
    rearLengthIn,
    sourceVehicleIds: uniqueStrings(supportingRows.map((row) => row.vehicleId)),
    supportingRows
  };
}

function candidatesByYear(years, rows) {
  return new Map(years.map((year) => [year, rows.filter((row) => coversYear(row, year))]));
}

function coversYear(row, year) {
  const start = Number(row.yearStart);
  const end = row.yearEnd === null || row.yearEnd === undefined || Number(row.yearEnd) >= 3000 ? 9999 : Number(row.yearEnd);
  return Number.isFinite(start) && start <= year && year <= end;
}

function seriesTokens(value) {
  const tokens = normalKey(value).split(" ").map((token) => token.replace(/[^a-z0-9]/g, ""))
    .filter((token) => token.length >= 2 && /[a-z]/.test(token) && /\d/.test(token));
  return new Set(tokens);
}

function seriesTokensMatch(left, right) {
  for (const leftToken of left) {
    for (const rightToken of right) {
      if (leftToken === rightToken) return true;
      // Detailed chassis codes commonly add engine/market prefixes and suffixes
      // around WiperTech's platform code: E15 -> ZRE152, K13 -> K13K, V35 -> PV35.
      // Requiring at least three characters avoids unsafe A1/B2-style matches.
      if (Math.min(leftToken.length, rightToken.length) >= 3
        && (leftToken.includes(rightToken) || rightToken.includes(leftToken))) return true;
    }
  }
  return false;
}

function bodyKey(value) {
  let key = normalKey(value);
  if (!key) return "";
  for (const [alias, canonical] of BODY_ALIASES) if (key.includes(alias)) return canonical;
  for (const canonical of ["suv", "wagon", "hatchback", "sedan", "ute", "van", "coupe", "convertible", "bus", "truck"])
    if (key.includes(canonical)) return canonical;
  return "";
}

function reviewDecision(reason, candidates, details = {}) {
  return { status: "review", reason, candidates, ...details };
}

function intersects(left, right) { for (const value of left) if (right.has(value)) return true; return false; }
function groupBy(rows, keyFn) { const result = new Map(); for (const row of rows) { const key = keyFn(row); const group = result.get(key) ?? []; group.push(row); result.set(key, group); } return result; }
function uniqueStrings(values) { return [...new Set(values.filter(Boolean).map(String))].sort(); }
function uniqueNumbers(values) { return [...new Set(values.map(Number).filter(Number.isFinite))]; }
function uniqueRows(rows) { return [...new Map(rows.map((row) => [row.vehicleId, row])).values()]; }
function sourceLengthOrNull(value) { return isValidSourceWiperLength(value) ? Number(value) : null; }
function compactIdentity(value) { return normalKey(value).replace(/[^a-z0-9]/g, ""); }
