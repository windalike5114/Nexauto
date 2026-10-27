import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const envFile = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase production credentials.");
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const tables = [
  "catalog_product_lines",
  "catalog_reference_schemes",
  "catalog_part_references",
  "catalog_part_reference_products",
  "vehicle_catalog_part_reference_fitments"
];

const result = [];
for (const table of tables) {
  const { data, count, error } = await db.from(table).select("*", { count: "exact" }).limit(1);
  result.push({
    table,
    exists: !error,
    count: error ? null : count,
    sampleRows: error ? null : data?.length ?? 0,
    errorCode: error?.code ?? null,
    errorMessage: error?.message ?? null
  });
}

console.log(JSON.stringify(result, null, 2));
