import { readFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "..");
const groups = {
  green: [
    "images/example-pets/bori-cloud-fox-source.png",
    "images/example-pets/bori-cloud-fox-preview.png",
    "images/example-pets/nari-plum-owl-source.png",
    "images/example-pets/nari-plum-owl-preview.png",
    "images/example-pets/dodo-moon-rabbit-source.png",
    "images/example-pets/dodo-moon-rabbit-preview.png",
    "images/styles/bold-outline-32-reference.png",
    "images/styles/neon-night-32-reference.png"
  ],
  magenta: [
    "images/example-pets/muru-mint-axolotl-source.png",
    "images/example-pets/muru-mint-axolotl-preview.png",
    "images/example-pets/chori-lemon-gecko-source.png",
    "images/example-pets/chori-lemon-gecko-preview.png",
    "images/styles/soft-cluster-16-reference.png",
    "images/styles/pastel-dither-48-reference.png",
    "images/styles/paper-cut-48-reference.png"
  ]
};

async function clean(relativePath, key) {
  const path = resolve(root, "reference-kits", relativePath);
  const image = sharp(path).ensureAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  let removed = 0;

  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const alpha = data[i + 3];
    const isFringe = key === "green"
      ? g > 165 && g > Math.max(r, b) * 1.45
      : r > 180 && b > 155 && g < Math.min(r, b) * 0.5;

    if (alpha > 0 && isFringe) {
      data[i + 3] = 0;
      removed += 1;
    }
  }

  const temp = `${path}.cleaned.png`;
  await sharp(data, { raw: info }).png().toFile(temp);
  await rename(temp, path);
  return removed;
}

let total = 0;
for (const [key, files] of Object.entries(groups)) {
  for (const file of files) total += await clean(file, key);
}

console.log(`Removed ${total} residual chroma pixels from generated reference assets.`);
