import type { FrameAsset } from "../types";
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  parseEncodedImageDimensions,
  validateImageDimensions,
} from "../../shared/image-validation";

export {
  ACCEPTED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_EDGE,
  MAX_IMAGE_PIXELS,
  parseEncodedImageDimensions,
  validateImageDimensions,
} from "../../shared/image-validation";

const makeId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `frame-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const validateImageFile = (file: File): string | null => {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    return "PNG, JPG 또는 WebP 이미지만 가져올 수 있어요.";
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return "이미지는 한 장당 20MB 이하여야 해요.";
  }
  return null;
};

export const fileToDataUrl = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("이미지 파일을 읽지 못했습니다."));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });

export const getImageDimensions = (
  src: string,
): Promise<{ width: number; height: number }> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("올바른 이미지인지 확인해 주세요."));
    image.src = src;
  });

export type PoseSheetCell = {
  index: number;
  x: number;
  y: 0;
  width: number;
  height: number;
};

export const calculatePoseSheetCells = (
  width: number,
  height: number,
  frameCount: number,
): PoseSheetCell[] => {
  const sheetDimensionError = validateImageDimensions(width, height);
  if (sheetDimensionError) throw new Error(sheetDimensionError);
  if (!Number.isInteger(frameCount) || frameCount <= 0) {
    throw new Error("포즈 시트의 프레임 수를 확인하지 못했습니다.");
  }
  if (width % frameCount !== 0) {
    throw new Error(
      `포즈 시트 가로 ${width}px을 ${frameCount}개 프레임으로 똑같이 나눌 수 없어요.`,
    );
  }

  const cellWidth = width / frameCount;
  const cellDimensionError = validateImageDimensions(cellWidth, height);
  if (cellDimensionError) {
    throw new Error(`포즈 시트의 각 프레임 크기가 너무 큽니다. ${cellDimensionError}`);
  }

  return Array.from({ length: frameCount }, (_, index) => ({
    index,
    x: index * cellWidth,
    y: 0 as const,
    width: cellWidth,
    height,
  }));
};

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("올바른 포즈 시트 이미지인지 확인해 주세요."));
    image.src = src;
  });

const renderPoseSheetCell = (
  image: HTMLImageElement,
  cell: PoseSheetCell,
): Promise<{ dataUrl: string; byteLength: number }> => {
  const canvas = document.createElement("canvas");
  canvas.width = cell.width;
  canvas.height = cell.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("포즈 시트를 나눌 캔버스를 만들지 못했습니다.");
  context.imageSmoothingEnabled = false;
  context.drawImage(
    image,
    cell.x,
    cell.y,
    cell.width,
    cell.height,
    0,
    0,
    cell.width,
    cell.height,
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("포즈 시트의 프레임을 PNG로 만들지 못했습니다."));
        return;
      }
      if (blob.size > MAX_IMAGE_BYTES) {
        reject(new Error("나눈 프레임은 한 장당 20MB 이하여야 해요."));
        return;
      }
      void fileToDataUrl(blob).then(
        (dataUrl) => resolve({ dataUrl, byteLength: blob.size }),
        reject,
      );
    }, "image/png");
  });
};

type PoseSheetDependencies = {
  loadImage: (src: string) => Promise<HTMLImageElement>;
  renderCell: (
    image: HTMLImageElement,
    cell: PoseSheetCell,
  ) => Promise<{ dataUrl: string; byteLength: number }>;
  now: () => string;
};

const poseSheetDependencies: PoseSheetDependencies = {
  loadImage,
  renderCell: renderPoseSheetCell,
  now: () => new Date().toISOString(),
};

export const createPoseSheetFrameAssets = async (
  file: File,
  frameCount: number,
  dependencies: PoseSheetDependencies = poseSheetDependencies,
): Promise<FrameAsset[]> => {
  const validationError = validateImageFile(file);
  if (validationError) throw new Error(validationError);

  const encodedDimensions = parseEncodedImageDimensions(
    new Uint8Array(await file.arrayBuffer()),
    file.type,
  );
  if (!encodedDimensions) throw new Error("포즈 시트 헤더에서 크기를 확인하지 못했습니다.");
  const encodedDimensionError = validateImageDimensions(
    encodedDimensions.width,
    encodedDimensions.height,
  );
  if (encodedDimensionError) throw new Error(encodedDimensionError);

  const sourceDataUrl = await fileToDataUrl(file);
  const image = await dependencies.loadImage(sourceDataUrl);
  const cells = calculatePoseSheetCells(
    image.naturalWidth,
    image.naturalHeight,
    frameCount,
  );
  const rendered = await Promise.all(
    cells.map((cell) => dependencies.renderCell(image, cell)),
  );
  const baseName = file.name.replace(/\.[^.]+$/, "") || "pose-sheet";
  const updatedAt = dependencies.now();

  return rendered.map(({ dataUrl, byteLength }, index) => {
    if (byteLength <= 0 || byteLength > MAX_IMAGE_BYTES) {
      throw new Error("나눈 프레임은 한 장당 20MB 이하여야 해요.");
    }
    const cell = cells[index];
    return {
      id: makeId(),
      name: `${baseName}-frame-${String(index + 1).padStart(2, "0")}.png`,
      dataUrl,
      originalDataUrl: dataUrl,
      width: cell.width,
      height: cell.height,
      backgroundRemoved: false,
      updatedAt,
    };
  });
};

export const createFrameAsset = async (file: File): Promise<FrameAsset> => {
  const validationError = validateImageFile(file);
  if (validationError) throw new Error(validationError);
  const encodedDimensions = parseEncodedImageDimensions(
    new Uint8Array(await file.arrayBuffer()),
    file.type,
  );
  if (!encodedDimensions) throw new Error("이미지 헤더에서 크기를 확인하지 못했습니다.");
  const encodedDimensionError = validateImageDimensions(
    encodedDimensions.width,
    encodedDimensions.height,
  );
  if (encodedDimensionError) throw new Error(encodedDimensionError);
  const dataUrl = await fileToDataUrl(file);
  const { width, height } = await getImageDimensions(dataUrl);
  const dimensionError = validateImageDimensions(width, height);
  if (dimensionError) throw new Error(dimensionError);
  return {
    id: makeId(),
    name: file.name,
    dataUrl,
    originalDataUrl: dataUrl,
    width,
    height,
    backgroundRemoved: false,
    updatedAt: new Date().toISOString(),
  };
};

export const dataUrlToBlob = async (dataUrl: string): Promise<Blob> => {
  const response = await fetch(dataUrl);
  if (!response.ok) throw new Error("이미지 데이터를 변환하지 못했습니다.");
  return response.blob();
};

export const downloadTextFile = (fileName: string, contents: string): void => {
  const blob = new Blob([contents], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};
