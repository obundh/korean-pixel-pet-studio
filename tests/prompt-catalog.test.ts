// @vitest-environment node

import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

type Reference = {
  role: string;
  assetId: string;
  path: string;
};

type PromptEntry = {
  id: string;
  provider: string;
  language: string;
  pet: { id: string; name: string };
  style: { id: string; name: string };
  action: { id: string; name: string };
  frame: { assetId: string; index: number; count: number };
  references: Reference[];
  variables: Record<string, string>;
  prompt: string;
};

type PromptCatalog = {
  counts: { prompts: number; promptsPerTemplate: number };
  summary: {
    pets: number;
    poseFrames: number;
    providers: number;
    languages: number;
    templates: number;
  };
  prompts: PromptEntry[];
};

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const generatedRoot = path.resolve(root, "docs", "prompting", "generated");
const referenceRoles = [
  "CANONICAL_PIXEL_MASTER",
  "STYLE_REFERENCE",
  "POSE_REFERENCE",
  "CHARACTER_REFERENCE_OPTIONAL",
];

async function json<T>(relativePath: string): Promise<T> {
  return JSON.parse(await readFile(path.resolve(root, relativePath), "utf8")) as T;
}

describe("resolved GPT/Gemini prompt catalog", () => {
  it("contains the complete 5 × 28 × 2 × 2 cross product", async () => {
    const catalog = await json<PromptCatalog>("docs/prompting/generated/index.json");
    const combinations = new Set(
      catalog.prompts.map(
        (entry) =>
          `${entry.provider}|${entry.language}|${entry.pet.id}|${entry.action.id}|${entry.frame.index}`,
      ),
    );

    expect(catalog.summary).toMatchObject({
      pets: 5,
      poseFrames: 28,
      providers: 2,
      languages: 2,
      templates: 4,
    });
    expect(catalog.counts.promptsPerTemplate).toBe(140);
    expect(catalog.counts.prompts).toBe(560);
    expect(catalog.prompts).toHaveLength(560);
    expect(new Set(catalog.prompts.map((entry) => entry.id)).size).toBe(560);
    expect(combinations.size).toBe(560);

    for (const provider of ["gpt", "gemini"]) {
      for (const language of ["ko", "en"]) {
        expect(
          catalog.prompts.filter(
            (entry) =>
              entry.provider === provider && entry.language === language,
          ),
        ).toHaveLength(140);
      }
    }
  });

  it("fully resolves every prompt and preserves ordered reference asset paths", async () => {
    const [catalog, templateCatalog, petsCatalog, stylesCatalog, animationsCatalog] =
      await Promise.all([
        json<PromptCatalog>("docs/prompting/generated/index.json"),
        json<{ requiredVariables: Record<string, string[]> }>(
          "docs/prompting/templates/catalog.json",
        ),
        json<{ pets: Array<{ id: string; sourceAssetId: string; previewAssetId: string }> }>(
          "reference-kits/pets.json",
        ),
        json<{ styles: Array<{ id: string; previewAssetId: string }> }>(
          "reference-kits/styles.json",
        ),
        json<{
          animations: Array<{
            id: string;
            frames: Array<{ assetId: string; index: number }>;
          }>;
        }>("reference-kits/animations.json"),
      ]);
    const assets = (
      await Promise.all(
        [
          "assets.example-pets.json",
          "assets.style-references.json",
          "assets.pose-references.json",
        ].map((file) =>
          json<{ assets: Array<{ id: string; filename: string }> }>(
            `reference-kits/${file}`,
          ),
        ),
      )
    ).flatMap((assetCatalog) => assetCatalog.assets);
    const assetPathById = new Map(
      assets.map((asset) => [asset.id, `reference-kits/${asset.filename}`]),
    );
    const petsById = new Map(petsCatalog.pets.map((pet) => [pet.id, pet]));
    const stylesById = new Map(stylesCatalog.styles.map((style) => [style.id, style]));
    const frameAssetByKey = new Map(
      animationsCatalog.animations.flatMap((animation) =>
        animation.frames.map((frame) => [
          `${animation.id}|${frame.index}`,
          frame.assetId,
        ] as const),
      ),
    );

    for (const entry of catalog.prompts) {
      const pet = petsById.get(entry.pet.id);
      const style = stylesById.get(entry.style.id);
      expect(pet, entry.id).toBeDefined();
      expect(style, entry.id).toBeDefined();
      expect(entry.references.map((reference) => reference.role)).toEqual(
        referenceRoles,
      );
      expect(entry.references.map((reference) => reference.path)).toEqual([
        assetPathById.get(pet!.previewAssetId),
        assetPathById.get(style!.previewAssetId),
        assetPathById.get(
          frameAssetByKey.get(`${entry.action.id}|${entry.frame.index}`)!,
        ),
        assetPathById.get(pet!.sourceAssetId),
      ]);

      for (const reference of entry.references) {
        expect(reference.path, entry.id).toBe(assetPathById.get(reference.assetId));
        await expect(access(path.resolve(root, reference.path))).resolves.toBeUndefined();
      }
      for (const variable of templateCatalog.requiredVariables["animation-frame"]) {
        expect(entry.variables[variable]?.trim().length, `${entry.id} ${variable}`).toBeGreaterThan(0);
      }
      expect(entry.prompt.length, entry.id).toBeGreaterThan(1_200);
      expect(entry.prompt, entry.id).not.toMatch(/\{\{[A-Z0-9_]+\}\}/);
    }
  });

  it("ships 140 readable prompts in every provider/language Markdown catalog", async () => {
    for (const file of ["gpt.ko.md", "gpt.en.md", "gemini.ko.md", "gemini.en.md"]) {
      const contents = await readFile(path.resolve(generatedRoot, file), "utf8");
      expect(contents.match(/^### \d{3} ·/gm)).toHaveLength(140);
      expect(contents.match(/```text/g)).toHaveLength(140);
      expect(contents).not.toMatch(/\{\{[A-Z0-9_]+\}\}/);
    }
  });

  it("is byte-for-byte synchronized with its templates and manifests", async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      ["scripts/generate-prompt-catalog.mjs", "--check"],
      { cwd: root },
    );
    expect(stdout).toContain("Verified 6 generated prompt catalog files.");
  });
});
