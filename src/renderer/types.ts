export const ANIMATION_STATES = [
  "idle",
  "walk",
  "jump",
  "sleep",
  "reaction",
] as const;

export type AnimationState = (typeof ANIMATION_STATES)[number];

export type FrameAsset = {
  id: string;
  name: string;
  dataUrl: string;
  originalDataUrl: string;
  width: number;
  height: number;
  backgroundRemoved: boolean;
  /** Flat background key retained so a later manual re-clean stays lossless. */
  chromaKey?: [number, number, number];
  updatedAt: string;
};

export type FrameCollection = Record<AnimationState, Array<FrameAsset | null>>;

export type ReferenceAsset = {
  id: string;
  label: string;
  image?: string;
  description?: string;
};

export type ExamplePet = {
  id: string;
  name: string;
  animal: string;
  description: string;
  sourceImage?: string;
  previewImage?: string;
  defaultStyleId?: string;
  prompt?: string;
};

export type StyleReference = ReferenceAsset & {
  canvas?: string;
  paletteMax?: number;
  prompt?: string;
};

export type PoseReferenceSet = {
  id: string;
  label: string;
  loop: boolean;
  guideImage?: string;
  frames: ReferenceAsset[];
  durationsMs: number[];
  prompt?: string;
};

export type ReferenceCatalog = {
  schemaVersion: string;
  kitName: string;
  licenseNote?: string;
  examples: ExamplePet[];
  styles: StyleReference[];
  poses: PoseReferenceSet[];
  isFallback: boolean;
};

export type ProjectSnapshot = {
  version: 1;
  name: string;
  activeKitId: string;
  frames: FrameCollection;
  fps: number;
  motionFps?: Record<AnimationState, number>;
  scale: number;
  createdAt: string;
  updatedAt: string;
};

export type SelectedFrame = {
  state: AnimationState;
  index: number;
};
