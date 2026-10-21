import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const defaultSourceRoot = "C:\\Users\\Sanli\\Desktop\\database\\brakepad";
const options = readOptions(process.argv.slice(2));
const productsPath = options.products ?? path.join(defaultSourceRoot, "brakepad_products_all.csv");
const fitmentsPath = options.fitments ?? path.join(defaultSourceRoot, "brakepad_fitment_with_sku.csv");
const imagesPath = options.images ?? path.join(defaultSourceRoot, "brakepad_images_pn");
const outputPath = options.out ?? path.resolve("data/brake-pads/catalog.json");
const publicImagesPath = options.publicImages ?? path.resolve("public/products/brake-pads/catalog");
const placeholderImageUrl = "/products/brake-pads/ceramic-brake-pad-set.png";

const [productRows, fitmentRows, imageEntries] = await Promise.all([
  readCsv(productsPath),
  readCsv(fitmentsPath),
  readdir(imagesPath, { withFileTypes: true })
]);

const imagesByPn = new Map(
  imageEntries
    .filter((entry) => entry.isFile())
    .map((entry) => [path.parse(entry.name).name.toUpperCase(), entry.name])
);
const productsBySku = new Map();
const fitmentsBySku = new Map();

for (const row of fitmentRows) {
  const sku = required(row.SKU, "fitment SKU");
  const fitments = fitmentsBySku.get(sku) ?? [];
  fitments.push({
    make: required(row.make, `${sku} fitment make`),
    model: required(row.model, `${sku} fitment model`),
    chassis: clean(row.chassis),
    engine: clean(row.engine)
  });
  fitmentsBySku.set(sku, fitments);
}

let normalizedFromTitle = 0;
for (const row of productRows) {
  const sku = required(row.SKU, "product SKU");
  if (productsBySku.has(sku)) throw new Error(`Duplicate product SKU: ${sku}`);

  const title = required(row.title, `${sku} title`);
  const titleDimensions = readTitleDimensions(title);
  const lengthMm = readMillimetres(row.length_mm) ?? titleDimensions?.[0];
  const widthMm = readMillimetres(row.width_mm) ?? titleDimensions?.[1];
  const thicknessMm = readMillimetres(row.thickness_mm) ?? titleDimensions?.[2];
  const position = clean(row.position) || readTitlePosition(title);
  if (!clean(row.position) || !readMillimetres(row.width_mm)) normalizedFromTitle += 1;

  const pn = required(row.pn, `${sku} image key`).toUpperCase();
  const fitments = fitmentsBySku.get(sku) ?? [];
  const imageName = fitments.length > 0 ? imagesByPn.get(pn) : undefined;

  const expectedFitmentCount = Number(row.fitment_count);
  if (!Number.isInteger(expectedFitmentCount) || expectedFitmentCount < 0) {
    throw new Error(`Invalid fitment count for ${sku}: ${row.fitment_count}`);
  }
  if (fitments.length > 0 && expectedFitmentCount !== fitments.length) {
    throw new Error(`Fitment count mismatch for ${sku}: expected ${row.fitment_count}, found ${fitments.length}`);
  }

  const priceNzd = Number(row.price_nzd);
  if (!Number.isFinite(priceNzd) || priceNzd <= 0) throw new Error(`Invalid price for ${sku}: ${row.price_nzd}`);
  if (!lengthMm || !widthMm || !thicknessMm) throw new Error(`Incomplete dimensions for ${sku}`);
  if (!position) throw new Error(`Missing position for ${sku}`);

  const extension = imageName ? path.extname(imageName).toLowerCase() : "";
  productsBySku.set(sku, {
    sku,
    supplierRef: required(row["sku-supplier"], `${sku} supplier ref`),
    title,
    priceNzd,
    position,
    lengthMm,
    widthMm,
    thicknessMm,
    imageUrl: imageName ? `/products/brake-pads/catalog/${sku}${extension}` : placeholderImageUrl,
    imageIsPlaceholder: !imageName,
    fitments
  });
}

const orphanFitmentSkus = [...fitmentsBySku.keys()].filter((sku) => !productsBySku.has(sku));
if (orphanFitmentSkus.length) throw new Error(`Fitments reference unknown SKUs: ${orphanFitmentSkus.join(", ")}`);

await mkdir(path.dirname(outputPath), { recursive: true });
await rm(publicImagesPath, { recursive: true, force: true });
await mkdir(publicImagesPath, { recursive: true });

const catalog = [...productsBySku.values()].sort((a, b) => a.sku.localeCompare(b.sku, undefined, { numeric: true }));
for (const product of catalog) {
  if (product.imageIsPlaceholder) continue;
  const productRow = productRows.find((row) => row.SKU === product.sku);
  const sourceImage = imagesByPn.get(required(productRow?.pn, `${product.sku} image key`).toUpperCase());
  await copyFile(path.join(imagesPath, sourceImage), path.join(publicImagesPath, path.basename(product.imageUrl)));
}

await writeFile(outputPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");

process.stdout.write(`${JSON.stringify({
  products: catalog.length,
  fitments: fitmentRows.length,
  productImages: catalog.filter((product) => !product.imageIsPlaceholder).length,
  placeholderImages: catalog.filter((product) => product.imageIsPlaceholder).length,
  productsWithoutFitments: catalog.filter((product) => product.fitments.length === 0).length,
  normalizedFromTitle,
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

function readTitleDimensions(title) {
  const match = title.match(/(\d+(?:\.\d+)?)\s*×\s*(\d+(?:\.\d+)?)\s*×\s*(\d+(?:\.\d+)?)\s*mm/i);
  return match ? match.slice(1, 4).map(Number) : null;
}

function readTitlePosition(title) {
  return title.match(/\b(Front|Rear)\s+Brake Pad Set\b/i)?.[1] === "Rear" ? "Rear Axle" : title.match(/\bFront\s+Brake Pad Set\b/i) ? "Front Axle" : "";
}

function readMillimetres(value) {
  const numeric = Number(clean(value).replace(/\s*mm$/i, ""));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
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
