import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";
import { isValidSourceWiperLength } from "./wipertech-direct-matcher.mjs";

const SOURCE_FILE = "C:/Users/Sanli/Desktop/database/wipertech/wipertech_可填入_长度唯一.csv";
const OUTPUT_DIR = path.resolve("outputs/wipertech-unique-length-import-20261023");

if (!process.argv.includes("--report-only") && !process.argv.includes("--apply")) throw new Error("Choose --report-only or --apply.");
loadEnv(path.resolve(".env.local"));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const rawFile = fs.readFileSync(SOURCE_FILE);
const sourceHash = crypto.createHash("sha256").update(rawFile).digest("hex");
const rows = readCsv(SOURCE_FILE);
const normalized = rows.map((row, index) => normalizeRow(row, index + 2));
const accepted = normalized.filter((row) => row.observationStatus === "accepted");
const report = {
  sourceFile: SOURCE_FILE,
  sourceHash,
  rows: rows.length,
  acceptedObservations: accepted.length,
  skippedRows: normalized.length - accepted.length,
  partialFrontObservations: accepted.filter((row) => row.driverLengthIn === null || row.passengerLengthIn === null).length,
  rearOnlyObservations: accepted.filter((row) => row.driverLengthIn === null && row.passengerLengthIn === null && row.rearLengthIn !== null).length,
  distinctConfigurations: new Set(accepted.map((row) => row.configurationKey)).size
};
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUTPUT_DIR, "wipertech_source_archive_report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

if (process.argv.includes("--apply")) {
  const result = await archiveSource(db, normalized, sourceHash);
  fs.writeFileSync(path.join(OUTPUT_DIR, "wipertech_source_archive_applied.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ applied: true, ...result }, null, 2));
}

async function archiveSource(client, normalizedRows, hash) {
  const backupDir = await writeBackup(client);
  const configurationByKey = new Map();
  for (const row of normalizedRows.filter((item) => item.configurationKey)) {
    if (configurationByKey.has(row.configurationKey)) continue;
    const { data, error } = await client.rpc("upsert_partial_wiper_configuration", {
      p_driver_length_in: row.driverLengthIn,
      p_passenger_length_in: row.passengerLengthIn,
      p_rear_length_in: row.rearLengthIn
    });
    if (error) throw error;
    configurationByKey.set(row.configurationKey, data);
  }

  const importedAt = new Date().toISOString();
  const payload = normalizedRows.map((row) => ({
    source_file: SOURCE_FILE,
    source_file_hash: hash,
    source_row_number: row.rowNumber,
    make_name: row.make,
    model_name: row.model,
    chassis: row.chassis,
    body_style: row.body,
    year_from: row.yearStart,
    year_to: row.yearEnd,
    driver_length_in: row.driverLengthIn,
    passenger_length_in: row.passengerLengthIn,
    rear_length_in: row.rearLengthIn,
    driver_blade_sku: row.driverBlade,
    passenger_blade_sku: row.passengerBlade,
    rear_blade_sku: row.rearBlade,
    variant_count: row.variantCount,
    configuration_key: row.configurationKey,
    wiper_configuration_id: row.configurationKey ? configurationByKey.get(row.configurationKey) : null,
    observation_status: row.observationStatus,
    raw_values: row.rawValues,
    imported_at: importedAt,
    updated_at: importedAt
  }));
  for (const batch of chunks(payload, 200)) {
    const { error } = await client.from("wipertech_length_observations").upsert(batch, { onConflict: "source_file_hash,source_row_number" });
    if (error) throw error;
  }

  const { count: storedRecords, error: countError } = await client.from("wipertech_length_observations")
    .select("*", { count: "exact", head: true }).eq("source_file_hash", hash);
  if (countError) throw countError;
  if (storedRecords !== normalizedRows.length) throw new Error(`Source archive verification failed: rows=${storedRecords}/${normalizedRows.length}`);
  const { count: acceptedRecords, error: acceptedError } = await client.from("wipertech_length_observations")
    .select("*", { count: "exact", head: true }).eq("source_file_hash", hash).eq("observation_status", "accepted");
  if (acceptedError) throw acceptedError;
  return {
    appliedAt: importedAt,
    backupDir,
    storedRecords,
    acceptedRecords,
    skippedRecords: storedRecords - acceptedRecords,
    storedConfigurations: configurationByKey.size
  };
}

function normalizeRow(row, rowNumber) {
  const driverLengthIn = validLengthOrNull(row.front_driver_size);
  const passengerLengthIn = validLengthOrNull(row.front_passenger_size);
  const rearLengthIn = validLengthOrNull(row.rear_size);
  const accepted = driverLengthIn !== null || passengerLengthIn !== null || rearLengthIn !== null;
  return {
    rowNumber,
    make: text(row.make), model: text(row.model), chassis: text(row.chassis), body: text(row.body),
    yearStart: numberOrNull(row.year_from), yearEnd: numberOrNull(row.year_to),
    driverLengthIn, passengerLengthIn, rearLengthIn,
    driverBlade: text(row.front_driver_blade), passengerBlade: text(row.front_passenger_blade), rearBlade: text(row.rear_blade),
    variantCount: numberOrNull(row.variant_count),
    configurationKey: accepted ? `${driverLengthIn ?? "-"}/${passengerLengthIn ?? "-"}/${rearLengthIn ?? "-"}` : null,
    observationStatus: accepted ? "accepted" : "skipped",
    rawValues: row
  };
}

async function writeBackup(client) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = path.resolve("tmp/production-backups", `wipertech-source-archive-${stamp}`);
  fs.mkdirSync(directory, { recursive: true });
  for (const table of ["wipertech_length_observations", "wiper_sizes", "wiper_configurations", "wiper_configuration_blades"]) {
    fs.writeFileSync(path.join(directory, `${table}.json`), JSON.stringify(await fetchAll(client, table, "*"), null, 2));
  }
  return directory;
}

async function fetchAll(client, table, columns) { const rows = []; for (let from = 0; ; from += 1000) { const { data, error } = await client.from(table).select(columns).range(from, from + 999); if (error) throw error; rows.push(...data); if (data.length < 1000) return rows; } }
function readCsv(file) { const book = XLSX.readFile(file, { raw: false }); return XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { defval: "", raw: false }); }
function validLengthOrNull(value) { return isValidSourceWiperLength(value) ? Number(value) : null; }
function text(value) { return value === null || value === undefined ? "" : String(value).trim(); }
function numberOrNull(value) { const number = Number(value); return value === "" || !Number.isFinite(number) ? null : number; }
function chunks(rows, size) { const result = []; for (let index = 0; index < rows.length; index += size) result.push(rows.slice(index, index + size)); return result; }
function loadEnv(file) { for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) { const match = line.match(/^([^#=]+)=(.*)$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ""); } }
