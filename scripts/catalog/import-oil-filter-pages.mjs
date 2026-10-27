import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const defaultSourceRoot = "C:\\Users\\Sanli\\Desktop\\database\\oilfilter";
const options = readOptions(process.argv.slice(2));
const productsPath = options.products ?? path.join(defaultSourceRoot, "oilfilter_products_all.csv");
const imagesPath = options.images ?? path.join(defaultSourceRoot, "oilfilter_images");
const outputPath = options.out ?? path.resolve("data/oil-filters/catalog.json");
const publicImagesPath = options.publicImages ?? path.resolve("public/products/oil-filters/catalog");
const imageAliases = new Map([["UJ3780F", "UJ3780"]]);

const [productRows, imageEntries] = await Promise.all([
  readCsv(productsPath),
  readdir(imagesPath, { withFileTypes: true })
]);

const imagesByReference = new Map(
  imageEntries
    .filter((entry) => entry.isFile())
    .map((entry) => [normalizeKey(path.parse(entry.name).name), entry.name])
);
const productsBySku = new Map();
const usedImages = new Set();

for (const row of productRows) {
  const sku = required(row.sku, "SKU").toUpperCase();
  if (productsBySku.has(sku)) throw new Error(`Duplicate product SKU: ${sku}`);

  const topstarRef = required(row.topstar_ref, `${sku} TopStar reference`);
  const imageKey = imageAliases.get(normalizeKey(topstarRef)) ?? normalizeKey(topstarRef);
  const imageName = imagesByReference.get(imageKey);
  if (!imageName) throw new Error(`Missing image for ${sku}: ${topstarRef}`);
  usedImages.add(imageName);

  const category = readCategory(row.category, sku);
  const supplierRef = required(row.supplier_ref, `${sku} supplier reference`);
  const brands = required(row.brands, `${sku} brands`);
  const mostlyFor = required(row.mostly_for, `${sku} model fitment`);
  const priceNzd = readPositiveNumber(row.price_nzd, `${sku} price`);
  const heightMm = readPositiveNumber(row.height, `${sku} height`);
  const outerDiameter = readDimension(row.outer_diameter, `${sku} outside diameter`);
  const insideDiameter = clean(row.inside_diameter);
  const threadSize = clean(row.thread_size);
  const sealRingSize = clean(row.seal_ring_size);

  if (threadSize && sealRingSize) {
    throw new Error(`${sku} has both thread_size and seal_ring_size; only one may be published.`);
  }
  if (category === "Cartridge" && threadSize) {
    throw new Error(`${sku} is Cartridge but contains thread_size.`);
  }
  if (category === "Spin-On" && sealRingSize) {
    throw new Error(`${sku} is Spin-On but contains seal_ring_size.`);
  }

  const extension = path.extname(imageName).toLowerCase();
  productsBySku.set(sku, {
    sku,
    topstarRef,
    supplierRef,
    title: `NexAuto ${category} Oil Filter - ${sku}`,
    priceNzd,
    category,
    brands,
    mostlyFor,
    heightMm,
    outerDiameter,
    insideDiameter,
    threadSize,
    sealRingSize,
    imageUrl: `/products/oil-filters/catalog/${sku}${extension}`
  });
}

if (usedImages.size !== productRows.length) {
  throw new Error(`Expected one unique image per product; matched ${usedImages.size} images for ${productRows.length} products.`);
}

await mkdir(path.dirname(outputPath), { recursive: true });
await rm(publicImagesPath, { recursive: true, force: true });
await mkdir(publicImagesPath, { recursive: true });

const catalog = [...productsBySku.values()].sort((a, b) => a.sku.localeCompare(b.sku, undefined, { numeric: true }));
for (const product of catalog) {
  const productKey = imageAliases.get(normalizeKey(product.topstarRef)) ?? normalizeKey(product.topstarRef);
  const sourceImage = imagesByReference.get(productKey);
  if (!sourceImage) throw new Error(`Could not resolve copied image for ${product.sku}`);
  await copyFile(path.join(imagesPath, sourceImage), path.join(publicImagesPath, path.basename(product.imageUrl)));
}

await writeFile(outputPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");

process.stdout.write(`${JSON.stringify({
  products: catalog.length,
  cartridge: catalog.filter((product) => product.category === "Cartridge").length,
  spinOn: catalog.filter((product) => product.category === "Spin-On").length,
  images: usedImages.size,
  outputPath,
  publicImagesPath
}, null, 2)}\n`);

async function readCsv(filePath) {
  const text = (await readFile(filePath, "utf8")).replace(/^\uFEFF/, "");
  const rows = parseCsv(text);
  const headers = rows.shift()?.map((value) => value.trim()) ?? [];
  if (!headers.length) throw new Error(`CSV has no header: ${filePath}`);
  return rows
    .filter((row) => row.some((value) => value.trim()))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(value);
      value = "";
    } else if (character === "\n") {
      row.push(value.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }

  if (value.length || row.length) {
    row.push(value.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

function readCategory(value, sku) {
  const normalized = clean(value).toLowerCase().replace(/[_-]+/g, " ");
  if (normalized === "cartridge") return "Cartridge";
  if (normalized === "spin on") return "Spin-On";
  throw new Error(`Unsupported category for ${sku}: ${value}`);
}

function readPositiveNumber(value, label) {
  const result = Number(clean(value));
  if (!Number.isFinite(result) || result <= 0) throw new Error(`Invalid ${label}: ${value}`);
  return result;
}

function readDimension(value, label) {
  const result = required(value, label);
  const parts = result.split("/").map((part) => Number(part.trim()));
  if (parts.some((part) => !Number.isFinite(part) || part <= 0)) throw new Error(`Invalid ${label}: ${value}`);
  return result;
}

function normalizeKey(value) {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function required(value, label) {
  const result = clean(value);
  if (!result) throw new Error(`Missing ${label}`);
  return result;
}

function readOptions(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]?.replace(/^--/, "").replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = args[index + 1];
    if (!key || !value) throw new Error(`Invalid argument pair near ${args[index] ?? "end of command"}`);
    result[key] = path.resolve(value);
  }
  return result;
}
