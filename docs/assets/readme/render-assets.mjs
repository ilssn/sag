import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const sharp = require("sharp");

const root = path.dirname(fileURLToPath(import.meta.url));
const assets = [
  ["sag-benchmark.svg", "sag-benchmark.png", 3200],
  ["repository-architecture.svg", "repository-architecture.png", 3600],
];

for (const [source, output, width] of assets) {
  const input = await fs.readFile(path.join(root, source));
  await sharp(input, { density: 192 })
    .resize({ width, withoutEnlargement: false })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(path.join(root, output));
}

for (const name of [
  "product-import.png",
  "product-search.png",
  "product-chat.png",
  "product-graph.png",
]) {
  const source = path.join(root, name);
  const output = path.join(root, `.${name}.normalized`);
  await sharp(source)
    .resize({ width: 1600 })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(output);
  await fs.rename(output, source);
}
