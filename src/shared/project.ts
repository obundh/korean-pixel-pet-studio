export const PIXELPET_PROJECT_VERSION = 1 as const;

export const PET_ANIMATION_NAMES = [
  "idle",
  "walk",
  "jump",
  "sleep",
  "reaction",
] as const;

export type PetAnimationName = (typeof PET_ANIMATION_NAMES)[number];
export type PixelPetChromaKey = [number, number, number];

export function isPixelPetChromaKey(value: unknown): value is PixelPetChromaKey {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every(
      (channel) => Number.isInteger(channel) && channel >= 0 && channel <= 255,
    )
  );
}

export interface PixelPetFrameAsset {
  id: string;
  name: string;
  dataUrl: string;
  originalDataUrl: string;
  width: number;
  height: number;
  backgroundRemoved: boolean;
  chromaKey?: PixelPetChromaKey;
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
  /** Legacy/default playback rate retained for version-1 project compatibility. */
  fps: number;
  /** New projects persist an independent playback rate for every motion. */
  motionFps?: Record<PetAnimationName, number>;
  scale: number;
  createdAt: string;
  updatedAt: string;
}

export function getPixelPetMotionFps(
  project: PixelPetProject,
  animation: PetAnimationName,
): number {
  return project.motionFps?.[animation] ?? project.fps;
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
