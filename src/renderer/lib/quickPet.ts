import type { FrameAsset } from "../types";

export type CanvasSize = { width: number; height: number };
export type AlphaBounds = { x: number; y: number; width: number; height: number };
export type RgbColor = { red: number; green: number; blue: number };
export type FlatChromaKey = {
  color: RgbColor;
  borderUniformity: number;
  imageCoverage: number;
  saturation: number;
};
export type FitPlacement = {
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
  destinationX: number;
  destinationY: number;
  destinationWidth: number;
  destinationHeight: number;
};

export type IdleVariant = {
  id: "neutral" | "rise" | "hold" | "settle";
  label: string;
  translateY: number;
};

export type IdleVariantPlacement = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type QuickPetOptions = {
  originalDataUrl: string;
  cleanedDataUrl: string;
  sourceName: string;
  canvas?: string | CanvasSize;
  padding?: number;
  now?: () => string;
  makeId?: (variant: IdleVariant, index: number) => string;
};

export type QuickPetResult = {
  frames: FrameAsset[];
  canvas: CanvasSize;
  sourceBounds: AlphaBounds;
  chromaCleanup: {
    applied: boolean;
    hardAlpha: boolean;
    key?: FlatChromaKey;
  };
};

export type FlatChromaDataUrlResult = {
  dataUrl: string;
  chromaCleanup: QuickPetResult["chromaCleanup"];
};

const MIN_CANVAS_EDGE = 16;
const MAX_CANVAS_EDGE = 256;
export const QUICK_PET_FPS = 4;

export const IDLE_VARIANTS: readonly IdleVariant[] = [
  {
    id: "neutral",
    label: "neutral",
    translateY: 0,
  },
  {
    id: "rise",
    label: "rise-1px",
    translateY: -1,
  },
  {
    id: "hold",
    label: "hold-1px",
    translateY: -1,
  },
  {
    id: "settle",
    label: "settle",
    translateY: 0,
  },
] as const;

const clampCanvasEdge = (value: number): number =>
  Math.min(MAX_CANVAS_EDGE, Math.max(MIN_CANVAS_EDGE, Math.round(value)));

export function parseCanvasSize(
  value?: string | CanvasSize,
  fallback: CanvasSize = { width: 64, height: 64 },
): CanvasSize {
  if (typeof value === "object" && value) {
    return {
      width: clampCanvasEdge(value.width),
      height: clampCanvasEdge(value.height),
    };
  }

  if (typeof value === "string") {
    const dimensions = value.match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    if (dimensions.length > 0 && dimensions.every(Number.isFinite)) {
      return {
        width: clampCanvasEdge(dimensions[0]),
        height: clampCanvasEdge(dimensions[1] ?? dimensions[0]),
      };
    }
  }

  return {
    width: clampCanvasEdge(fallback.width),
    height: clampCanvasEdge(fallback.height),
  };
}

export function findAlphaBounds(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  alphaThreshold = 8,
): AlphaBounds | null {
  if (width <= 0 || height <= 0 || rgba.length < width * height * 4) return null;

  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (rgba[(y * width + x) * 4 + 3] <= alphaThreshold) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }

  if (right < left || bottom < top) return null;
  return {
    x: left,
    y: top,
    width: right - left + 1,
    height: bottom - top + 1,
  };
}

/**
 * Finds a crop that ignores isolated dust without discarding nearby ornaments
 * or substantial disconnected character parts.
 */
export function findRobustAlphaBounds(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  alphaThreshold = 8,
): AlphaBounds | null {
  if (width <= 0 || height <= 0 || rgba.length < width * height * 4) return null;
  const pixelCount = width * height;
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  const components: Array<AlphaBounds & { area: number }> = [];
  const isForeground = (pixel: number) => rgba[pixel * 4 + 3] > alphaThreshold;

  for (let start = 0; start < pixelCount; start += 1) {
    if (visited[start] || !isForeground(start)) continue;
    let head = 0;
    let tail = 0;
    let left = width;
    let top = height;
    let right = -1;
    let bottom = -1;
    visited[start] = 1;
    queue[tail] = start;
    tail += 1;
    while (head < tail) {
      const pixel = queue[head];
      head += 1;
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (offsetX === 0 && offsetY === 0) continue;
          const nextX = x + offsetX;
          const nextY = y + offsetY;
          if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
          const next = nextY * width + nextX;
          if (visited[next] || !isForeground(next)) continue;
          visited[next] = 1;
          queue[tail] = next;
          tail += 1;
        }
      }
    }
    components.push({
      x: left,
      y: top,
      width: right - left + 1,
      height: bottom - top + 1,
      area: tail,
    });
  }
  if (!components.length) return null;

  const primary = components.reduce((largest, component) =>
    component.area > largest.area ? component : largest,
  );
  const proximity = Math.max(2, Math.round(Math.max(primary.width, primary.height) * 0.2));
  const substantialArea = Math.max(4, Math.ceil(primary.area * 0.001));
  const expanded = {
    left: primary.x - proximity,
    top: primary.y - proximity,
    right: primary.x + primary.width - 1 + proximity,
    bottom: primary.y + primary.height - 1 + proximity,
  };
  const kept = components.filter((component) => {
    if (component === primary || component.area >= substantialArea) return true;
    if (component.area < 2) return false;
    const right = component.x + component.width - 1;
    const bottom = component.y + component.height - 1;
    return !(
      right < expanded.left ||
      component.x > expanded.right ||
      bottom < expanded.top ||
      component.y > expanded.bottom
    );
  });
  const left = Math.min(...kept.map((component) => component.x));
  const top = Math.min(...kept.map((component) => component.y));
  const right = Math.max(...kept.map((component) => component.x + component.width - 1));
  const bottom = Math.max(...kept.map((component) => component.y + component.height - 1));
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

export function hasMeaningfulTransparency(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  minimumRatio = 0.05,
  alphaThreshold = 8,
  maximumBoundsCoverage = 0.9,
): boolean {
  const pixels = width * height;
  if (width <= 0 || height <= 0 || rgba.length < pixels * 4) return false;

  // Only transparency connected to the image edge is a reliable signal that
  // the background was already removed. Internal holes (eyes, handles, etc.)
  // must not make an opaque-background image bypass segmentation.
  const visited = new Uint8Array(pixels);
  const queue = new Int32Array(pixels);
  let head = 0;
  let tail = 0;
  const enqueue = (pixel: number) => {
    if (visited[pixel] || rgba[pixel * 4 + 3] > alphaThreshold) return;
    visited[pixel] = 1;
    queue[tail] = pixel;
    tail += 1;
  };
  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }

  while (head < tail) {
    const pixel = queue[head];
    head += 1;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    if (x > 0) enqueue(pixel - 1);
    if (x + 1 < width) enqueue(pixel + 1);
    if (y > 0) enqueue(pixel - width);
    if (y + 1 < height) enqueue(pixel + width);
  }

  if (tail / pixels < minimumRatio) return false;
  const bounds = findAlphaBounds(rgba, width, height, alphaThreshold);
  if (!bounds) return false;
  return (bounds.width * bounds.height) / pixels <= maximumBoundsCoverage;
}

export function colorDistance(red: number, green: number, blue: number, key: RgbColor): number {
  return Math.hypot(red - key.red, green - key.green, blue - key.blue);
}

const rgbToHsv = (red: number, green: number, blue: number) => {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const maximum = Math.max(r, g, b);
  const minimum = Math.min(r, g, b);
  const delta = maximum - minimum;
  let hue = 0;
  if (delta > 0) {
    if (maximum === r) hue = 60 * (((g - b) / delta) % 6);
    else if (maximum === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
  }
  if (hue < 0) hue += 360;
  return {
    hue,
    saturation: maximum > 0 ? delta / maximum : 0,
    value: maximum,
  };
};

const hueDistance = (left: number, right: number): number => {
  const distance = Math.abs(left - right);
  return Math.min(distance, 360 - distance);
};

const chromaDirectionSimilarity = (
  red: number,
  green: number,
  blue: number,
  key: RgbColor,
): number => {
  const pixelMinimum = Math.min(red, green, blue);
  const keyMinimum = Math.min(key.red, key.green, key.blue);
  const pixelVector = [red - pixelMinimum, green - pixelMinimum, blue - pixelMinimum];
  const keyVector = [
    key.red - keyMinimum,
    key.green - keyMinimum,
    key.blue - keyMinimum,
  ];
  const pixelLength = Math.hypot(...pixelVector);
  const keyLength = Math.hypot(...keyVector);
  if (pixelLength === 0 || keyLength === 0) return 0;
  return (
    (pixelVector[0] * keyVector[0] +
      pixelVector[1] * keyVector[1] +
      pixelVector[2] * keyVector[2]) /
    (pixelLength * keyLength)
  );
};

const isChromaLike = (red: number, green: number, blue: number, key: RgbColor): boolean => {
  if (colorDistance(red, green, blue, key) < 80) return true;
  const keyHsv = rgbToHsv(key.red, key.green, key.blue);
  const pixel = rgbToHsv(red, green, blue);
  return (
    keyHsv.saturation >= 0.5 &&
    pixel.saturation >= Math.max(0.35, keyHsv.saturation * 0.45) &&
    pixel.value >= 0.08 &&
    hueDistance(pixel.hue, keyHsv.hue) <= 18
  );
};

const isExtendedChromaLike = (
  red: number,
  green: number,
  blue: number,
  key: RgbColor,
): boolean => {
  const keyHsv = rgbToHsv(key.red, key.green, key.blue);
  const pixel = rgbToHsv(red, green, blue);
  return (
    keyHsv.saturation >= 0.5 &&
    pixel.saturation >= Math.max(0.35, keyHsv.saturation * 0.45) &&
    pixel.value >= 0.08 &&
    hueDistance(pixel.hue, keyHsv.hue) <= 52 &&
    chromaDirectionSimilarity(red, green, blue, key) >= 0.86
  );
};

const isEvidenceChromaLike = (
  red: number,
  green: number,
  blue: number,
  key: RgbColor,
): boolean => {
  const keyHsv = rgbToHsv(key.red, key.green, key.blue);
  const pixel = rgbToHsv(red, green, blue);
  return (
    keyHsv.saturation >= 0.5 &&
    pixel.saturation >= Math.max(0.2, keyHsv.saturation * 0.2) &&
    pixel.value >= 0.08 &&
    hueDistance(pixel.hue, keyHsv.hue) <= 65 &&
    chromaDirectionSimilarity(red, green, blue, key) >= 0.81
  );
};

const hasNearbyKeyEvidence = (
  rgba: Uint8ClampedArray,
  x: number,
  y: number,
  width: number,
  height: number,
  key: RgbColor,
  radius = 2,
): boolean => {
  for (let nextY = Math.max(0, y - radius); nextY <= Math.min(height - 1, y + radius); nextY += 1) {
    for (
      let nextX = Math.max(0, x - radius);
      nextX <= Math.min(width - 1, x + radius);
      nextX += 1
    ) {
      const index = (nextY * width + nextX) * 4;
      if (
        rgba[index + 3] > 8 &&
        colorDistance(rgba[index], rgba[index + 1], rgba[index + 2], key) <= 72
      ) {
        return true;
      }
    }
  }
  return false;
};

const hasKeyContaminationEvidence = (
  evidenceRgba: Uint8ClampedArray,
  cleanedRgba: Uint8ClampedArray,
  x: number,
  y: number,
  width: number,
  height: number,
  key: RgbColor,
): boolean => {
  if (!hasNearbyKeyEvidence(evidenceRgba, x, y, width, height, key)) return false;
  const index = (y * width + x) * 4;
  const evidenceDistance = colorDistance(
    evidenceRgba[index],
    evidenceRgba[index + 1],
    evidenceRgba[index + 2],
    key,
  );
  const cleanedDistance = colorDistance(
    cleanedRgba[index],
    cleanedRgba[index + 1],
    cleanedRgba[index + 2],
    key,
  );
  return evidenceDistance <= 150 || evidenceDistance + 18 < cleanedDistance;
};

const hasSafePaletteWitness = (
  evidenceRgba: Uint8ClampedArray,
  cleanedRgba: Uint8ClampedArray,
  x: number,
  y: number,
  width: number,
  height: number,
  key: RgbColor,
  // Only immediate continuity is evidence that a despilled pixel belongs to
  // this local outline. A distant matching color may be an unrelated detail.
  radius = Math.min(3, Math.max(width, height)),
): boolean => {
  const candidateIndex = (y * width + x) * 4;
  for (
    let nextY = Math.max(0, y - radius);
    nextY <= Math.min(height - 1, y + radius);
    nextY += 1
  ) {
    for (
      let nextX = Math.max(0, x - radius);
      nextX <= Math.min(width - 1, x + radius);
      nextX += 1
    ) {
      if (nextX === x && nextY === y) continue;
      const nextIndex = (nextY * width + nextX) * 4;
      if (cleanedRgba[nextIndex + 3] <= 8 || evidenceRgba[nextIndex + 3] <= 8) continue;
      if (
        Math.hypot(
          cleanedRgba[nextIndex] - cleanedRgba[candidateIndex],
          cleanedRgba[nextIndex + 1] - cleanedRgba[candidateIndex + 1],
          cleanedRgba[nextIndex + 2] - cleanedRgba[candidateIndex + 2],
        ) > 12
      ) {
        continue;
      }
      if (
        Math.hypot(
          evidenceRgba[nextIndex] - cleanedRgba[nextIndex],
          evidenceRgba[nextIndex + 1] - cleanedRgba[nextIndex + 1],
          evidenceRgba[nextIndex + 2] - cleanedRgba[nextIndex + 2],
        ) > 16
      ) {
        continue;
      }
      if (
        !hasKeyContaminationEvidence(
          evidenceRgba,
          cleanedRgba,
          nextX,
          nextY,
          width,
          height,
          key,
        )
      ) {
        return true;
      }
    }
  }
  return false;
};

/**
 * Generated chroma sheets can leave a dark purple/red/green outline whose hue
 * has moved too far from the bright key for a simple RGB threshold. Only
 * key-like pixels connected to the transparent exterior are repaired. Their
 * color is borrowed from the nearest safe foreground pixel, preserving the
 * silhouette and leaving similarly colored interior details untouched.
 */
export function repairBoundaryChromaFringe(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  key: RgbColor,
  evidenceRgba?: Uint8ClampedArray,
): Uint8ClampedArray {
  if (
    !Number.isInteger(width) ||
    width <= 0 ||
    !Number.isInteger(height) ||
    height <= 0 ||
    rgba.length !== width * height * 4
  ) {
    throw new Error("크로마 경계 보정 이미지의 크기가 올바르지 않습니다.");
  }
  if (evidenceRgba && evidenceRgba.length !== rgba.length) {
    throw new Error("크로마 경계 증거 이미지의 크기가 서로 다릅니다.");
  }

  const pixels = width * height;
  const source = new Uint8ClampedArray(rgba);
  const suspicious = new Uint8Array(pixels);
  const evidenceBacked = new Uint8Array(pixels);
  const repair = new Uint8Array(pixels);
  const depths = new Int8Array(pixels);
  depths.fill(-1);
  const queue = new Int32Array(pixels);
  let head = 0;
  let tail = 0;
  const isVisible = (pixel: number) => source[pixel * 4 + 3] > 8;
  const isExteriorBoundary = (pixel: number): boolean => {
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        if (offsetX === 0 && offsetY === 0) continue;
        const nextX = x + offsetX;
        const nextY = y + offsetY;
        if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) return true;
        if (!isVisible(nextY * width + nextX)) return true;
      }
    }
    return false;
  };

  for (let pixel = 0; pixel < pixels; pixel += 1) {
    if (!isVisible(pixel)) continue;
    const index = pixel * 4;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const hasEvidence =
      evidenceRgba &&
      hasKeyContaminationEvidence(
        evidenceRgba,
        source,
        x,
        y,
        width,
        height,
        key,
      );
    if (hasEvidence) evidenceBacked[pixel] = 1;
    const hasSafeWitness =
      hasEvidence &&
      hasSafePaletteWitness(
        evidenceRgba,
        source,
        x,
        y,
        width,
        height,
        key,
      );
    if (
      isExtendedChromaLike(source[index], source[index + 1], source[index + 2], key) ||
      (hasEvidence &&
        !hasSafeWitness &&
        isEvidenceChromaLike(source[index], source[index + 1], source[index + 2], key))
    ) {
      suspicious[pixel] = 1;
    }
  }
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    if (!suspicious[pixel]) continue;
    if (!isExteriorBoundary(pixel) && !evidenceBacked[pixel]) continue;
    repair[pixel] = 1;
    depths[pixel] = 0;
    queue[tail] = pixel;
    tail += 1;
  }

  const maximumDepth = 4;
  while (head < tail) {
    const pixel = queue[head];
    head += 1;
    if (depths[pixel] >= maximumDepth) continue;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        if (offsetX === 0 && offsetY === 0) continue;
        const nextX = x + offsetX;
        const nextY = y + offsetY;
        if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) continue;
        const next = nextY * width + nextX;
        if (!suspicious[next] || repair[next]) continue;
        repair[next] = 1;
        depths[next] = depths[pixel] + 1;
        queue[tail] = next;
        tail += 1;
      }
    }
  }

  const output = new Uint8ClampedArray(source);
  const maximumRadius = 12;
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    if (!repair[pixel]) continue;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const index = pixel * 4;
    let bestPixel = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let radius = 1; radius <= maximumRadius; radius += 1) {
      const minimumX = Math.max(0, x - radius);
      const maximumX = Math.min(width - 1, x + radius);
      const minimumY = Math.max(0, y - radius);
      const maximumY = Math.min(height - 1, y + radius);
      for (let nextY = minimumY; nextY <= maximumY; nextY += 1) {
        for (let nextX = minimumX; nextX <= maximumX; nextX += 1) {
          if (
            nextX !== minimumX &&
            nextX !== maximumX &&
            nextY !== minimumY &&
            nextY !== maximumY
          ) {
            continue;
          }
          const next = nextY * width + nextX;
          if (!isVisible(next) || repair[next] || suspicious[next]) continue;
          const nextIndex = next * 4;
          const spatialDistance = Math.hypot(nextX - x, nextY - y);
          const colorDifference = Math.hypot(
            source[nextIndex] - source[index],
            source[nextIndex + 1] - source[index + 1],
            source[nextIndex + 2] - source[index + 2],
          );
          const score = spatialDistance * 18 + colorDifference;
          if (score < bestScore) {
            bestScore = score;
            bestPixel = next;
          }
        }
      }
      if (bestPixel >= 0 && radius >= 3) break;
    }

    if (bestPixel < 0) {
      output[index] = 0;
      output[index + 1] = 0;
      output[index + 2] = 0;
      output[index + 3] = 0;
      continue;
    }
    const bestIndex = bestPixel * 4;
    output[index] = source[bestIndex];
    output[index + 1] = source[bestIndex + 1];
    output[index + 2] = source[bestIndex + 2];
    output[index + 3] = 255;
  }
  return output;
}

/** Detects the deliberately flat, saturated key backgrounds used by PixelPet prompts. */
export function detectFlatChromaKey(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): FlatChromaKey | null {
  if (width <= 0 || height <= 0 || rgba.length < width * height * 4) return null;
  const thickness = Math.max(1, Math.round(Math.min(width, height) * 0.02));
  let red = 0;
  let green = 0;
  let blue = 0;
  let samples = 0;
  const borderPixels =
    width * height -
    Math.max(0, width - thickness * 2) * Math.max(0, height - thickness * 2);

  const visitBorder = (visitor: (index: number) => void) => {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (x >= thickness && x < width - thickness && y >= thickness && y < height - thickness) {
          continue;
        }
        visitor((y * width + x) * 4);
      }
    }
  };

  visitBorder((index) => {
    if (rgba[index + 3] < 250) return;
    red += rgba[index];
    green += rgba[index + 1];
    blue += rgba[index + 2];
    samples += 1;
  });
  if (!samples) return null;

  const color = {
    red: Math.round(red / samples),
    green: Math.round(green / samples),
    blue: Math.round(blue / samples),
  };
  const maximum = Math.max(color.red, color.green, color.blue);
  const minimum = Math.min(color.red, color.green, color.blue);
  const saturation = maximum > 0 ? (maximum - minimum) / maximum : 0;
  if (maximum < 150 || saturation < 0.45) return null;

  let matchingBorder = 0;
  visitBorder((index) => {
    if (
      rgba[index + 3] >= 250 &&
      colorDistance(rgba[index], rgba[index + 1], rgba[index + 2], color) <= 24
    ) {
      matchingBorder += 1;
    }
  });
  // Transparent margins must count against a chroma background. Otherwise a
  // saturated character touching one edge could be mistaken for the key.
  const borderUniformity = matchingBorder / borderPixels;
  if (borderUniformity < 0.92) return null;

  let matchingImage = 0;
  const pixels = width * height;
  for (let index = 0; index < pixels * 4; index += 4) {
    if (
      rgba[index + 3] >= 250 &&
      colorDistance(rgba[index], rgba[index + 1], rgba[index + 2], color) <= 24
    ) {
      matchingImage += 1;
    }
  }
  const imageCoverage = matchingImage / pixels;
  if (imageCoverage < 0.2) return null;

  return { color, borderUniformity, imageCoverage, saturation };
}

/**
 * Removes the small key-colored rim left after segmentation. This deliberately
 * applies only after `detectFlatChromaKey` succeeds; ordinary photos retain
 * IMG.LY's soft alpha and colors.
 */
export function cleanupFlatChroma(
  original: Uint8ClampedArray,
  cleaned: Uint8ClampedArray,
  key: RgbColor,
  width?: number,
  height?: number,
): Uint8ClampedArray {
  if (original.length !== cleaned.length || original.length % 4 !== 0) {
    throw new Error("크로마 정리 이미지의 크기가 서로 다릅니다.");
  }
  const output = new Uint8ClampedArray(cleaned.length);
  const clampChannel = (value: number) => Math.min(255, Math.max(0, Math.round(value)));

  for (let index = 0; index < original.length; index += 4) {
    if (original[index + 3] <= 8) continue;
    const distance = colorDistance(
      original[index],
      original[index + 1],
      original[index + 2],
      key,
    );
    const modelAlpha = cleaned[index + 3];
    const distanceConfidence = Math.min(1, Math.max(0, (distance - 32) / 118));
    const foreground =
      distance > 32 &&
      (distance >= 150 ||
        (modelAlpha > 8 &&
          distanceConfidence * 0.78 + (modelAlpha / 255) * 0.22 >= 0.46));
    if (!foreground) continue;

    if (distance < 170) {
      const foregroundWeight = Math.min(1, Math.max(0.15, (distance - 20) / 150));
      output[index] = clampChannel(
        (original[index] - (1 - foregroundWeight) * key.red) / foregroundWeight,
      );
      output[index + 1] = clampChannel(
        (original[index + 1] - (1 - foregroundWeight) * key.green) / foregroundWeight,
      );
      output[index + 2] = clampChannel(
        (original[index + 2] - (1 - foregroundWeight) * key.blue) / foregroundWeight,
      );
    } else {
      output[index] = original[index];
      output[index + 1] = original[index + 1];
      output[index + 2] = original[index + 2];
    }

    // Chroma spill often becomes much darker than the original key, making an
    // RGB-only threshold miss a visible purple/green rim. Match the quality
    // gate's hue/saturation/value rule before hardening the final alpha.
    if (
      isChromaLike(output[index], output[index + 1], output[index + 2], key) &&
      (!width || !height)
    ) {
      output[index] = 0;
      output[index + 1] = 0;
      output[index + 2] = 0;
      output[index + 3] = 0;
    } else {
      output[index + 3] = 255;
    }
  }
  return width && height
    ? repairBoundaryChromaFringe(output, width, height, key, original)
    : output;
}

export function calculateBottomCenterFit(
  source: AlphaBounds,
  target: CanvasSize,
  padding: number,
): FitPlacement {
  const safePadding = Math.max(
    0,
    Math.min(Math.floor(Math.min(target.width, target.height) / 3), Math.round(padding)),
  );
  const availableWidth = Math.max(1, target.width - safePadding * 2);
  const availableHeight = Math.max(1, target.height - safePadding * 2);
  const scale = Math.min(availableWidth / source.width, availableHeight / source.height);
  const destinationWidth = Math.max(1, Math.round(source.width * scale));
  const destinationHeight = Math.max(1, Math.round(source.height * scale));

  return {
    sourceX: source.x,
    sourceY: source.y,
    sourceWidth: source.width,
    sourceHeight: source.height,
    destinationX: Math.round((target.width - destinationWidth) / 2),
    destinationY: target.height - safePadding - destinationHeight,
    destinationWidth,
    destinationHeight,
  };
}

export function idleVariantPlacement(
  canvas: CanvasSize,
  variant: IdleVariant,
): IdleVariantPlacement {
  return {
    x: 0,
    y: Math.round(variant.translateY),
    width: canvas.width,
    height: canvas.height,
  };
}

const loadImage = (source: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("마스코트 이미지를 읽지 못했습니다."));
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
  if (!context) throw new Error("이미지 처리용 캔버스를 만들지 못했습니다.");
  context.imageSmoothingEnabled = false;
  return context;
};

const canvasToPngDataUrl = (canvas: HTMLCanvasElement): Promise<string> =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("PNG 프레임을 만들지 못했습니다."));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("PNG 프레임을 읽지 못했습니다."));
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(blob);
    }, "image/png");
  });

const rasterizeImage = (image: HTMLImageElement, size?: CanvasSize): HTMLCanvasElement => {
  const canvas = createCanvas(
    size ?? { width: image.naturalWidth, height: image.naturalHeight },
  );
  const context = getContext(canvas);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
};

const canvasPixels = (canvas: HTMLCanvasElement): Uint8ClampedArray =>
  getContext(canvas).getImageData(0, 0, canvas.width, canvas.height).data;

const replaceCanvasPixels = (
  canvas: HTMLCanvasElement,
  pixels: Uint8ClampedArray,
): void => {
  const copy = new Uint8ClampedArray(pixels.length);
  copy.set(pixels);
  getContext(canvas).putImageData(new ImageData(copy, canvas.width, canvas.height), 0, 0);
};

export async function imageHasMeaningfulTransparency(dataUrl: string): Promise<boolean> {
  const image = await loadImage(dataUrl);
  const canvas = rasterizeImage(image);
  return hasMeaningfulTransparency(
    canvasPixels(canvas),
    canvas.width,
    canvas.height,
  );
}

/** Applies the same flat-key edge cleanup used by quick-pet to a manual result. */
export async function postprocessFlatChromaDataUrl(
  originalDataUrl: string,
  cleanedDataUrl: string,
  forcedKey?: RgbColor,
): Promise<FlatChromaDataUrlResult> {
  const [originalImage, cleanedImage] = await Promise.all([
    loadImage(originalDataUrl),
    loadImage(cleanedDataUrl),
  ]);
  const size = { width: cleanedImage.naturalWidth, height: cleanedImage.naturalHeight };
  const originalCanvas = rasterizeImage(originalImage, size);
  const cleanedCanvas = rasterizeImage(cleanedImage, size);
  const originalPixels = canvasPixels(originalCanvas);
  const detectedKey = forcedKey
    ? {
        color: forcedKey,
        borderUniformity: 1,
        imageCoverage: 1,
        saturation: 1,
      }
    : hasMeaningfulTransparency(originalPixels, size.width, size.height)
      ? null
      : detectFlatChromaKey(originalPixels, size.width, size.height);
  if (!detectedKey) {
    return {
      dataUrl: cleanedDataUrl,
      chromaCleanup: { applied: false, hardAlpha: false },
    };
  }

  const cleanedPixels = cleanupFlatChroma(
    originalPixels,
    canvasPixels(cleanedCanvas),
    detectedKey.color,
    size.width,
    size.height,
  );
  replaceCanvasPixels(cleanedCanvas, cleanedPixels);
  return {
    dataUrl: await canvasToPngDataUrl(cleanedCanvas),
    chromaCleanup: { applied: true, hardAlpha: true, key: detectedKey },
  };
}

function normalizedImage(
  image: CanvasImageSource,
  placement: FitPlacement,
  target: CanvasSize,
): HTMLCanvasElement {
  const canvas = createCanvas(target);
  const context = getContext(canvas);
  context.drawImage(
    image,
    placement.sourceX,
    placement.sourceY,
    placement.sourceWidth,
    placement.sourceHeight,
    placement.destinationX,
    placement.destinationY,
    placement.destinationWidth,
    placement.destinationHeight,
  );
  return canvas;
}

async function transformedDataUrl(
  source: HTMLCanvasElement,
  target: CanvasSize,
  variant: IdleVariant,
): Promise<string> {
  const canvas = createCanvas(target);
  const context = getContext(canvas);
  const placement = idleVariantPlacement(target, variant);
  // A one-image quick pet cannot synthesize real limb or breathing poses.
  // Preserve every source pixel and use only a one-pixel, integer translation
  // so the mascot never stretches, squashes, or gains subpixel blur.
  context.drawImage(source, placement.x, placement.y);
  return canvasToPngDataUrl(canvas);
}

/**
 * Creates a small, identity-preserving idle loop from one cleaned mascot.
 * The cleaned image determines the crop. That exact crop is applied to both
 * the original and cleaned images so the manual "restore" action remains
 * geometrically aligned with every generated frame. Frames retain the exact
 * normalized dimensions and differ only by integer translation.
 */
export async function createQuickPetFrames(options: QuickPetOptions): Promise<QuickPetResult> {
  const [originalImage, cleanedImage] = await Promise.all([
    loadImage(options.originalDataUrl),
    loadImage(options.cleanedDataUrl),
  ]);
  const cleanedSize = {
    width: cleanedImage.naturalWidth,
    height: cleanedImage.naturalHeight,
  };
  const originalCanvas = rasterizeImage(originalImage, cleanedSize);
  const cleanedCanvas = rasterizeImage(cleanedImage, cleanedSize);
  const originalPixels = canvasPixels(originalCanvas);
  let cleanedPixels = canvasPixels(cleanedCanvas);
  const chromaKey = hasMeaningfulTransparency(
    originalPixels,
    cleanedSize.width,
    cleanedSize.height,
  )
    ? null
    : detectFlatChromaKey(originalPixels, cleanedSize.width, cleanedSize.height);
  if (chromaKey) {
    cleanedPixels = cleanupFlatChroma(
      originalPixels,
      cleanedPixels,
      chromaKey.color,
      cleanedSize.width,
      cleanedSize.height,
    );
    replaceCanvasPixels(cleanedCanvas, cleanedPixels);
  }
  const sourceBounds = findRobustAlphaBounds(
    cleanedPixels,
    cleanedSize.width,
    cleanedSize.height,
  );
  if (!sourceBounds) throw new Error("투명화 결과에서 마스코트를 찾지 못했습니다.");

  const canvas = parseCanvasSize(options.canvas);
  const padding =
    options.padding ?? Math.max(4, Math.round(Math.min(canvas.width, canvas.height) * 0.08));
  const placement = calculateBottomCenterFit(sourceBounds, canvas, padding);
  const normalizedOriginal = normalizedImage(originalCanvas, placement, canvas);
  const normalizedCleaned = normalizedImage(cleanedCanvas, placement, canvas);
  if (chromaKey) {
    replaceCanvasPixels(
      normalizedCleaned,
      repairBoundaryChromaFringe(
        canvasPixels(normalizedCleaned),
        canvas.width,
        canvas.height,
        chromaKey.color,
        canvasPixels(normalizedOriginal),
      ),
    );
  }
  const now = options.now ?? (() => new Date().toISOString());
  const makeId =
    options.makeId ??
    ((variant: IdleVariant, index: number) =>
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `quick-idle-${variant.id}-${Date.now()}-${index}`);
  const stem = options.sourceName.replace(/\.[^.]+$/, "") || "mascot";
  const chromaKeyTuple: [number, number, number] | undefined = chromaKey
    ? [chromaKey.color.red, chromaKey.color.green, chromaKey.color.blue]
    : undefined;

  const frames = await Promise.all(
    IDLE_VARIANTS.map(async (variant, index): Promise<FrameAsset> => ({
      id: makeId(variant, index),
      name: `${stem}-idle-${String(index + 1).padStart(2, "0")}-${variant.label}.png`,
      dataUrl: await transformedDataUrl(normalizedCleaned, canvas, variant),
      originalDataUrl: await transformedDataUrl(normalizedOriginal, canvas, variant),
      width: canvas.width,
      height: canvas.height,
      backgroundRemoved: true,
      chromaKey: chromaKeyTuple,
      updatedAt: now(),
    })),
  );

  return {
    frames,
    canvas,
    sourceBounds,
    chromaCleanup: {
      applied: Boolean(chromaKey),
      hardAlpha: Boolean(chromaKey),
      key: chromaKey ?? undefined,
    },
  };
}
