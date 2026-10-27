import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export const OUT = path.resolve("outputs/price-update-20261026");
const paths = { brakes: "data/brake-pads/catalog.json", filters: "data/oil-filters/catalog.json", bulbs: "data/bulbs/catalog.json" };
const categories = { brakes: "brake-pad", filters: "filter", bulbs: "bulb" };
const put = (name, data) => fs.writeFileSync(path.join(OUT, name), JSON.stringify(data, null, 2) + "\n");
const read = (name) => JSON.parse(fs.readFileSync(path.join(OUT, name), "utf8"));
export function priceAfter(value, category) {
  const cents = Math.round(Number(value) * 100);
  assert.ok(Number.isSafeInteger(cents) && cents >= 0);
  if (category === "brake-pad") return Math.ceil(cents / 100) * 2;
  if (category === "filter") return cents * 2 / 100;
  if (category === "bulb") return Math.round(cents > 8000 ? cents * 13 / 10 : cents * 2) / 100;
  throw new Error(`Unexpected category ${category}`);
}

export function makePlan(before, local) {
  const productById = new Map(before.products.map((row) => [row.id, row]));
  const variants = before.variants.map((row) => ({ id: row.id, sku: row.sku, product_id: row.product_id,
    before: Number(row.price), after: priceAfter(row.price, productById.get(row.product_id).category_slug) }));
  const products = before.products.map((row) => {
    const prices = variants.filter((variant) => variant.product_id === row.id).map((variant) => variant.after);
    return { id: row.id, slug: row.slug, before: Number(row.price), after: prices.length ? Math.min(...prices) : priceAfter(row.price, row.category_slug) };
  });
  const localChanges = Object.fromEntries(Object.entries(local).map(([line, rows]) => [line, rows.map((row) => {
    const variant = variants.find((variant) => variant.sku === row.sku);
    assert.ok(variant, `Missing database SKU ${row.sku}`);
    assert.equal(variant.before, row.priceNzd, `Source price mismatch ${row.sku}`);
    assert.equal(variant.after, priceAfter(row.priceNzd, categories[line]));
    return { sku: row.sku, before: row.priceNzd, after: variant.after };
  })]));
  return { policy: "GST_INCLUDED_20261026", currency: "NZD", gst_included: true,
    bulb_threshold_basis: "original_price", brake_rounding: "ceil_original_nzd_then_double",
    variants, products, localChanges, baseline_sha256: crypto.createHash("sha256").update(JSON.stringify(before)).digest("hex") };
}

async function fetchRows(db, table, ids, columns = "*") {
  const rows = [];
  for (let i = 0; i < ids.length; i += 40) {
    const result = await db.from(table).select(columns).in("id", ids.slice(i, i + 40)).order("id");
    if (result.error) throw new Error(`${table}: ${result.error.message}`);
    rows.push(...result.data);
  }
  assert.equal(rows.length, ids.length);
  return rows;
}

async function main() {
  const before = read("database-before.json"), local = read("local-before.json");
  const plan = makePlan(before, local);
  put("plan.json", plan);
  if (process.argv.includes("--local")) {
    for (const [line, file] of Object.entries(paths)) {
      const current = JSON.parse(fs.readFileSync(file, "utf8"));
      for (const row of current) {
        const change = plan.localChanges[line].find((change) => change.sku === row.sku);
        assert.ok(change);
        assert.ok(row.priceNzd === change.before || row.priceNzd === change.after, `Local drift ${row.sku}`);
        row.priceNzd = change.after;
      }
      fs.writeFileSync(file, JSON.stringify(current, null, 2) + "\n");
    }
  }
  const changes = { variants: plan.variants.filter((row) => row.before !== row.after), products: plan.products.filter((row) => row.before !== row.after) };
  if (process.argv.includes("--apply") || process.argv.includes("--verify")) {
    process.loadEnvFile(".env.local");
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const live = {};
    for (const [key, table] of [["variants", "product_variants"], ["products", "products"]]) live[key] = await fetchRows(db, table, plan[key].map((row) => row.id));
    if (process.argv.includes("--apply")) {
      const alreadyApplied = Object.entries(changes).every(([key, rows]) => rows.every((row) => Number(live[key].find((entry) => entry.id === row.id).price) === row.after));
      if (!alreadyApplied) {
        for (const [key, rows] of Object.entries(changes)) for (const row of rows) assert.equal(Number(live[key].find((entry) => entry.id === row.id).price), row.before, `Concurrent price change ${row.id}`);
        assert.ok(!fs.existsSync(path.join(OUT, "apply-before.json")), "Prior write journal exists; inspect before retrying");
        put("apply-before.json", live);
        const completed = [];
        try {
          for (const [key, table] of [["variants", "product_variants"], ["products", "products"]]) {
            // Group equal prices into bounded updates; preserve every non-price field.
            const groups = new Map();
            for (const row of changes[key]) { const group = groups.get(row.after) ?? []; group.push(row); groups.set(row.after, group); }
            for (const [price, rows] of groups) for (let i = 0; i < rows.length; i += 40) {
              const chunk = rows.slice(i, i + 40);
              const result = await db.from(table).update({ price }).in("id", chunk.map((row) => row.id)).select("id,price");
              if (result.error) throw new Error(`${table}: ${result.error.message}`);
              assert.equal(result.data.length, chunk.length);
              completed.push({ key, table, rows: chunk }); put("write-journal.json", completed);
            }
          }
        } catch (error) {
          put("error.json", { message: error.message });
          for (const batch of completed.reverse()) for (const row of batch.rows) {
            const result = await db.from(batch.table).update({ price: row.before }).eq("id", row.id).eq("price", row.after);
            if (result.error) throw new Error(`Rollback failed: ${result.error.message}; original error: ${error.message}`);
          }
          put("rolled-back.json", { completed: true });
          throw error;
        }
      }
    }
    for (const [key, table] of [["variants", "product_variants"], ["products", "products"]]) {
      const actual = await fetchRows(db, table, plan[key].map((row) => row.id));
      for (const expected of plan[key]) assert.equal(Number(actual.find((row) => row.id === expected.id).price), expected.after, `${table} readback ${expected.id}`);
      const baseline = key === "variants" ? before.variants : before.products;
      for (const row of baseline) for (const [field, value] of Object.entries(row)) {
        if (field !== "price") assert.deepEqual(actual.find((entry) => entry.id === row.id)[field], value, `${table}.${field} changed`);
      }
    }
    put("verified.json", { verified: true, gst_included: true, changed_variants: changes.variants.length, changed_products: changes.products.length, at: new Date().toISOString() });
  }
  console.log(JSON.stringify({ changed_variants: changes.variants.length, changed_products: changes.products.length,
    local_catalogues: Object.fromEntries(Object.entries(local).map(([key, rows]) => [key, rows.length])), gst_included: true,
    examples: [43.48, 50, 60, 80].map((value) => ({ brake_before: value, after: priceAfter(value, "brake-pad") })),
    bulb_examples: [40, 85, 100, 105, 160].map((value) => ({ before: value, after: priceAfter(value, "bulb") })) }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) await main();
