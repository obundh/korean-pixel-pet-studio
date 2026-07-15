import type { FrameAsset } from "../types";

export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

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

export const createFrameAsset = async (file: File): Promise<FrameAsset> => {
  const validationError = validateImageFile(file);
  if (validationError) throw new Error(validationError);
  const dataUrl = await fileToDataUrl(file);
  const { width, height } = await getImageDimensions(dataUrl);
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
