import { mkdir, readFile, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "..");
const manifests = [
  "reference-kits/assets.example-pets.json",
  "reference-kits/assets.style-references.json"
];

for (const manifestFile of manifests) {
  const manifest = JSON.parse(await readFile(resolve(root, manifestFile), "utf8"));
  for (const asset of manifest.assets) {
    const target = resolve(root, "reference-kits", asset.filename);
    const temp = `${target}.normalized.png`;
    const width = asset.canvas.width;
    const height = asset.canvas.height;
    const isPixelAsset = asset.kind !== "example-character-source";

    await mkdir(dirname(target), { recursive: true });
    await sharp(target)
      .resize(width, height, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        kernel: isPixelAsset ? sharp.kernel.nearest : sharp.kernel.lanczos3,
        withoutEnlargement: false
      })
      .png({ palette: isPixelAsset, quality: 100 })
      .toFile(temp);
    await rename(temp, target);
  }
}

console.log("Generated reference assets normalized to manifest canvas sizes.");
