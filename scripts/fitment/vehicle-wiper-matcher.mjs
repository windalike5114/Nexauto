import { normalizeCatalogKey } from "./vehicle-catalog-normalization.mjs";

export function matchWiperObservation(observation, canonicalRows) {
  if (observation.parse_status !== "accepted") {
    return result("source_review", [], null, ["Source row must be reviewed before vehicle matching."]);
  }

  const source = observation.normalized_values;
  const modelCandidates = canonicalRows.filter((candidate) => (
    canonicalMakeKey(candidate.make_key) === canonicalMakeKey(source.make_key)
    && candidate.model_key === source.model_key
  ));

  if (!modelCandidates.length) {
    return result("unmatched", [], null, ["No canonical make/model match."]);
  }

  const evaluated = modelCandidates.map((candidate) => scoreCandidate(source, candidate));
  const scored = evaluated
    .filter((candidate) => !candidate.blocked)
    .sort((left, right) => right.score - left.score || left.row_number - right.row_number);

  if (!scored.length) {
    return result("review", evaluated, null, [
      ...evaluated.flatMap((candidate) => candidate.reasons),
      "Make/model matched, but year or body-style rules rejected every candidate."
    ]);
  }

  const best = scored[0];
  const next = scored[1];
  const tied = next && next.score === best.score;
  const highConfidence = !tied && (
    (best.signals.chassis_match && ((best.body_styles?.length ?? 0) <= 1 || best.signals.body_match))
    || (!best.signals.chassis_conflict && best.signals.exact_year_range && best.signals.body_match)
    || (!best.signals.chassis_conflict && scored.length === 1 && best.signals.exact_year_range && !best.signals.body_unknown)
  );

  if (highConfidence) {
    return result("matched", scored, best, best.reasons);
  }

  return result("review", scored, best, [
    ...best.reasons,
    tied ? "Top candidates are tied." : "Candidate lacks a unique high-confidence chassis/year/body signature."
  ]);
}

export function canonicalMakeKey(value) {
  const key = normalizeCatalogKey(value);
  const aliases = {
    chery: "cherry",
    fpv: "ford",
    "ford fpv": "ford",
    mercedes: "mercedes benz",
    "mazda eunos": "eunos",
    "range rover": "land rover"
  };
  return aliases[key] ?? key;
}

export function scoreCandidate(source, candidate) {
  const reasons = [];
  const yearOverlap = rangesOverlap(source, candidate);
  if (!yearOverlap) {
    return scoredCandidate(candidate, -1000, true, { year_overlap: false }, ["Production years do not overlap."]);
  }

  const sourceBodies = new Set(source.body_styles ?? []);
  const candidateBodies = new Set(candidate.body_styles ?? []);
  const sourceChassis = new Set((source.chassis_codes ?? []).map(normalizeCatalogKey));
  const candidateChassis = new Set((candidate.chassis_codes ?? []).map(normalizeCatalogKey));
  const bodyKnown = sourceBodies.size > 0 && candidateBodies.size > 0;
  const bodyMatch = bodyKnown && intersects(sourceBodies, candidateBodies);
  const bodyConflict = bodyKnown && !bodyMatch;
  const chassisKnown = sourceChassis.size > 0 && candidateChassis.size > 0;
  const chassisMatch = chassisKnown && intersects(sourceChassis, candidateChassis);
  const exactYearRange = sameRange(source, candidate);

  if (bodyConflict) {
    return scoredCandidate(candidate, -900, true, {
      year_overlap: true,
      body_match: false,
      body_conflict: true,
      chassis_match: chassisMatch,
      exact_year_range: exactYearRange
    }, ["Body-style conflict; Sedan and Hatchback are not auto-merged."]);
  }

  let score = 20;
  reasons.push("Production years overlap.");
  if (exactYearRange) {
    score += 35;
    reasons.push("Production year range is exact.");
  }
  if (chassisMatch) {
    score += 100;
    reasons.push("Chassis code matches.");
  } else if (chassisKnown) {
    score -= 25;
    reasons.push("Both sources provide chassis codes, but they differ.");
  }
  if (bodyMatch) {
    score += 40;
    reasons.push("Body style matches.");
  } else if (!bodyKnown) {
    reasons.push("Body style is unspecified in at least one source.");
  }

  const matchingBodyIndex = (candidate.body_styles ?? []).findIndex((style) => sourceBodies.has(style));
  const applicationMappingIndex = matchingBodyIndex >= 0 ? matchingBodyIndex : 0;

  return scoredCandidate({ ...candidate, application_mapping_index: applicationMappingIndex }, score, false, {
    year_overlap: true,
    exact_year_range: exactYearRange,
    chassis_match: chassisMatch,
    chassis_conflict: chassisKnown && !chassisMatch,
    chassis_unknown: !chassisKnown,
    body_match: bodyMatch,
    body_unknown: !bodyKnown,
    body_conflict: false
  }, reasons);
}

export function rangesOverlap(left, right) {
  if (!left.year_start || !right.year_start) return false;
  const leftEnd = left.open_ended || !left.year_end ? 9999 : left.year_end;
  const rightEnd = right.open_ended || !right.year_end ? 9999 : right.year_end;
  return left.year_start <= rightEnd && right.year_start <= leftEnd;
}

function sameRange(left, right) {
  const leftEnd = left.open_ended ? null : left.year_end;
  const rightEnd = right.open_ended ? null : right.year_end;
  return left.year_start === right.year_start && leftEnd === rightEnd;
}

function intersects(left, right) {
  for (const value of left) {
    if (right.has(value)) return true;
  }
  return false;
}

function scoredCandidate(candidate, score, blocked, signals, reasons) {
  return { ...candidate, score, blocked, signals, reasons };
}

function result(status, candidates, best, reasons) {
  return {
    status,
    candidate_count: candidates.length,
    suggested_target: best ? summarizeCandidate(best) : null,
    candidates: candidates.slice(0, 5).map(summarizeCandidate),
    reasons: [...new Set(reasons)]
  };
}

function summarizeCandidate(candidate) {
  return {
    row_number: candidate.row_number,
    source_make_id: candidate.source_make_id,
    source_model_id: candidate.source_model_id,
    source_variant_id: candidate.source_variant_id,
    application_mapping_index: candidate.application_mapping_index ?? 0,
    make: candidate.make,
    model: candidate.model,
    generation_name: candidate.generation_name,
    year_start: candidate.year_start,
    year_end: candidate.year_end,
    body_styles: candidate.body_styles,
    chassis_codes: candidate.chassis_codes,
    score: candidate.score ?? null,
    signals: candidate.signals ?? null
  };
}
