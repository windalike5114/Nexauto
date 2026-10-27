const SIMPLE_CONFIGURATION = /^(\d{1,2})\/(\d{1,2}|-)\/(\d{1,2}|-)$/;
const SPLIT_PREFIX = /^拆分\s*[:：]\s*/;
const PENDING_VALUE = /^(?:待核|无法判断|-\/-\/-)$/;
const REQUIRED_REVIEW_FIELDS = ["审核结论", "最终配置", "审核置信度", "审核理由", "审核证据", "审核AI", "审核时间"];

export function prepareCollapsibleSplitDecisions(rows, selectedConfidences = new Set(["高", "中", "低"])) {
  const selectedConfidenceRows = rows.filter((row) =>
    selectedConfidences.has(text(row["审核置信度"])) && text(row["审核结论"]) === "拆分Application"
  );
  const decisions = [];
  const skipped = [];

  for (const row of selectedConfidenceRows) {
    const parsed = parseSplitConfiguration(row["最终配置"]);
    const reasons = [];
    const seriesCode = text(row["底盘/Series代码"]);
    if (!REQUIRED_REVIEW_FIELDS.every((field) => text(row[field]))) reasons.push("incomplete_review_output");
    if (!parsed) reasons.push("invalid_split_configuration");
    else if (parsed.configurationKeys.length === 0) reasons.push("split_has_no_confirmed_configuration");
    else if (parsed.configurationKeys.length > 1) reasons.push("split_has_multiple_configurations");
    if (!isConcreteSeriesCode(seriesCode)) reasons.push("missing_or_generic_series_code");
    if (!text(row.application_id)) reasons.push("missing_application_id");
    if (reasons.length) {
      skipped.push({
        reviewId: text(row["审核ID"]),
        applicationId: text(row.application_id),
        seriesCode,
        finalConfiguration: text(row["最终配置"]),
        reasons
      });
      continue;
    }

    const configuration = parsed.configurations[0];
    decisions.push({
      reviewId: text(row["审核ID"]),
      applicationId: text(row.application_id),
      conclusion: text(row["审核结论"]),
      configurationKey: configuration.key,
      driverLengthIn: configuration.driver,
      passengerLengthIn: configuration.passenger,
      rearLengthIn: configuration.rear,
      reason: text(row["审核理由"]),
      evidence: text(row["审核证据"]),
      reviewer: text(row["审核AI"]),
      reviewedAt: text(row["审核时间"]),
      confidence: text(row["审核置信度"]),
      problemType: text(row["问题类型"]),
      currentAtReview: text(row["现网配置"]),
      wiperTechRecommended: text(row["WiperTech建议配置"]),
      seriesCode,
      seriesName: text(row["Series名称"]),
      bodyStyle: text(row["车身"]),
      make: text(row["品牌"]),
      model: text(row["车型"]),
      segmentedConfiguration: text(row["最终配置"]),
      knownSegments: parsed.knownSegments,
      pendingSegments: parsed.pendingSegments,
      collapseRule: "one_unique_reviewed_configuration_across_known_segments_then_extend_exact_nexauto_series"
    });
  }

  const duplicates = [...groupBy(decisions, (row) => row.applicationId).entries()].filter(([, values]) => values.length > 1);
  if (duplicates.length) throw new Error(`Found ${duplicates.length} duplicate collapsible split decisions.`);
  return { selectedConfidenceRows, selectedConfidences: [...selectedConfidences], decisions, skipped };
}

export function parseSplitConfiguration(value) {
  const raw = text(value);
  if (!SPLIT_PREFIX.test(raw)) return null;
  const parts = raw.replace(SPLIT_PREFIX, "").split(/[；;]/).map(text).filter(Boolean);
  if (!parts.length) return null;
  const knownSegments = [];
  const pendingSegments = [];
  const configurationsByKey = new Map();

  for (const part of parts) {
    const separator = part.indexOf("=");
    if (separator < 1) return null;
    const label = text(part.slice(0, separator));
    const result = text(part.slice(separator + 1));
    const years = parseYearRange(label);
    if (!years) return null;
    const configuration = parseConfiguration(result);
    if (configuration) {
      configurationsByKey.set(configuration.key, configuration);
      knownSegments.push({ ...years, label, configurationKey: configuration.key });
    } else if (PENDING_VALUE.test(result)) {
      pendingSegments.push({ ...years, label, result });
    } else {
      return null;
    }
  }

  return {
    configurations: [...configurationsByKey.values()],
    configurationKeys: [...configurationsByKey.keys()],
    knownSegments,
    pendingSegments
  };
}

export function analyzeDecisionYears(decision, currentYears) {
  const years = [...new Set(currentYears.map(Number).filter(Number.isInteger))].sort((a, b) => a - b);
  const confirmedYears = years.filter((year) => decision.knownSegments.some((segment) => year >= segment.from && year <= segment.to));
  const pendingYears = years.filter((year) => decision.pendingSegments.some((segment) => year >= segment.from && year <= segment.to));
  const confirmed = new Set(confirmedYears);
  const inferredYears = years.filter((year) => !confirmed.has(year));
  return { currentYears: years, confirmedYears, pendingYears, inferredYears };
}

export function parseConfiguration(value) {
  const match = text(value).match(SIMPLE_CONFIGURATION);
  if (!match) return null;
  const driver = Number(match[1]);
  const passenger = match[2] === "-" ? null : Number(match[2]);
  const rear = match[3] === "-" ? null : Number(match[3]);
  if (![driver, passenger, rear].filter((item) => item !== null).every((item) => Number.isInteger(item) && item >= 5 && item <= 40)) return null;
  return { driver, passenger, rear, key: `${driver}/${passenger ?? "-"}/${rear ?? "-"}` };
}

function parseYearRange(value) {
  const match = text(value).match(/(19\d{2}|20\d{2})(?:\s*[-–—至]\s*(19\d{2}|20\d{2}))?/);
  if (!match) return null;
  const from = Number(match[1]);
  const to = Number(match[2] ?? match[1]);
  if (to < from) return null;
  return { from, to };
}

function isConcreteSeriesCode(value) {
  const normalized = text(value);
  if (!normalized) return false;
  if (/^(?:-|unknown|n\/?a|未提供|未知)$/i.test(normalized)) return false;
  if (/^_.*_$/.test(normalized)) return false;
  return true;
}

function text(value) { return String(value ?? "").trim(); }
function groupBy(rows, keyFn) { const output = new Map(); for (const row of rows) { const key = keyFn(row); const values = output.get(key) ?? []; values.push(row); output.set(key, values); } return output; }
