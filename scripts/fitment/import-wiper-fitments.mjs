import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";

const DEFAULT_FILE = "C:\\Users\\Sanli\\Desktop\\CAT078.xlsx";
const SOURCE_NAME = "CAT078";

const args = parseArgs(process.argv.slice(2));
loadEnvFile(path.join(process.cwd(), ".env.local"));
const filePath = path.resolve(args.file ?? DEFAULT_FILE);
const reportOnly = Boolean(args["report-only"]);
const apply = Boolean(args.apply);
const market = String(args.market ?? "NZ").toUpperCase();
const sourceName = String(args.source ?? SOURCE_NAME);

if (!fs.existsSync(filePath)) {
  throw new Error(`Fitment source file not found: ${filePath}`);
}

if (!reportOnly && !apply) {
  throw new Error("Choose --report-only to inspect parsing or --apply to import into Supabase.");
}

const parsed = parseWorkbook(filePath, { market, sourceName });
const report = buildReport(parsed);
const outputDir = path.join(process.cwd(), "tmp");
fs.mkdirSync(outputDir, { recursive: true });
const reportPath = path.join(outputDir, "wiper-fitment-report.json");
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

printReport(report, reportPath);

if (apply) {
  await importToSupabase(parsed, report);
}

function parseWorkbook(inputPath, options) {
  const workbook = XLSX.readFile(inputPath, { cellDates: false, raw: false });
  const sheetName = options.sheet ?? workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  if (!sheet) {
    throw new Error(`Worksheet not found: ${sheetName}`);
  }

  const rawRows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    blankrows: false,
    defval: "",
    raw: false
  });

  let currentMake = "";
  const rows = [];

  rawRows.forEach((row, index) => {
    const rowNumber = index + 1;
    const values = readRow(row);
    const rawValues = {
      a: values[0],
      b: values[1],
      c: values[2],
      d: values[3],
      e: values[4],
      f: values[5],
      g: values[6],
      h: values[7]
    };
    const notes = [];
    const a = cleanText(values[0]);
    const rowTailHasData = values.slice(1).some((value) => cleanText(value) !== "");
    let detectedRowType = "unknown";
    let parseStatus = "skipped";
    let parsedValues = {};

    if (!a && !rowTailHasData) {
      detectedRowType = "empty";
      parseStatus = "skipped";
    } else if (isHeaderRow(values)) {
      detectedRowType = "header";
      parseStatus = "skipped";
    } else if (a && !rowTailHasData) {
      const makeName = normalizeContinuationMake(a);
      currentMake = makeName;
      detectedRowType = isContinuationMake(a) ? "make_continuation" : "make";
      parseStatus = "skipped";
      parsedValues = { make: currentMake };
    } else if (a) {
      detectedRowType = "model_fitment";

      if (!currentMake) {
        parseStatus = "error";
        notes.push("No current make found for model row.");
      } else {
        const start = parseMonthYear(values[1]);
        const end = parseMonthYear(values[2]);
        const driver = chooseLength(values[3], "D", values[5], "F");
        const passenger = chooseLength(values[4], "E", values[6], "G");
        const rear = extractLength(values[7]);

        if (!start.ok) notes.push(`Could not parse start date: ${values[1]}`);
        if (!end.ok) notes.push(`Could not parse end date: ${values[2]}`);
        if (!driver.value && !passenger.value && !rear.value) {
          notes.push("No wiper length values found.");
        }

        parseStatus = notes.length ? "warning" : "ok";
        if (!start.ok || !end.ok) parseStatus = "error";
        if (!driver.value && !passenger.value && !rear.value) parseStatus = "warning";

        parsedValues = {
          market: options.market,
          make: currentMake,
          model: a,
          start,
          end,
          driver_length_in: driver.value,
          driver_length_source: driver.source,
          passenger_length_in: passenger.value,
          passenger_length_source: passenger.source,
          rear_length_in: rear.value,
          rear_length_source: rear.value ? "H" : null
        };
      }
    } else {
      detectedRowType = "pollution";
      parseStatus = "skipped";
      notes.push("Row has data outside column A but no model name.");
    }

    rows.push({
      row_number: rowNumber,
      raw_values: rawValues,
      detected_row_type: detectedRowType,
      parse_status: parseStatus,
      parse_notes: notes,
      parsed_values: parsedValues
    });
  });

  return {
    sourceFile: inputPath,
    sourceName: options.sourceName,
    market: options.market,
    sheetName,
    rows
  };
}

function readRow(row) {
  return Array.from({ length: 8 }, (_, index) => cleanText(row[index]));
}

function cleanText(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function isHeaderRow(values) {
  const a = cleanText(values[0]).toLowerCase();
  const b = cleanText(values[1]).toLowerCase();
  const c = cleanText(values[2]).toLowerCase();

  return (
    a === "make & model" ||
    (b === "start" && c === "finish") ||
    a === "make and model"
  );
}

function isContinuationMake(value) {
  return /\bcont\.?$/i.test(value);
}

function normalizeContinuationMake(value) {
  return cleanText(value).replace(/\s+cont\.?$/i, "");
}

function parseMonthYear(value) {
  const raw = cleanText(value);
  if (!raw) {
    return { ok: false, raw, year: null, month: null, precision: null };
  }

  const yearMatch = raw.match(/^(19|20)\d{2}$/);
  if (yearMatch) {
    return { ok: true, raw, year: Number(raw), month: null, precision: "year" };
  }

  const monthYearMatch = raw.match(/^(\d{1,2})\/(\d{2})$/);
  if (monthYearMatch) {
    const month = Number(monthYearMatch[1]);
    const yy = Number(monthYearMatch[2]);
    const year = yy >= 50 ? 1900 + yy : 2000 + yy;

    return {
      ok: month >= 1 && month <= 12,
      raw,
      year,
      month,
      precision: "month"
    };
  }

  const fallbackYear = raw.match(/(19|20)\d{2}/);
  if (fallbackYear) {
    return { ok: true, raw, year: Number(fallbackYear[0]), month: null, precision: "year" };
  }

  return { ok: false, raw, year: null, month: null, precision: null };
}

function chooseLength(primaryValue, primarySource, fallbackValue, fallbackSource) {
  const primary = extractLength(primaryValue);
  if (primary.value) {
    return { value: primary.value, source: primarySource, raw: primary.raw };
  }

  const fallback = extractLength(fallbackValue);
  if (fallback.value) {
    return { value: fallback.value, source: fallbackSource, raw: fallback.raw };
  }

  return { value: null, source: null, raw: "" };
}

function extractLength(value) {
  const raw = cleanText(value);
  const match = raw.match(/\d+(?:\.\d+)?/);

  if (!match) {
    return { value: null, raw };
  }

  return { value: Number(match[0]), raw };
}

function buildReport(parsed) {
  const counts = {};
  const statusCounts = {};
  const warnings = [];
  const errors = [];
  const okRows = parsed.rows.filter((row) => row.parse_status === "ok" || row.parse_status === "warning");

  for (const row of parsed.rows) {
    counts[row.detected_row_type] = (counts[row.detected_row_type] ?? 0) + 1;
    statusCounts[row.parse_status] = (statusCounts[row.parse_status] ?? 0) + 1;

    if (row.parse_status === "warning") warnings.push(summarizeIssue(row));
    if (row.parse_status === "error") errors.push(summarizeIssue(row));
  }

  return {
    source_name: parsed.sourceName,
    source_file: parsed.sourceFile,
    sheet_name: parsed.sheetName,
    market: parsed.market,
    total_rows: parsed.rows.length,
    counts,
    status_counts: statusCounts,
    importable_rows: okRows.filter(hasAnyLength).length,
    warning_sample: warnings.slice(0, 25),
    error_sample: errors.slice(0, 25)
  };
}

function summarizeIssue(row) {
  return {
    row_number: row.row_number,
    raw_a: row.raw_values.a,
    raw_b: row.raw_values.b,
    raw_c: row.raw_values.c,
    notes: row.parse_notes
  };
}

function hasAnyLength(row) {
  const values = row.parsed_values;

  return Boolean(values.driver_length_in || values.passenger_length_in || values.rear_length_in);
}

function printReport(report, reportPath) {
  console.log(`Fitment report written to ${reportPath}`);
  console.log(`Rows: ${report.total_rows}`);
  console.log(`Importable wiper rows: ${report.importable_rows}`);
  console.log(`Row types: ${JSON.stringify(report.counts)}`);
  console.log(`Statuses: ${JSON.stringify(report.status_counts)}`);

  if (report.warning_sample.length) {
    console.log(`Warnings sample: ${JSON.stringify(report.warning_sample.slice(0, 5))}`);
  }

  if (report.error_sample.length) {
    console.log(`Errors sample: ${JSON.stringify(report.error_sample.slice(0, 5))}`);
  }
}

async function importToSupabase(parsed, report) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }

  const supabase = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  if (args.replace) {
    await replaceExistingSource(supabase, parsed.sourceName);
  }

  const { data: batch, error: batchError } = await supabase
    .from("fitment_import_batches")
    .insert({
      source_name: parsed.sourceName,
      source_file: parsed.sourceFile,
      category_slug: "wiper",
      row_count: parsed.rows.length,
      parsed_count: report.status_counts.ok ?? 0,
      skipped_count: report.status_counts.skipped ?? 0,
      error_count: report.status_counts.error ?? 0,
      metadata: {
        sheet_name: parsed.sheetName,
        market: parsed.market,
        warning_count: report.status_counts.warning ?? 0
      }
    })
    .select("id")
    .single();

  if (batchError) throw batchError;

  const rowsToInsert = parsed.rows.map((row) => ({
    ...row,
    batch_id: batch.id
  }));
  await insertChunks(supabase, "fitment_import_rows", rowsToInsert, 500);

  const importableRows = parsed.rows.filter((row) => (
    (row.parse_status === "ok" || row.parse_status === "warning") && hasAnyLength(row)
  ));

  const makeNames = [...new Set(importableRows.map((row) => row.parsed_values.make))];
  await insertChunks(
    supabase,
    "vehicle_makes",
    makeNames.map((name) => ({ name, normalized_name: normalizeKey(name) })),
    500,
    { onConflict: "normalized_name" }
  );

  const { data: makes, error: makesError } = await supabase
    .from("vehicle_makes")
    .select("id,name,normalized_name")
    .in("normalized_name", makeNames.map(normalizeKey));
  if (makesError) throw makesError;
  const makeByKey = new Map(makes.map((make) => [make.normalized_name, make]));

  const modelRows = [];
  for (const row of importableRows) {
    const make = makeByKey.get(normalizeKey(row.parsed_values.make));
    if (!make) continue;
    modelRows.push({
      make_id: make.id,
      name: row.parsed_values.model,
      normalized_name: normalizeKey(row.parsed_values.model)
    });
  }
  await insertChunks(supabase, "vehicle_models", dedupeBy(modelRows, (row) => `${row.make_id}:${row.normalized_name}`), 500, {
    onConflict: "make_id,normalized_name"
  });

  const { data: models, error: modelsError } = await selectAll(
    supabase
    .from("vehicle_models")
    .select("id,make_id,name,normalized_name")
  );
  if (modelsError) throw modelsError;
  const modelByKey = new Map(models.map((model) => [`${model.make_id}:${model.normalized_name}`, model]));

  const { data: sourceRows, error: sourceRowsError } = await selectAll(
    supabase
    .from("fitment_import_rows")
    .select("id,row_number")
    .eq("batch_id", batch.id)
  );
  if (sourceRowsError) throw sourceRowsError;
  const sourceRowByNumber = new Map(sourceRows.map((row) => [row.row_number, row.id]));

  const applications = [];
  const rowApplicationKeys = new Map();
  for (const row of importableRows) {
    const values = row.parsed_values;
    const make = makeByKey.get(normalizeKey(values.make));
    const model = make ? modelByKey.get(`${make.id}:${normalizeKey(values.model)}`) : null;
    if (!make || !model) continue;

    const application = {
      make_id: make.id,
      model_id: model.id,
      market: values.market,
      year_start: values.start.year,
      month_start: values.start.month,
      year_end: values.end.year,
      month_end: values.end.month,
      start_raw: values.start.raw,
      end_raw: values.end.raw,
      source_name: parsed.sourceName,
      source_row_id: sourceRowByNumber.get(row.row_number) ?? null
    };
    const key = applicationKey(application);
    rowApplicationKeys.set(row.row_number, key);
    applications.push(application);
  }

  await insertChunks(supabase, "vehicle_applications", dedupeBy(applications, applicationKey), 300, {
    onConflict: "make_id,model_id,market,year_start,month_start,year_end,month_end,source_name"
  });

  const { data: savedApplications, error: applicationsError } = await selectAll(
    supabase
    .from("vehicle_applications")
    .select("id,make_id,model_id,market,year_start,month_start,year_end,month_end,source_name")
    .eq("source_name", parsed.sourceName)
  );
  if (applicationsError) throw applicationsError;
  const applicationByKey = new Map(savedApplications.map((application) => [applicationKey(application), application]));

  const wiperFitments = [];
  for (const row of importableRows) {
    const application = applicationByKey.get(rowApplicationKeys.get(row.row_number));
    if (!application) continue;
    const values = row.parsed_values;
    wiperFitments.push({
      vehicle_application_id: application.id,
      driver_length_in: values.driver_length_in,
      passenger_length_in: values.passenger_length_in,
      rear_length_in: values.rear_length_in,
      driver_length_source: values.driver_length_source,
      passenger_length_source: values.passenger_length_source,
      rear_length_source: values.rear_length_source,
      source_name: parsed.sourceName,
      source_row_id: sourceRowByNumber.get(row.row_number) ?? null,
      notes: row.parse_notes
    });
  }

  const uniqueWiperFitments = dedupeBy(
    wiperFitments,
    (row) => `${row.vehicle_application_id}:${row.source_name}`
  );

  await insertChunks(supabase, "wiper_length_fitments", uniqueWiperFitments, 300, {
    onConflict: "vehicle_application_id,source_name"
  });

  console.log(`Imported batch ${batch.id}`);
  console.log(`Imported ${uniqueWiperFitments.length} wiper length fitments.`);
  if (uniqueWiperFitments.length !== wiperFitments.length) {
    console.log(`Deduplicated ${wiperFitments.length - uniqueWiperFitments.length} repeated application fitments.`);
  }
}

async function replaceExistingSource(supabase, sourceName) {
  const applicationsDelete = await supabase
    .from("vehicle_applications")
    .delete()
    .eq("source_name", sourceName);
  if (applicationsDelete.error) {
    throw new Error(`Could not remove existing applications for ${sourceName}: ${applicationsDelete.error.message}`);
  }

  const batchesDelete = await supabase
    .from("fitment_import_batches")
    .delete()
    .eq("source_name", sourceName);
  if (batchesDelete.error) {
    throw new Error(`Could not remove existing import batches for ${sourceName}: ${batchesDelete.error.message}`);
  }

  console.log(`Removed existing fitment data for source ${sourceName}.`);
}

async function insertChunks(supabase, table, rows, size, options = {}) {
  if (!rows.length) return;

  for (let index = 0; index < rows.length; index += size) {
    const chunk = rows.slice(index, index + size);
    const query = options.onConflict
      ? supabase.from(table).upsert(chunk, { onConflict: options.onConflict, ignoreDuplicates: false })
      : supabase.from(table).insert(chunk);
    const { error } = await query;
    if (error) {
      throw new Error(`${table} import failed: ${error.message}`);
    }
  }
}

async function selectAll(query, size = 1000) {
  const data = [];

  for (let from = 0; ; from += size) {
    const to = from + size - 1;
    const { data: chunk, error } = await query.range(from, to);
    if (error) return { data, error };
    data.push(...(chunk ?? []));
    if (!chunk || chunk.length < size) {
      return { data, error: null };
    }
  }
}

function normalizeKey(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function dedupeBy(rows, getKey) {
  return [...new Map(rows.map((row) => [getKey(row), row])).values()];
}

function applicationKey(application) {
  return [
    application.make_id,
    application.model_id,
    application.market,
    application.year_start ?? "",
    application.month_start ?? "",
    application.year_end ?? "",
    application.month_end ?? "",
    application.source_name
  ].join(":");
}

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];

    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }

  return parsed;
}

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;

    const key = match[1];
    const value = match[2].replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}
