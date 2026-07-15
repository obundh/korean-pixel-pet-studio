export const PIXELPET_PROJECT_VERSION = 1 as const;

export const PET_ANIMATION_NAMES = [
  "idle",
  "walk",
  "jump",
  "sleep",
  "reaction",
] as const;

export type PetAnimationName = (typeof PET_ANIMATION_NAMES)[number];

export interface PixelPetFrameAsset {
  id: string;
  name: string;
  dataUrl: string;
  originalDataUrl: string;
  width: number;
  height: number;
  backgroundRemoved: boolean;
  updatedAt: string;
}

export type PixelPetFrameMap = Record<
  PetAnimationName,
  Array<PixelPetFrameAsset | null>
>;

/**
 * Portable JSON document stored in a `.pixelpet` file.
 *
 * Image bytes intentionally live in data URLs. A project therefore remains a
 * single relocatable file and does not gain ambient access to local paths.
 */
export interface PixelPetProject {
  version: typeof PIXELPET_PROJECT_VERSION;
  name: string;
  activeKitId: string;
  frames: PixelPetFrameMap;
  fps: number;
  scale: number;
  createdAt: string;
  updatedAt: string;
}

export function createEmptyFrameMap(): PixelPetFrameMap {
  return {
    idle: [],
    walk: [],
    jump: [],
    sleep: [],
    reaction: [],
  };
}
