// @vitest-environment node

import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

type Asset = {
  id: string;
  filename: string;
  generationPrompt: string;
  referenceInputs: string[];
  canvas: { width: number; height: number };
};

const root = path.resolve(import.meta.dirname, "..");
const kitRoot = path.resolve(root, "reference-kits");

async function json<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(path.resolve(kitRoot, file), "utf8")) as T;
}

async function allAssets(): Promise<Asset[]> {
  const files = [
    "assets.example-pets.json",
    "assets.style-references.json",
    "assets.pose-references.json",
  ];
  const catalogs = await Promise.all(
    files.map((file) => json<{ assets: Asset[] }>(file)),
  );
  return catalogs.flatMap((catalog) => catalog.assets);
}

describe("original reference kit", () => {
  it("ships the promised 43 unique, linked image assets", async () => {
    const manifest = await json<{
      counts: { imageAssetEntries: number; animationFrames: number };
    }>("manifest.json");
    const assets = await allAssets();
    const ids = new Set(assets.map((asset) => asset.id));
    const filenames = new Set(assets.map((asset) => asset.filename));

    expect(manifest.counts.imageAssetEntries).toBe(43);
    expect(manifest.counts.animationFrames).toBe(28);
    expect(assets).toHaveLength(43);
    expect(ids.size).toBe(43);
    expect(filenames.size).toBe(43);

    for (const asset of assets) {
      expect(asset.generationPrompt.length).toBeGreaterThan(180);
      for (const input of asset.referenceInputs) expect(ids.has(input)).toBe(true);
    }
  });

  it("contains every declared PNG at its exact canvas size with transparent corners", async () => {
    const assets = await allAssets();
    for (const asset of assets) {
      const file = path.resolve(kitRoot, asset.filename);
      await expect(access(file)).resolves.toBeUndefined();
      const metadata = await sharp(file).metadata();
      expect(metadata.format, asset.filename).toBe("png");
      expect(metadata.width, asset.filename).toBe(asset.canvas.width);
      expect(metadata.height, asset.filename).toBe(asset.canvas.height);
      expect(metadata.hasAlpha, asset.filename).toBe(true);

      const { data, info } = await sharp(file)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const alphaAt = (x: number, y: number) =>
        data[(y * info.width + x) * info.channels + 3];
      expect(alphaAt(0, 0), `${asset.filename} top-left alpha`).toBe(0);
      expect(alphaAt(info.width - 1, 0), `${asset.filename} top-right alpha`).toBe(0);
      expect(alphaAt(0, info.height - 1), `${asset.filename} bottom-left alpha`).toBe(0);
      expect(
        alphaAt(info.width - 1, info.height - 1),
        `${asset.filename} bottom-right alpha`,
      ).toBe(0);
    }
  });

  it("keeps animation runtime entries aligned with the 28 pose assets", async () => {
    const manifest = await json<{
      runtimeCatalog: {
        animations: Array<{ frames: Array<{ assetId: string; filename: string }> }>;
      };
    }>("manifest.json");
    const poses = await json<{ assets: Asset[] }>("assets.pose-references.json");
    const poseById = new Map(poses.assets.map((asset) => [asset.id, asset]));
    const runtimeFrames = manifest.runtimeCatalog.animations.flatMap(
      (animation) => animation.frames,
    );

    expect(runtimeFrames).toHaveLength(28);
    for (const frame of runtimeFrames) {
      expect(poseById.get(frame.assetId)?.filename).toBe(frame.filename);
    }
  });

  it("ships all four GPT/Gemini prompt templates", async () => {
    const templateDir = path.resolve(root, "docs", "prompting", "templates");
    const files = (await readdir(templateDir)).filter((file) => file.endsWith(".md"));
    expect(files.sort()).toEqual([
      "gemini.en.md",
      "gemini.ko.md",
      "gpt.en.md",
      "gpt.ko.md",
    ]);
    for (const file of files) {
      const contents = await readFile(path.resolve(templateDir, file), "utf8");
      expect(contents).toContain("{{IDENTITY_LOCKS}}");
      expect(contents).toContain("{{STYLE_RULES}}");
      expect(contents).toContain("{{OUTPUT_FILENAME}}");
    }
  });
});
