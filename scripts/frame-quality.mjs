import { pathToFileURL } from "node:url";

const DEFAULTS = Object.freeze({
  alphaThreshold: 8,
  maxSoftAlphaPixels: 0,
  maxChromaFringePixels: 0,
  maxCentroidJumpRatio: 0.05,
  maxBaselineJumpRatio: 0.04,
  normalizedGridSize: 32,
});

const round = (value, digits = 4) => Number(value.toFixed(digits));
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

function rgbToHsv(red, green, blue) {
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
}

function hueDistance(left, right) {
  const distance = Math.abs(left - right);
  return Math.min(distance, 360 - distance);
}

function chromaDirectionSimilarity(red, green, blue, keyRgb) {
  const pixelMinimum = Math.min(red, green, blue);
  const keyMinimum = Math.min(...keyRgb);
  const pixelVector = [red - pixelMinimum, green - pixelMinimum, blue - pixelMinimum];
  const keyVector = keyRgb.map((channel) => channel - keyMinimum);
  const pixelLength = Math.hypot(...pixelVector);
  const keyLength = Math.hypot(...keyVector);
  if (pixelLength === 0 || keyLength === 0) return 0;
  return (
    (pixelVector[0] * keyVector[0] +
      pixelVector[1] * keyVector[1] +
      pixelVector[2] * keyVector[2]) /
    (pixelLength * keyLength)
  );
}

function pixelOffset(x, y, width) {
  return (y * width + x) * 4;
}

function hasNearbyKeyEvidence(
  evidenceRgba,
  x,
  y,
  width,
  height,
  keyRgb,
  radius = 2,
) {
  if (!evidenceRgba || !keyRgb) return false;
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
      const index = pixelOffset(nextX, nextY, width);
      if (
        evidenceRgba[index + 3] > 8 &&
        Math.hypot(
          evidenceRgba[index] - keyRgb[0],
          evidenceRgba[index + 1] - keyRgb[1],
          evidenceRgba[index + 2] - keyRgb[2],
        ) <= 72
      ) {
        return true;
      }
    }
  }
  return false;
}

function hasKeyContaminationEvidence(
  evidenceRgba,
  cleanedRgba,
  x,
  y,
  width,
  height,
  keyRgb,
) {
  if (
    !evidenceRgba ||
    !keyRgb ||
    !hasNearbyKeyEvidence(evidenceRgba, x, y, width, height, keyRgb)
  ) {
    return false;
  }
  const index = pixelOffset(x, y, width);
  const evidenceDistance = Math.hypot(
    evidenceRgba[index] - keyRgb[0],
    evidenceRgba[index + 1] - keyRgb[1],
    evidenceRgba[index + 2] - keyRgb[2],
  );
  const cleanedDistance = Math.hypot(
    cleanedRgba[index] - keyRgb[0],
    cleanedRgba[index + 1] - keyRgb[1],
    cleanedRgba[index + 2] - keyRgb[2],
  );
  return evidenceDistance <= 150 || evidenceDistance + 18 < cleanedDistance;
}

function hasSafePaletteWitness(
  evidenceRgba,
  cleanedRgba,
  x,
  y,
  width,
  height,
  keyRgb,
  // Keep this identical to the renderer cleanup: only immediate palette
  // continuity can excuse an evidence-backed chroma-like pixel.
  radius = Math.min(3, Math.max(width, height)),
) {
  if (!evidenceRgba || !keyRgb) return false;
  const candidateIndex = pixelOffset(x, y, width);
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
      const nextIndex = pixelOffset(nextX, nextY, width);
      if (cleanedRgba[nextIndex + 3] <= 8 || evidenceRgba[nextIndex + 3] <= 8) {
        continue;
      }
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
          keyRgb,
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function isBoundaryPixel(rgba, x, y, width, height, alphaThreshold) {
  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      if (offsetX === 0 && offsetY === 0) continue;
      const nextX = x + offsetX;
      const nextY = y + offsetY;
      if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) return true;
      if (rgba[pixelOffset(nextX, nextY, width) + 3] <= alphaThreshold) return true;
    }
  }
  return false;
}

/**
 * Chroma spill becomes much darker after segmentation/despill, so an absolute
 * RGB distance alone misses the visible purple/green rim. Restricting this
 * hue and chroma-direction checks to the foreground boundary avoids treating
 * interior colors or an ordinary dark-brown outline as background residue.
 */
export function isChromaLike(red, green, blue, keyRgb) {
  if (!keyRgb) return false;
  const euclideanDistance = Math.hypot(
    red - keyRgb[0],
    green - keyRgb[1],
    blue - keyRgb[2],
  );
  if (euclideanDistance <= 95) return true;

  const key = rgbToHsv(keyRgb[0], keyRgb[1], keyRgb[2]);
  const pixel = rgbToHsv(red, green, blue);
  return (
    key.saturation >= 0.5 &&
    pixel.saturation >= Math.max(0.35, key.saturation * 0.45) &&
    pixel.value >= 0.08 &&
    hueDistance(pixel.hue, key.hue) <= 52 &&
    chromaDirectionSimilarity(red, green, blue, keyRgb) >= 0.86
  );
}

function isEvidenceChromaLike(red, green, blue, keyRgb) {
  if (!keyRgb) return false;
  const key = rgbToHsv(keyRgb[0], keyRgb[1], keyRgb[2]);
  const pixel = rgbToHsv(red, green, blue);
  return (
    key.saturation >= 0.5 &&
    pixel.saturation >= Math.max(0.2, key.saturation * 0.2) &&
    pixel.value >= 0.08 &&
    hueDistance(pixel.hue, key.hue) <= 65 &&
    chromaDirectionSimilarity(red, green, blue, keyRgb) >= 0.81
  );
}

export function inspectRgbaFrame(frame, options = {}) {
  const settings = { ...DEFAULTS, ...options };
  const {
    rgba,
    evidenceRgba = null,
    width,
    height,
    keyRgb = null,
    label = "frame",
  } = frame;
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new TypeError(`${label}: width and height must be positive integers`);
  }
  if (!(rgba instanceof Uint8Array) || rgba.length < width * height * 4) {
    throw new TypeError(`${label}: rgba must contain width * height * 4 bytes`);
  }
  if (
    evidenceRgba !== null &&
    (!(evidenceRgba instanceof Uint8Array) ||
      evidenceRgba.length < width * height * 4)
  ) {
    throw new TypeError(`${label}: evidenceRgba must contain width * height * 4 bytes`);
  }

  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  let foregroundPixels = 0;
  let opaquePixels = 0;
  let softAlphaPixels = 0;
  let alphaWeight = 0;
  let weightedX = 0;
  let weightedY = 0;
  let boundaryPixels = 0;
  let chromaFringePixels = 0;
  const chromaFringeLocations = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = pixelOffset(x, y, width);
      const alpha = rgba[index + 3];
      if (alpha <= settings.alphaThreshold) continue;
      foregroundPixels += 1;
      if (alpha === 255) opaquePixels += 1;
      else softAlphaPixels += 1;
      const weight = alpha / 255;
      alphaWeight += weight;
      weightedX += (x + 0.5) * weight;
      weightedY += (y + 0.5) * weight;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);

      const boundary = isBoundaryPixel(
        rgba,
        x,
        y,
        width,
        height,
        settings.alphaThreshold,
      );
      if (boundary) boundaryPixels += 1;
      const evidenceBacked = hasKeyContaminationEvidence(
        evidenceRgba,
        rgba,
        x,
        y,
        width,
        height,
        keyRgb,
      );
      if (!boundary && !evidenceBacked) continue;
      const chromaLike = boundary
        ? isChromaLike(rgba[index], rgba[index + 1], rgba[index + 2], keyRgb)
        : false;
      const evidenceChromaLike = evidenceBacked
        ? !hasSafePaletteWitness(
            evidenceRgba,
            rgba,
            x,
            y,
            width,
            height,
            keyRgb,
          ) &&
          isEvidenceChromaLike(
            rgba[index],
            rgba[index + 1],
            rgba[index + 2],
            keyRgb,
          )
        : false;
      if (chromaLike || evidenceChromaLike) {
        chromaFringePixels += 1;
        if (chromaFringeLocations.length < 12) {
          chromaFringeLocations.push({
            x,
            y,
            rgb: [rgba[index], rgba[index + 1], rgba[index + 2]],
            evidenceBacked,
          });
        }
      }
    }
  }

  const alphaBounds =
    right >= left
      ? { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }
      : null;

  return {
    label,
    width,
    height,
    foregroundPixels,
    opaquePixels,
    softAlphaPixels,
    boundaryPixels,
    chromaFringePixels,
    chromaFringeLocations,
    alphaBounds,
    centroid:
      alphaWeight > 0
        ? { x: round(weightedX / alphaWeight), y: round(weightedY / alphaWeight) }
        : null,
    baselineY: bottom >= 0 ? bottom : null,
  };
}

function normalizedPixel(frame, bounds, gridX, gridY, gridSize) {
  const x =
    bounds.x +
    Math.min(bounds.width - 1, Math.floor(((gridX + 0.5) * bounds.width) / gridSize));
  const y =
    bounds.y +
    Math.min(bounds.height - 1, Math.floor(((gridY + 0.5) * bounds.height) / gridSize));
  const index = pixelOffset(x, y, frame.width);
  return [
    frame.rgba[index],
    frame.rgba[index + 1],
    frame.rgba[index + 2],
    frame.rgba[index + 3],
  ];
}

/**
 * Compares cropped subjects in normalized coordinates. A high score while the
 * alpha bounds change is evidence that the whole bitmap was rescaled, rather
 * than that a limb/face/pose was redrawn independently.
 */
export function normalizedShapeSimilarity(leftFrame, rightFrame, options = {}) {
  const settings = { ...DEFAULTS, ...options };
  const left = inspectRgbaFrame(leftFrame, settings);
  const right = inspectRgbaFrame(rightFrame, settings);
  if (!left.alphaBounds || !right.alphaBounds) {
    return { alphaAgreement: 0, colorAgreement: 0, combined: 0 };
  }

  const gridSize = settings.normalizedGridSize;
  let alphaAgreement = 0;
  let colorAgreement = 0;
  let sharedForeground = 0;
  for (let y = 0; y < gridSize; y += 1) {
    for (let x = 0; x < gridSize; x += 1) {
      const leftPixel = normalizedPixel(leftFrame, left.alphaBounds, x, y, gridSize);
      const rightPixel = normalizedPixel(rightFrame, right.alphaBounds, x, y, gridSize);
      const leftVisible = leftPixel[3] > settings.alphaThreshold;
      const rightVisible = rightPixel[3] > settings.alphaThreshold;
      if (leftVisible === rightVisible) alphaAgreement += 1;
      if (!leftVisible || !rightVisible) continue;
      sharedForeground += 1;
      const distance = Math.hypot(
        leftPixel[0] - rightPixel[0],
        leftPixel[1] - rightPixel[1],
        leftPixel[2] - rightPixel[2],
      );
      colorAgreement += clamp(1 - distance / 180, 0, 1);
    }
  }

  const samples = gridSize * gridSize;
  const alphaScore = alphaAgreement / samples;
  const colorScore = sharedForeground ? colorAgreement / sharedForeground : 0;
  return {
    alphaAgreement: round(alphaScore),
    colorAgreement: round(colorScore),
    combined: round(alphaScore * 0.4 + colorScore * 0.6),
  };
}

function scaleDistortion(referenceFrame, candidateFrame, reference, candidate, settings) {
  if (!reference.alphaBounds || !candidate.alphaBounds) return null;
  const widthScale = candidate.alphaBounds.width / reference.alphaBounds.width;
  const heightScale = candidate.alphaBounds.height / reference.alphaBounds.height;
  const widthPixelDelta = candidate.alphaBounds.width - reference.alphaBounds.width;
  const heightPixelDelta = candidate.alphaBounds.height - reference.alphaBounds.height;
  if (widthPixelDelta === 0 && heightPixelDelta === 0) return null;

  const similarity = normalizedShapeSimilarity(referenceFrame, candidateFrame, settings);
  const aspectScaleDelta = Math.abs(Math.log(widthScale / heightScale));
  const anisotropicClone =
    Math.max(Math.abs(widthPixelDelta), Math.abs(heightPixelDelta)) >= 2 &&
    aspectScaleDelta >= 0.035 &&
    Math.max(Math.abs(widthScale - 1), Math.abs(heightScale - 1)) >= 0.02 &&
    similarity.alphaAgreement >= 0.92 &&
    similarity.colorAgreement >= 0.88;
  const subtleWholeBitmapResize =
    similarity.alphaAgreement >= 0.985 &&
    similarity.colorAgreement >= 0.9;

  if (!anisotropicClone && !subtleWholeBitmapResize) return null;
  return {
    widthScale: round(widthScale),
    heightScale: round(heightScale),
    widthPixelDelta,
    heightPixelDelta,
    aspectScaleDelta: round(aspectScaleDelta),
    similarity,
  };
}

export function evaluateFrameSequence(frames, options = {}) {
  const settings = { ...DEFAULTS, ...options };
  if (!Array.isArray(frames) || frames.length === 0) {
    throw new TypeError("frame sequence must contain at least one frame");
  }

  const diagnostics = frames.map((frame, index) =>
    inspectRgbaFrame(
      { ...frame, label: frame.label ?? `frame-${String(index + 1).padStart(2, "0")}` },
      settings,
    ),
  );
  const violations = [];
  const transitions = [];
  const canvasWidth = frames[0].width;
  const canvasHeight = frames[0].height;
  const jumpUnit = Math.min(canvasWidth, canvasHeight);

  diagnostics.forEach((frame, index) => {
    if (!frame.alphaBounds) {
      violations.push({ code: "EMPTY_FOREGROUND", frame: index, label: frame.label });
    }
    if (frame.softAlphaPixels > settings.maxSoftAlphaPixels) {
      violations.push({
        code: "SOFT_ALPHA",
        frame: index,
        label: frame.label,
        actual: frame.softAlphaPixels,
        maximum: settings.maxSoftAlphaPixels,
      });
    }
    if (frame.chromaFringePixels > settings.maxChromaFringePixels) {
      violations.push({
        code: "CHROMA_FRINGE",
        frame: index,
        label: frame.label,
        actual: frame.chromaFringePixels,
        maximum: settings.maxChromaFringePixels,
        examples: frame.chromaFringeLocations,
      });
    }
    if (frame.width !== canvasWidth || frame.height !== canvasHeight) {
      violations.push({
        code: "CANVAS_MISMATCH",
        frame: index,
        label: frame.label,
        expected: { width: canvasWidth, height: canvasHeight },
        actual: { width: frame.width, height: frame.height },
      });
    }
  });

  if (frames.length > 1) {
    for (let index = 0; index < frames.length; index += 1) {
      const nextIndex = (index + 1) % frames.length;
      const current = diagnostics[index];
      const next = diagnostics[nextIndex];
      if (!current.centroid || !next.centroid) continue;
      const centroidDistance = Math.hypot(
        next.centroid.x - current.centroid.x,
        next.centroid.y - current.centroid.y,
      );
      const baselineDistance =
        current.baselineY === null || next.baselineY === null
          ? 0
          : Math.abs(next.baselineY - current.baselineY);
      const transition = {
        from: index,
        to: nextIndex,
        centroidDistance: round(centroidDistance),
        centroidJumpRatio: round(centroidDistance / jumpUnit),
        baselineDistance,
        baselineJumpRatio: round(baselineDistance / jumpUnit),
      };
      transitions.push(transition);
      if (transition.centroidJumpRatio > settings.maxCentroidJumpRatio) {
        violations.push({
          code: "POSITION_JUMP",
          ...transition,
          maximumRatio: settings.maxCentroidJumpRatio,
        });
      }
      if (transition.baselineJumpRatio > settings.maxBaselineJumpRatio) {
        violations.push({
          code: "BASELINE_JUMP",
          ...transition,
          maximumRatio: settings.maxBaselineJumpRatio,
        });
      }
    }

    const reference = diagnostics[0];
    for (let index = 1; index < frames.length; index += 1) {
      const distortion = scaleDistortion(
        frames[0],
        frames[index],
        reference,
        diagnostics[index],
        settings,
      );
      if (distortion) {
        violations.push({
          code: "GLOBAL_SCALE_DISTORTION",
          referenceFrame: 0,
          frame: index,
          label: diagnostics[index].label,
          ...distortion,
        });
      }
    }
  }

  return {
    passed: violations.length === 0,
    thresholds: {
      maxSoftAlphaPixels: settings.maxSoftAlphaPixels,
      maxChromaFringePixels: settings.maxChromaFringePixels,
      maxCentroidJumpRatio: settings.maxCentroidJumpRatio,
      maxBaselineJumpRatio: settings.maxBaselineJumpRatio,
    },
    diagnostics,
    transitions,
    violations,
  };
}

export function assertFrameSequenceQuality(frames, options = {}) {
  const report = evaluateFrameSequence(frames, options);
  if (!report.passed) {
    const summary = report.violations
      .map((violation) => {
        const location =
          "frame" in violation ? ` frame ${Number(violation.frame) + 1}` : "";
        return `${violation.code}${location}`;
      })
      .join(", ");
    const error = new Error(`Frame quality gate failed: ${summary}`);
    error.report = report;
    throw error;
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.error(
    "scripts/frame-quality.mjs is a library. Run scripts/check-frame-quality.mjs instead.",
  );
  process.exitCode = 2;
}
