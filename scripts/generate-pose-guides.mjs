import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const kitRoot = path.join(root, "reference-kits");
const manifest = JSON.parse(
  await readFile(path.join(kitRoot, "manifest.json"), "utf8"),
);
const outputDir = path.join(kitRoot, "images", "pose-guides");

await mkdir(outputDir, { recursive: true });

for (const animation of manifest.runtimeCatalog.animations) {
  const inputs = await Promise.all(
    animation.frames.map(async (frame) => {
      const input = path.join(kitRoot, frame.filename);
      const metadata = await sharp(input).metadata();
      if (!metadata.width || !metadata.height) {
        throw new Error(`Cannot read pose frame dimensions: ${frame.filename}`);
      }
      return { input, width: metadata.width, height: metadata.height };
    }),
  );

  const width = inputs.reduce((sum, input) => sum + input.width, 0);
  const height = Math.max(...inputs.map((input) => input.height));
  let left = 0;
  const composite = inputs.map((input) => {
    const layer = { input: input.input, left, top: height - input.height };
    left += input.width;
    return layer;
  });
  const filename = animation.guideFilename?.split("/").at(-1) ?? `${animation.id}-guide.png`;

  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composite)
    .png()
    .toFile(path.join(outputDir, filename));

  console.log(`Pose guide ready: ${filename} (${width}x${height})`);
}
