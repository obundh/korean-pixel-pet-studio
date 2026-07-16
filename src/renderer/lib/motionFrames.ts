import type { FrameAsset } from "../types";
import { removeImageBackground } from "./backgroundRemoval";
import { dataUrlToBlob, fileToDataUrl } from "./images";
import {
  calculateBottomCenterFit,
  detectFlatChromaKey,
  findRobustAlphaBounds,
  hasMeaningfulTransparency,
  parseCanvasSize,
  postprocessFlatChromaDataUrl,
  repairBoundaryChromaFringe,
  type AlphaBounds,
  type CanvasSize,
  type FitPlacement,
  type RgbColor,
} from "./quickPet";

export type MotionBackgroundStrategy =
  | "existing-cutout"
  | "flat-chroma"
  | "ai-removal";

export type MotionFrameProgress = {
  phase: "preparing" | "removing" | "aligning";
  current: number;
  total: number;
  ratio: number;
  frameName: string;
};

export type SharedMotionSource = {
  width: number;
  height: number;
  bounds: AlphaBounds;
  /** Robust body-row anchor; unlike the full bounds center, thin limbs do not dominate it. */
  anchorX?: number;
};

export type SharedMotionLayout = {
  sourceCanvas: CanvasSize;
  sourceOffsets: Array<{ x: number; y: number }>;
  sourceAnchors: number[];
  horizontalCorrections: number[];
  maxHorizontalCorrection: number;
  unionBounds: AlphaBounds;
  targetCanvas: CanvasSize;
  placement: FitPlacement;
};

export type PreparedMotionFrame = {
  frame: FrameAsset;
  originalDataUrl: string;
  cleanedDataUrl: string;
  width: number;
  height: number;
  bounds: AlphaBounds;
  anchorX?: number;
  strategy: MotionBackgroundStrategy;
  chromaKey?: [number, number, number];
};

export type MotionFrameProcessingResult = {
  frames: FrameAsset[];
  layout: SharedMotionLayout;
  aiRemovalCount: number;
  flatChromaCount: number;
  existingCutoutCount: number;
};

export type MotionFrameProcessingOptions = {
  frames: FrameAsset[];
  canvas?: string | CanvasSize;
  padding?: number;
  now?: () => string;
  onProgress?: (progress: MotionFrameProgress) => void;
};

export type MotionFrameProcessorDependencies = {
  prepareFrame: (
    frame: FrameAsset,
    reportRemovalProgress: (ratio: number) => void,
  ) => Promise<PreparedMotionFrame>;
  renderFrame: (
    frame: PreparedMotionFrame,
    layout: SharedMotionLayout,
    index: number,
  ) => Promise<{ dataUrl: string; originalDataUrl: string }>;
};

type BackgroundInspection = {
  strategy: MotionBackgroundStrategy;
  chromaKey?: RgbColor;
};

const loadImage = (source: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("동작 프레임 이미지를 읽지 못했습니다."));
    image.src = source;
  });

const createCanvas = (size: CanvasSize): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  return canvas;
};

const getContext = (canvas: HTMLCanvasElement): CanvasRenderingContext2D => {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("동작 프레임 처리용 캔버스를 만들지 못했습니다.");
  context.imageSmoothingEnabled = false;
  return context;
};

const rasterizeImage = (
  image: HTMLImageElement,
  size: CanvasSize = { width: image.naturalWidth, height: image.naturalHeight },
): HTMLCanvasElement => {
  const canvas = createCanvas(size);
  getContext(canvas).drawImage(image, 0, 0, size.width, size.height);
  return canvas;
};

const canvasToPngDataUrl = (canvas: HTMLCanvasElement): Promise<string> =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("정렬된 PNG 프레임을 만들지 못했습니다."));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("정렬된 PNG 프레임을 읽지 못했습니다."));
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(blob);
    }, "image/png");
  });

const chromaTuple = (color?: RgbColor): [number, number, number] | undefined =>
  color ? [color.red, color.green, color.blue] : undefined;

/**
 * Chooses the cheapest safe cleanup path. Deliberately flat prompt backgrounds
 * are hard-keyed directly; sending them through segmentation first creates a
 * dark hue-preserving rim around small sprites.
 */
export function inspectMotionBackground(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  knownChromaKey?: [number, number, number],
): BackgroundInspection {
  if (knownChromaKey) {
    return {
      strategy: "flat-chroma",
      chromaKey: {
        red: knownChromaKey[0],
        green: knownChromaKey[1],
        blue: knownChromaKey[2],
      },
    };
  }
  if (hasMeaningfulTransparency(rgba, width, height)) {
    return { strategy: "existing-cutout" };
  }
  const detected = detectFlatChromaKey(rgba, width, height);
  return detected
    ? { strategy: "flat-chroma", chromaKey: detected.color }
    : { strategy: "ai-removal" };
}

export function unionAlphaBounds(bounds: AlphaBounds[]): AlphaBounds | null {
  if (!bounds.length) return null;
  const left = Math.min(...bounds.map((item) => item.x));
  const top = Math.min(...bounds.map((item) => item.y));
  const right = Math.max(...bounds.map((item) => item.x + item.width - 1));
  const bottom = Math.max(...bounds.map((item) => item.y + item.height - 1));
  return {
    x: left,
    y: top,
    width: right - left + 1,
    height: bottom - top + 1,
  };
}

/**
 * Estimates the horizontal center of the character's stable body mass.
 *
 * Each sufficiently massive alpha row contributes the median x-coordinate of
 * its visible pixels. Taking the median again across rows prevents a raised
 * hand, tail, antenna, or other thin appendage from dragging the whole pose
 * sideways as a full alpha-bounds center would.
 */
export function findStableHorizontalAnchor(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  bounds: AlphaBounds,
  alphaThreshold = 8,
): number {
  if (rgba.length < width * height * 4 || width <= 0 || height <= 0) {
    return bounds.x + bounds.width / 2;
  }
  const rows: Array<{ y: number; center: number; mass: number }> = [];
  let largestRowMass = 0;
  const right = Math.min(width, bounds.x + bounds.width);
  const bottom = Math.min(height, bounds.y + bounds.height);
  for (let y = Math.max(0, bounds.y); y < bottom; y += 1) {
    let mass = 0;
    for (let x = Math.max(0, bounds.x); x < right; x += 1) {
      if (rgba[(y * width + x) * 4 + 3] <= alphaThreshold) continue;
      mass += 1;
    }
    if (!mass) continue;

    const lowerRank = Math.floor((mass - 1) / 2);
    const upperRank = Math.floor(mass / 2);
    let visibleRank = 0;
    let lowerX = -1;
    let upperX = -1;
    for (let x = Math.max(0, bounds.x); x < right; x += 1) {
      if (rgba[(y * width + x) * 4 + 3] <= alphaThreshold) continue;
      if (visibleRank === lowerRank) lowerX = x;
      if (visibleRank === upperRank) {
        upperX = x;
        break;
      }
      visibleRank += 1;
    }
    if (lowerX < 0 || upperX < 0) continue;
    largestRowMass = Math.max(largestRowMass, mass);
    rows.push({ y, center: (lowerX + upperX + 1) / 2, mass });
  }
  if (!rows.length) return bounds.x + bounds.width / 2;

  const minimumStableMass = Math.max(2, largestRowMass * 0.35);
  const coreTop = bounds.y + bounds.height * 0.1;
  const coreBottom = bounds.y + bounds.height * 0.9;
  let candidates = rows.filter(
    (row) =>
      row.y >= coreTop &&
      row.y <= coreBottom &&
      row.mass >= minimumStableMass,
  );
  if (candidates.length < 3) {
    candidates = rows.filter((row) => row.mass >= minimumStableMass);
  }
  if (!candidates.length) return bounds.x + bounds.width / 2;

  const centers = candidates.map((row) => row.center).sort((left, rightValue) => left - rightValue);
  const middle = Math.floor(centers.length / 2);
  return centers.length % 2 === 1
    ? centers[middle]
    : (centers[middle - 1] + centers[middle]) / 2;
}

/**
 * Builds one source coordinate system for every pose. Generated pose sheets
 * often drift a few pixels sideways from cell to cell even when the character
 * is meant to stand still. A robust body-row anchor ignores thin moving
 * appendages, and the correction is capped so a genuine asymmetric pose cannot
 * pull the whole character arbitrarily far. Vertical coordinates remain
 * authored (apart from bottom-aligning differently sized source canvases),
 * then one union crop and one output placement are applied to the sequence.
 */
export function calculateSharedMotionLayout(
  sources: SharedMotionSource[],
  target: CanvasSize,
  padding: number,
): SharedMotionLayout {
  if (!sources.length) throw new Error("정리할 동작 프레임이 없습니다.");
  const sourceAnchors = sources.map(
    (source) => source.anchorX ?? source.bounds.x + source.bounds.width / 2,
  );
  const sortedAnchors = [...sourceAnchors].sort((left, right) => left - right);
  const anchorMiddle = Math.floor(sortedAnchors.length / 2);
  const sharedHorizontalAnchor =
    sortedAnchors.length % 2 === 1
      ? sortedAnchors[anchorMiddle]
      : (sortedAnchors[anchorMiddle - 1] + sortedAnchors[anchorMiddle]) / 2;
  // Each pose may move at most 6.25% toward the shared anchor, keeping the
  // worst-case relative shift between two poses at or below 12.5%. Flooring
  // (and allowing zero for tiny cells) preserves that bound for every width.
  const maxHorizontalCorrection = Math.floor(
    Math.min(...sources.map((source) => source.width)) * 0.0625,
  );
  const horizontalCorrections = sourceAnchors.map((anchor) => {
    if (maxHorizontalCorrection === 0) return 0;
    const correction = Math.max(
      -maxHorizontalCorrection,
      Math.min(maxHorizontalCorrection, Math.round(sharedHorizontalAnchor - anchor)),
    );
    return correction === 0 ? 0 : correction;
  });
  const canvasShift = Math.max(0, -Math.min(...horizontalCorrections));
  const horizontalOffsets = horizontalCorrections.map(
    (correction) => correction + canvasShift,
  );
  const sourceCanvas = {
    width: Math.max(
      ...sources.map((source, index) => source.width + horizontalOffsets[index]),
    ),
    height: Math.max(...sources.map((source) => source.height)),
  };
  const sourceOffsets = sources.map((source, index) => ({
    x: horizontalOffsets[index],
    y: sourceCanvas.height - source.height,
  }));
  const mappedBounds = sources.map((source, index) => ({
    x: source.bounds.x + sourceOffsets[index].x,
    y: source.bounds.y + sourceOffsets[index].y,
    width: source.bounds.width,
    height: source.bounds.height,
  }));
  const unionBounds = unionAlphaBounds(mappedBounds);
  if (!unionBounds) throw new Error("투명화 결과에서 캐릭터를 찾지 못했습니다.");
  return {
    sourceCanvas,
    sourceOffsets,
    sourceAnchors,
    horizontalCorrections,
    maxHorizontalCorrection,
    unionBounds,
    targetCanvas: target,
    placement: calculateBottomCenterFit(unionBounds, target, padding),
  };
}

async function prepareFrameDefault(
  frame: FrameAsset,
  reportRemovalProgress: (ratio: number) => void,
): Promise<PreparedMotionFrame> {
  const originalImage = await loadImage(frame.originalDataUrl);
  const sourceSize = {
    width: originalImage.naturalWidth,
    height: originalImage.naturalHeight,
  };
  const originalCanvas = rasterizeImage(originalImage, sourceSize);
  const originalPixels = getContext(originalCanvas).getImageData(
    0,
    0,
    sourceSize.width,
    sourceSize.height,
  ).data;

  let strategy: MotionBackgroundStrategy;
  let cleanedDataUrl: string;
  let processedKey: RgbColor | undefined;

  if (frame.backgroundRemoved) {
    strategy = "existing-cutout";
    if (frame.chromaKey) {
      const forcedKey = {
        red: frame.chromaKey[0],
        green: frame.chromaKey[1],
        blue: frame.chromaKey[2],
      };
      const processed = await postprocessFlatChromaDataUrl(
        frame.originalDataUrl,
        frame.dataUrl,
        forcedKey,
      );
      cleanedDataUrl = processed.dataUrl;
      processedKey = processed.chromaCleanup.key?.color ?? forcedKey;
    } else {
      cleanedDataUrl = frame.dataUrl;
    }
  } else {
    const inspection = inspectMotionBackground(
      originalPixels,
      sourceSize.width,
      sourceSize.height,
      frame.chromaKey,
    );
    strategy = inspection.strategy;
    if (inspection.strategy === "flat-chroma" && inspection.chromaKey) {
      const processed = await postprocessFlatChromaDataUrl(
        frame.originalDataUrl,
        frame.originalDataUrl,
        inspection.chromaKey,
      );
      cleanedDataUrl = processed.dataUrl;
      processedKey = processed.chromaCleanup.key?.color ?? inspection.chromaKey;
    } else if (inspection.strategy === "existing-cutout") {
      cleanedDataUrl = frame.originalDataUrl;
    } else {
      const removed = await removeImageBackground(
        await dataUrlToBlob(frame.originalDataUrl),
        {
          onProgress: ({ ratio }) => reportRemovalProgress(ratio),
        },
      );
      const rawDataUrl = await fileToDataUrl(removed);
      const processed = await postprocessFlatChromaDataUrl(
        frame.originalDataUrl,
        rawDataUrl,
      );
      cleanedDataUrl = processed.dataUrl;
      processedKey = processed.chromaCleanup.key?.color;
    }
  }

  const cleanedImage = await loadImage(cleanedDataUrl);
  const cleanedSize = {
    width: cleanedImage.naturalWidth,
    height: cleanedImage.naturalHeight,
  };
  const cleanedCanvas = rasterizeImage(cleanedImage, cleanedSize);
  const cleanedPixels = getContext(cleanedCanvas).getImageData(
    0,
    0,
    cleanedSize.width,
    cleanedSize.height,
  ).data;
  const bounds = findRobustAlphaBounds(
    cleanedPixels,
    cleanedSize.width,
    cleanedSize.height,
  );
  if (!bounds) throw new Error(`${frame.name}: 투명화 결과에서 캐릭터를 찾지 못했습니다.`);

  return {
    frame,
    originalDataUrl: frame.originalDataUrl,
    cleanedDataUrl,
    width: cleanedSize.width,
    height: cleanedSize.height,
    bounds,
    anchorX: findStableHorizontalAnchor(
      cleanedPixels,
      cleanedSize.width,
      cleanedSize.height,
      bounds,
    ),
    strategy,
    chromaKey: chromaTuple(processedKey) ?? frame.chromaKey,
  };
}

async function renderFrameDefault(
  prepared: PreparedMotionFrame,
  layout: SharedMotionLayout,
  index: number,
): Promise<{ dataUrl: string; originalDataUrl: string }> {
  const [originalImage, cleanedImage] = await Promise.all([
    loadImage(prepared.originalDataUrl),
    loadImage(prepared.cleanedDataUrl),
  ]);
  const offset = layout.sourceOffsets[index];
  const render = (image: HTMLImageElement): HTMLCanvasElement => {
    const source = createCanvas(layout.sourceCanvas);
    getContext(source).drawImage(
      image,
      offset.x,
      offset.y,
      prepared.width,
      prepared.height,
    );
    const output = createCanvas(layout.targetCanvas);
    const { placement } = layout;
    const outputContext = getContext(output);
    outputContext.drawImage(
      source,
      placement.sourceX,
      placement.sourceY,
      placement.sourceWidth,
      placement.sourceHeight,
      placement.destinationX,
      placement.destinationY,
      placement.destinationWidth,
      placement.destinationHeight,
    );
    return output;
  };
  const originalOutput = render(originalImage);
  const cleanedOutput = render(cleanedImage);
  if (prepared.chromaKey) {
    const key = {
      red: prepared.chromaKey[0],
      green: prepared.chromaKey[1],
      blue: prepared.chromaKey[2],
    };
    const cleanedContext = getContext(cleanedOutput);
    const cleanedImageData = cleanedContext.getImageData(
      0,
      0,
      layout.targetCanvas.width,
      layout.targetCanvas.height,
    );
    const evidenceData = getContext(originalOutput).getImageData(
      0,
      0,
      layout.targetCanvas.width,
      layout.targetCanvas.height,
    ).data;
    const repaired = repairBoundaryChromaFringe(
      cleanedImageData.data,
      layout.targetCanvas.width,
      layout.targetCanvas.height,
      key,
      evidenceData,
    );
    const repairedCopy = new Uint8ClampedArray(repaired.length);
    repairedCopy.set(repaired);
    cleanedContext.putImageData(
      new ImageData(
        repairedCopy,
        layout.targetCanvas.width,
        layout.targetCanvas.height,
      ),
      0,
      0,
    );
  }
  const [originalDataUrl, dataUrl] = await Promise.all([
    canvasToPngDataUrl(originalOutput),
    canvasToPngDataUrl(cleanedOutput),
  ]);
  return { dataUrl, originalDataUrl };
}

const defaultDependencies: MotionFrameProcessorDependencies = {
  prepareFrame: prepareFrameDefault,
  renderFrame: renderFrameDefault,
};

export async function processMotionFrames(
  options: MotionFrameProcessingOptions,
  dependencies: MotionFrameProcessorDependencies = defaultDependencies,
): Promise<MotionFrameProcessingResult> {
  if (!options.frames.length) throw new Error("정리할 동작 프레임이 없습니다.");
  const total = options.frames.length;
  const report = (
    phase: MotionFrameProgress["phase"],
    current: number,
    frameName: string,
    localRatio = 0,
  ) => {
    options.onProgress?.({
      phase,
      current,
      total,
      frameName,
      ratio: Math.min(1, Math.max(0, (current + localRatio) / total)),
    });
  };

  const prepared: PreparedMotionFrame[] = [];
  for (let index = 0; index < total; index += 1) {
    const frame = options.frames[index];
    report("preparing", index, frame.name);
    prepared.push(
      await dependencies.prepareFrame(frame, (ratio) => {
        report("removing", index, frame.name, ratio);
      }),
    );
  }

  const targetCanvas = parseCanvasSize(options.canvas);
  const padding =
    options.padding ??
    Math.max(4, Math.round(Math.min(targetCanvas.width, targetCanvas.height) * 0.08));
  const layout = calculateSharedMotionLayout(prepared, targetCanvas, padding);
  const now = options.now ?? (() => new Date().toISOString());
  const frames: FrameAsset[] = [];
  for (let index = 0; index < total; index += 1) {
    const source = prepared[index];
    report("aligning", index, source.frame.name);
    const rendered = await dependencies.renderFrame(source, layout, index);
    frames.push({
      ...source.frame,
      ...rendered,
      width: targetCanvas.width,
      height: targetCanvas.height,
      backgroundRemoved: true,
      chromaKey: source.chromaKey,
      updatedAt: now(),
    });
  }
  report("aligning", total, prepared[total - 1].frame.name);

  return {
    frames,
    layout,
    aiRemovalCount: prepared.filter((frame) => frame.strategy === "ai-removal").length,
    flatChromaCount: prepared.filter((frame) => frame.strategy === "flat-chroma").length,
    existingCutoutCount: prepared.filter((frame) => frame.strategy === "existing-cutout").length,
  };
}
