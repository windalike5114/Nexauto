const BODY_STYLE_RULES = [
  ["cab_chassis", /\bcab\s*chassis\b/i],
  ["convertible", /\b(convertible|cabriolet|roadster|spider)\b/i],
  ["hatchback", /\bhatch(?:back)?\b/i],
  ["sedan", /\b(sedan|saloon)\b/i],
  ["wagon", /\b(wagon|estate|touring)\b/i],
  ["coupe", /\bcoup[eé]\b/i],
  ["minivan", /\b(minivan|mpv)\b/i],
  ["pickup", /\bpick[ -]?up\b/i],
  ["ute", /\bute\b/i],
  ["van", /\bvan\b/i],
  ["suv", /\bsuv\b/i],
  ["bus", /\bbus\b/i]
];

const BODY_STYLE_LABELS = {
  bus: "Bus",
  cab_chassis: "Cab chassis",
  convertible: "Convertible",
  coupe: "Coupe",
  hatchback: "Hatchback",
  minivan: "Minivan",
  pickup: "Pickup",
  sedan: "Sedan",
  suv: "SUV",
  ute: "Ute",
  van: "Van",
  wagon: "Wagon"
};

const CHASSIS_STOP_TOKENS = new Set([
  "DOOR",
  "FACTORY",
  "GEN",
  "HYBRID",
  "MARK",
  "MK",
  "ONLY",
  "SERIES",
  "TYPE",
  "XENON"
]);

export function normalizeCatalogText(value) {
  if (value === null || value === undefined) return "";

  return String(value)
    .normalize("NFKC")
    .replace(/%u2013/gi, "-")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\uFFFD/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeCatalogKey(value) {
  return normalizeCatalogText(value)
    .toLocaleLowerCase("en-NZ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function parseVehicleCatalogRow(input, rowNumber = null) {
  const make = normalizeCatalogText(input.make);
  const model = normalizeCatalogText(input.model);
  const variantDescriptor = normalizeCatalogText(input.variant);
  const sourceMakeId = normalizeCatalogText(input.source_make_id);
  const sourceModelId = normalizeCatalogText(input.source_model_id);
  const sourceVariantId = normalizeCatalogText(input.source_variant_id);
  const notes = [];

  if (!make) notes.push("Missing make.");
  if (!model) notes.push("Missing model.");
  if (!sourceMakeId) notes.push("Missing source make ID.");
  if (!sourceModelId) notes.push("Missing source model ID.");
  if (!variantDescriptor) notes.push("Missing variant descriptor.");
  if (!sourceVariantId) notes.push("Missing source variant ID.");

  const parsedVariant = parseVariantDescriptor(variantDescriptor, `${make} ${model}`);
  notes.push(...parsedVariant.notes);

  const missingParent = !make || !model || !sourceMakeId || !sourceModelId;
  const needsReview = !variantDescriptor || !sourceVariantId || !parsedVariant.date_range.ok;
  const parseStatus = missingParent ? "rejected" : needsReview ? "review" : "accepted";

  return {
    row_number: rowNumber,
    raw_values: {
      make: input.make ?? "",
      model: input.model ?? "",
      variant: input.variant ?? "",
      source_make_id: input.source_make_id ?? "",
      source_model_id: input.source_model_id ?? "",
      source_variant_id: input.source_variant_id ?? ""
    },
    normalized_values: {
      make,
      make_key: normalizeCatalogKey(make),
      model,
      model_key: normalizeCatalogKey(model),
      source_make_id: sourceMakeId,
      source_model_id: sourceModelId,
      source_variant_id: sourceVariantId,
      variant_descriptor: variantDescriptor,
      generation_name: parsedVariant.generation_name,
      generation_key: buildGenerationKey(parsedVariant),
      body_styles: parsedVariant.body_styles,
      variant_names: parsedVariant.variant_names,
      chassis_codes: parsedVariant.chassis_codes,
      year_start: parsedVariant.date_range.year_start,
      month_start: parsedVariant.date_range.month_start,
      year_end: parsedVariant.date_range.year_end,
      month_end: parsedVariant.date_range.month_end,
      open_ended: parsedVariant.date_range.open_ended,
      market: "AU",
      steering_side: "RHD"
    },
    parse_status: parseStatus,
    parse_notes: unique(notes)
  };
}

export function parseVariantDescriptor(value, parentText = "") {
  const raw = normalizeCatalogText(value);
  const notes = [];
  const dateRange = parseCatalogDateRange(raw);

  if (raw && !dateRange.ok) {
    notes.push(`Could not determine production years from variant: ${raw}`);
  }

  const descriptor = dateRange.ok
    ? normalizeCatalogText(`${raw.slice(0, dateRange.index)} ${raw.slice(dateRange.index + dateRange.match[0].length)}`)
    : raw;
  const bodyStyles = inferBodyStyles(`${parentText} ${descriptor}`);
  const chassisCodes = extractChassisCodes(descriptor);
  const rangeLabel = dateRange.ok
    ? `${dateRange.year_start}-${dateRange.open_ended ? "ON" : dateRange.year_end}`
    : "";
  const generationName = stripBodyStyleTerms(descriptor) || rangeLabel;
  const variantNames = bodyStyles.length
    ? bodyStyles.map((style) => BODY_STYLE_LABELS[style])
    : ["Unspecified"];

  return {
    raw,
    descriptor,
    generation_name: generationName,
    body_styles: bodyStyles,
    variant_names: variantNames,
    chassis_codes: chassisCodes,
    date_range: dateRange,
    notes
  };
}

export function parseCatalogDateRange(value) {
  const raw = normalizeCatalogText(value);
  const match = raw.match(/(?:(\d{1,2})\/)?((?:19|20)\d{2})\s*-\s*(?:(?:(\d{1,2})\/)?((?:19|20)\d{2})|(ON))\b/i);

  if (!match) {
    return {
      ok: false,
      match: null,
      index: -1,
      year_start: null,
      month_start: null,
      year_end: null,
      month_end: null,
      open_ended: false
    };
  }

  const monthStart = match[1] ? Number(match[1]) : null;
  const yearStart = Number(match[2]);
  const monthEnd = match[3] ? Number(match[3]) : null;
  const yearEnd = match[4] ? Number(match[4]) : null;
  const openEnded = Boolean(match[5]);
  const validMonths = (
    (monthStart === null || (monthStart >= 1 && monthStart <= 12))
    && (monthEnd === null || (monthEnd >= 1 && monthEnd <= 12))
  );
  const validRange = openEnded || yearEnd >= yearStart;

  return {
    ok: validMonths && validRange,
    match,
    index: match.index,
    year_start: yearStart,
    month_start: monthStart,
    year_end: openEnded ? null : yearEnd,
    month_end: openEnded ? null : monthEnd,
    open_ended: openEnded
  };
}

export function inferBodyStyles(value) {
  const text = normalizeCatalogText(value);
  const styles = [];

  for (const [style, pattern] of BODY_STYLE_RULES) {
    if (pattern.test(text)) styles.push(style);
  }

  // A minivan is a more specific classification than a generic van.
  if (styles.includes("minivan")) {
    return styles.filter((style) => style !== "van");
  }

  return styles;
}

export function extractChassisCodes(value) {
  const descriptor = normalizeCatalogText(value);
  if (!descriptor) return [];

  const tokens = descriptor.match(/[A-Za-z0-9#-]+/g) ?? [];
  const candidates = [];

  for (const rawToken of tokens) {
    const token = rawToken.replace(/^[-#]+|[-#]+$/g, "");
    if (!token) continue;

    const upper = token.toUpperCase();
    if (CHASSIS_STOP_TOKENS.has(upper)) continue;
    if (/^(?:MK|GEN)\d+(?:-\d+)?$/i.test(token)) continue;

    const parts = splitCodeRange(upper);
    for (const part of parts) {
      const hasLetter = /[A-Z]/.test(part);
      const hasDigit = /\d/.test(part);
      const wasUppercase = rawToken === rawToken.toUpperCase();
      const isShortLetterCode = /^[A-Z]{2,4}$/.test(part);

      if (!hasLetter) continue;
      if (part.length > 8) continue;
      if (!(hasDigit || (wasUppercase && isShortLetterCode))) continue;
      candidates.push(part);
    }
  }

  return unique(candidates);
}

function splitCodeRange(value) {
  const match = value.match(/^([A-Z0-9#]{1,8})-([A-Z0-9#]{1,8})$/);
  if (!match) return [value];
  return [match[1], match[2]];
}

function stripBodyStyleTerms(value) {
  let result = normalizeCatalogText(value);

  for (const [, pattern] of BODY_STYLE_RULES) {
    result = result.replace(new RegExp(pattern.source, "gi"), " ");
  }

  return normalizeCatalogText(
    result
      .replace(/\b\d(?:\/\d)?-door\b/gi, " ")
      .replace(/(^|\s)[/&]+(?=\s|$)/g, " ")
      .replace(/^[,;/&\s]+|[,;/&\s]+$/g, " ")
  );
}

function buildGenerationKey(parsedVariant) {
  const range = parsedVariant.date_range;
  return normalizeCatalogKey([
    parsedVariant.generation_name,
    range.year_start ?? "",
    range.month_start ?? "",
    range.open_ended ? "on" : range.year_end ?? "",
    range.month_end ?? ""
  ].join(" "));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
