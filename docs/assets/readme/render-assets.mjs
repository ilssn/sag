import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(root, "../../../apps/web/package.json"));
const sharp = require("sharp");
const assets = [
  ["repository-architecture.svg", "repository-architecture.png", 3600],
  ["repository-architecture-cn.svg", "repository-architecture-cn.png", 3600],
];

for (const [source, output, width] of assets) {
  const input = await fs.readFile(path.join(root, source));
  await sharp(input, { density: 192 })
    .resize({ width, withoutEnlargement: false })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(path.join(root, output));
}

const headerScale = 4;
const headerLogo = await sharp(path.join(root, "zleap-logo.svg"), { density: 384 })
  .resize({ width: 220 * headerScale })
  .png()
  .toBuffer();
const headerMascot = await sharp(path.join(root, "zleap-mascot.png"))
  .resize({ width: 96 * headerScale })
  .rotate(-8, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer();

await sharp({
  create: {
    width: 294 * headerScale,
    height: 188 * headerScale,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite([
    { input: headerLogo, left: 0, top: 0 },
    { input: headerMascot, left: 180 * headerScale, top: 43 * headerScale },
  ])
  .png({ compressionLevel: 9, adaptiveFiltering: true })
  .toFile(path.join(root, "zleap-readme-header.png"));

for (const name of [
  "product-import.png",
  "product-search.png",
  "product-chat.png",
  "product-graph.png",
  "product-mcp.png",
]) {
  const source = path.join(root, name);
  const output = path.join(root, `.${name}.normalized`);
  await sharp(source)
    .resize({ width: 1600 })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(output);
  await fs.rename(output, source);
}
