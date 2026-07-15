import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { PET_ANIMATION_NAMES, type PixelPetProject } from "../src/shared/project";

const root = path.resolve(import.meta.dirname, "..");
const examplesRoot = path.join(root, "examples", "beginner-pets");
const sampleIds = ["haeori-sun-otter", "mongle-cloud-bear", "toto-sprout-turtle"];

type RunLog = {
  schemaVersion: string;
  sampleId: string;
  public: boolean;
  source: { path: string; sha256: string; bytes: number };
  pipeline: {
    mode: string;
    entryPoint: string;
    imageProcessing: string;
    backgroundRemoval: string;
    flatChromaPostprocess: {
      applied: boolean;
      keyRgb?: [number, number, number];
      operations?: string[];
    };
    canvas: { width: number; height: number };
    idlePreset: string[];
    frameDiagnostics: Array<{
      width: number;
      height: number;
      opaquePixels: number;
      softAlphaPixels: number;
      chromaFringePixels: number;
      alphaBounds: { x: number; y: number; width: number; height: number };
      largestEnclosedTransparentRegion: number;
    }>;
  };
  appExports: {
    project: string;
    spriteSheet: string;
    projectExportButton: string;
    spriteSheetExportButton: string;
    downloadTransport: string;
  };
  generatedFrames: string[];
  preview: string;
  desktopPetVerification: {
    status: string;
    animation: string;
    size: { width: number; height: number };
    windowVisible: boolean;
    alwaysOnTop: boolean;
    capture: { width: number; height: number };
    nonTransparentPixels: number;
    captureSha256: string;
    verificationPath: string;
  };
  outputSha256: Record<string, string>;
  rightsBoundary: string;
};

const hash = (value: Buffer): string => createHash("sha256").update(value).digest("hex");
const fromRoot = (relativePath: string): string => path.resolve(root, relativePath);

async function loadSample(id: string): Promise<{
  directory: string;
  project: PixelPetProject;
  log: RunLog;
}> {
  const directory = path.join(examplesRoot, id);
  const project = JSON.parse(
    await readFile(path.join(directory, `${id}.pixelpet`), "utf8"),
  ) as PixelPetProject;
  const log = JSON.parse(await readFile(path.join(directory, "run-log.json"), "utf8")) as RunLog;
  return { directory, project, log };
}

async function expectCleanPixelAlpha(
  buffer: Buffer,
  expectedSize: number,
  keyRgb: [number, number, number],
): Promise<void> {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  expect(info.width).toBe(expectedSize);
  expect(info.height).toBe(expectedSize);
  expect(info.channels).toBe(4);
  const alphaAt = (x: number, y: number) => data[(y * info.width + x) * info.channels + 3];
  expect([
    alphaAt(0, 0),
    alphaAt(info.width - 1, 0),
    alphaAt(0, info.height - 1),
    alphaAt(info.width - 1, info.height - 1),
  ]).toEqual([0, 0, 0, 0]);
  let softAlpha = 0;
  let chromaFringe = 0;
  for (let index = 0; index < data.length; index += info.channels) {
    const alpha = data[index + 3];
    if (alpha !== 0 && alpha !== 255) softAlpha += 1;
    if (
      alpha > 0 &&
      Math.hypot(
        data[index] - keyRgb[0],
        data[index + 1] - keyRgb[1],
        data[index + 2] - keyRgb[2],
      ) < 80
    ) {
      chromaFringe += 1;
    }
  }
  expect(softAlpha).toBe(0);
  expect(chromaFringe).toBe(0);
}

describe.each(sampleIds)("beginner sample %s", (id) => {
  it("is a portable PixelPet v1 project with exactly four uniform idle frames", async () => {
    const { project } = await loadSample(id);
    expect(project.version).toBe(1);
    expect(project.name).toBe(id);
    expect(project.activeKitId).toMatch(/^[^:]+:[^:]+$/);
    expect(project.fps).toBeGreaterThanOrEqual(2);
    expect(project.fps).toBeLessThanOrEqual(16);
    expect(project.scale).toBeGreaterThan(0);
    expect(Object.keys(project.frames).sort()).toEqual([...PET_ANIMATION_NAMES].sort());

    const idle = project.frames.idle.filter((frame) => frame !== null);
    expect(idle).toHaveLength(4);
    const dimensions = new Set(idle.map((frame) => `${frame.width}x${frame.height}`));
    expect(dimensions.size).toBe(1);
    expect(["64x64", "96x96"]).toContain([...dimensions][0]);
    expect(idle.every((frame) => frame.backgroundRemoved)).toBe(true);
    expect(new Set(idle.map((frame) => frame.id)).size).toBe(4);
    for (const animation of PET_ANIMATION_NAMES.filter((name) => name !== "idle")) {
      expect(project.frames[animation].filter(Boolean)).toHaveLength(0);
    }
  });

  it("keeps the app-generated idle PNGs byte-identical and transparent at every corner", async () => {
    const { directory, project, log } = await loadSample(id);
    const keyRgb = log.pipeline.flatChromaPostprocess.keyRgb;
    expect(keyRgb).toHaveLength(3);
    const frames = project.frames.idle.filter((frame) => frame !== null);
    const exportedHashes: string[] = [];
    for (let index = 0; index < frames.length; index += 1) {
      const frame = frames[index];
      expect(frame.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
      const embedded = Buffer.from(frame.dataUrl.split(",", 2)[1], "base64");
      const exported = await readFile(
        path.join(directory, "generated", `idle-${String(index + 1).padStart(2, "0")}.png`),
      );
      exportedHashes.push(hash(exported));
      expect(hash(exported)).toBe(hash(embedded));
      await expectCleanPixelAlpha(exported, frame.width, keyRgb as [number, number, number]);
    }
    expect(new Set(exportedHashes).size).toBeGreaterThanOrEqual(3);
    expect(new Set(frames.map((frame) => frame.dataUrl)).size).toBeGreaterThanOrEqual(3);
  });

  it("includes the app exports, preview, and machine-readable provenance with matching hashes", async () => {
    const { directory, project, log } = await loadSample(id);
    expect(log.schemaVersion).toBe("1.0.0");
    expect(log.sampleId).toBe(id);
    expect(log.public).toBe(true);
    expect(log.pipeline.mode).toBe("hidden-electron-browser-mode");
    expect(log.pipeline.entryPoint).toContain("quick-pet UI");
    expect(log.pipeline.imageProcessing).toContain("no external image post-processing");
    expect(log.pipeline.backgroundRemoval).toBe("performed");
    expect(log.pipeline.flatChromaPostprocess).toMatchObject({
      applied: true,
      operations: ["key-distance matte", "despill", "pixel hard-alpha"],
    });
    expect(log.pipeline.idlePreset).toEqual(["neutral", "inhale-up", "soft-squash", "exhale"]);
    expect(log.pipeline.frameDiagnostics).toHaveLength(4);
    for (const diagnostics of log.pipeline.frameDiagnostics) {
      expect(diagnostics.opaquePixels).toBeGreaterThan(100);
      expect(diagnostics.softAlphaPixels).toBe(0);
      expect(diagnostics.chromaFringePixels).toBe(0);
      expect(diagnostics.alphaBounds.width).toBeGreaterThan(0);
      expect(diagnostics.alphaBounds.height).toBeGreaterThan(0);
      expect(diagnostics.largestEnclosedTransparentRegion).toBeLessThanOrEqual(32);
    }
    expect(
      new Set(log.pipeline.frameDiagnostics.map((item) => JSON.stringify(item.alphaBounds))).size,
    ).toBeGreaterThanOrEqual(3);
    expect(log.appExports.projectExportButton).toBe("export-project-json");
    expect(log.appExports.spriteSheetExportButton).toBe("export-spritesheet");
    expect(log.appExports.downloadTransport).toBe("Electron will-download");
    expect(log.generatedFrames).toHaveLength(4);
    expect(log.desktopPetVerification).toMatchObject({
      status: "running",
      animation: "idle",
      windowVisible: true,
      alwaysOnTop: true,
    });
    expect(log.desktopPetVerification.size.width).toBeGreaterThan(0);
    expect(log.desktopPetVerification.size.height).toBeGreaterThan(0);
    expect(log.desktopPetVerification.capture.width).toBeGreaterThan(0);
    expect(log.desktopPetVerification.capture.height).toBeGreaterThan(0);
    expect(log.desktopPetVerification.nonTransparentPixels).toBeGreaterThan(0);
    expect(log.desktopPetVerification.captureSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(log.desktopPetVerification.verificationPath).toContain("WindowManager.startPet");
    expect(log.rightsBoundary).toContain("Original public sample");

    const source = await readFile(fromRoot(log.source.path));
    expect(source.byteLength).toBe(log.source.bytes);
    expect(hash(source)).toBe(log.source.sha256);
    for (const [relativePath, expectedHash] of Object.entries(log.outputSha256)) {
      const contents = await readFile(fromRoot(relativePath));
      expect(hash(contents), relativePath).toBe(expectedHash);
    }

    const canvas = project.frames.idle.find(Boolean)?.width ?? 0;
    const spriteMetadata = await sharp(path.join(directory, `${id}-spritesheet.png`)).metadata();
    expect(spriteMetadata.width).toBe(canvas * 4);
    expect(spriteMetadata.height).toBe(canvas * PET_ANIMATION_NAMES.length);
    const previewMetadata = await sharp(path.join(directory, "app-preview.png")).metadata();
    expect(previewMetadata.width).toBeGreaterThan(500);
    expect(previewMetadata.height).toBeGreaterThan(300);
    expect((await stat(path.join(directory, "app-preview.png"))).size).toBeGreaterThan(100_000);
  });
});

it("keeps the public RRA Pavi folder recipe-only with no mascot derivatives", async () => {
  const recipeDirectory = path.join(examplesRoot, "rra-pavi");
  const entries = await readdir(recipeDirectory, { recursive: true });
  expect(entries).toContain("README.md");
  expect(
    entries.filter((entry) =>
      /(?:\.pixelpet|\.png|\.jpe?g|\.webp|spritesheet|app-preview|run-log\.json)$/i.test(entry),
    ),
  ).toEqual([]);
});
