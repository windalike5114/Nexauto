import fs from "node:fs";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

loadEnvFile(".env.local");

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

const counts = {
  wiper_sets: await countRows("wiper_sets"),
  wiper_rear_addons: await countRows("wiper_rear_addons"),
  customer_profiles: await countRows("customer_profiles"),
  customer_vehicles: await countRows("customer_vehicles"),
  order_vehicle_snapshots: await countRows("order_vehicle_snapshots"),
  order_wiper_fulfillment: await countRows("order_wiper_fulfillment")
};

console.log(JSON.stringify(counts, null, 2));

const { data: sampleSets, error: setsError } = await supabase
  .from("wiper_sets")
  .select("sku,name,driver_length_in,passenger_length_in,price")
  .order("driver_length_in")
  .order("passenger_length_in")
  .limit(10);

if (setsError) throw setsError;
console.log(JSON.stringify(sampleSets, null, 2));

const invalidSku = (sampleSets ?? []).find((row) => !/^WPFP\d+(?:P\d+)?\d+(?:P\d+)?$/.test(row.sku));
if (invalidSku) {
  throw new Error(`Invalid front pair SKU format found: ${invalidSku.sku}`);
}

async function countRows(table) {
  const { count, error } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true });

  if (error) throw error;
  return count;
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
