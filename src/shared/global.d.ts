import type { PixelPetApi } from "./ipc.js";

declare global {
  interface Window {
    pixelPet: PixelPetApi;
  }
}

export {};
