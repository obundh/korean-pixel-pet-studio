export const ACCEPTED_IMAGE_TYPES: readonly string[] = [
  "image/png",
  "image/jpeg",
  "image/webp",
];
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_EDGE = 4096;
export const MAX_IMAGE_PIXELS = 4_000_000;

export type EncodedImageDimensions = { width: number; height: number };
export type InspectedImageDataUrl = EncodedImageDimensions & {
  mimeType: string;
  byteLength: number;
};

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_VALUES = new Int16Array(128).fill(-1);
for (let index = 0; index < BASE64_ALPHABET.length; index += 1) {
  BASE64_VALUES[BASE64_ALPHABET.charCodeAt(index)] = index;
}

const IMAGE_DATA_URL = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/i;

export const validateImageDimensions = (width: number, height: number): string | null => {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return "이미지 크기를 확인하지 못했습니다.";
  }
  if (width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE) {
    return "이미지의 가로와 세로는 각각 4096px 이하여야 해요.";
  }
  if (width * height > MAX_IMAGE_PIXELS) {
    return "이미지는 전체 4MP(400만 픽셀) 이하여야 해요.";
  }
  return null;
};

const asciiAt = (bytes: Uint8Array, offset: number, value: string): boolean =>
  [...value].every((character, index) => bytes[offset + index] === character.charCodeAt(0));

/** Reads dimensions from encoded headers without asking an image decoder to allocate pixels. */
export const parseEncodedImageDimensions = (
  bytes: Uint8Array,
  mimeType: string,
): EncodedImageDimensions | null => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (mimeType === "image/png") {
    if (
      bytes.length < 24 ||
      ![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value) ||
      !asciiAt(bytes, 12, "IHDR")
    ) {
      return null;
    }
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }

  if (mimeType === "image/jpeg") {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    const startOfFrame = new Set([
      0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
      0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
    ]);
    let offset = 2;
    while (offset < bytes.length) {
      while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
      while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
      if (offset >= bytes.length) break;
      const marker = bytes[offset];
      offset += 1;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (marker === 0xd9 || marker === 0xda || offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) return null;
      if (startOfFrame.has(marker)) {
        if (length < 7) return null;
        return {
          width: view.getUint16(offset + 5),
          height: view.getUint16(offset + 3),
        };
      }
      offset += length;
    }
    return null;
  }

  if (mimeType === "image/webp") {
    if (bytes.length < 20 || !asciiAt(bytes, 0, "RIFF") || !asciiAt(bytes, 8, "WEBP")) {
      return null;
    }
    if (asciiAt(bytes, 12, "VP8X") && bytes.length >= 30) {
      return {
        width: 1 + bytes[24] + bytes[25] * 256 + bytes[26] * 65536,
        height: 1 + bytes[27] + bytes[28] * 256 + bytes[29] * 65536,
      };
    }
    if (
      asciiAt(bytes, 12, "VP8 ") &&
      bytes.length >= 30 &&
      bytes[23] === 0x9d &&
      bytes[24] === 0x01 &&
      bytes[25] === 0x2a
    ) {
      return {
        width: view.getUint16(26, true) & 0x3fff,
        height: view.getUint16(28, true) & 0x3fff,
      };
    }
    if (asciiAt(bytes, 12, "VP8L") && bytes.length >= 25 && bytes[20] === 0x2f) {
      return {
        width: 1 + bytes[21] + ((bytes[22] & 0x3f) << 8),
        height: 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10),
      };
    }
  }
  return null;
};

const decodedBase64Length = (payload: string): number | null => {
  if (!payload || payload.length % 4 !== 0) return null;
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return (payload.length / 4) * 3 - padding;
};

const decodeBase64 = (payload: string, byteLength: number): Uint8Array => {
  const bytes = new Uint8Array(byteLength);
  let output = 0;
  for (let input = 0; input < payload.length; input += 4) {
    const first = BASE64_VALUES[payload.charCodeAt(input)];
    const second = BASE64_VALUES[payload.charCodeAt(input + 1)];
    const third = payload[input + 2] === "=" ? 0 : BASE64_VALUES[payload.charCodeAt(input + 2)];
    const fourth = payload[input + 3] === "=" ? 0 : BASE64_VALUES[payload.charCodeAt(input + 3)];
    const packed = (first << 18) | (second << 12) | (third << 6) | fourth;
    if (output < byteLength) bytes[output++] = (packed >> 16) & 0xff;
    if (output < byteLength) bytes[output++] = (packed >> 8) & 0xff;
    if (output < byteLength) bytes[output++] = packed & 0xff;
  }
  return bytes;
};

/**
 * Accepts only portable local raster data URLs and validates their encoded size
 * and dimensions before Chromium is allowed to decode them.
 */
export function inspectImageDataUrl(value: string): InspectedImageDataUrl | null {
  const match = IMAGE_DATA_URL.exec(value);
  if (!match) return null;
  const mimeType = match[1].toLowerCase();
  const payload = match[2];
  const byteLength = decodedBase64Length(payload);
  if (byteLength === null || byteLength <= 0 || byteLength > MAX_IMAGE_BYTES) return null;

  const bytes = decodeBase64(payload, byteLength);
  const dimensions = parseEncodedImageDimensions(bytes, mimeType);
  if (!dimensions || validateImageDimensions(dimensions.width, dimensions.height)) return null;
  return { mimeType, byteLength, ...dimensions };
}
