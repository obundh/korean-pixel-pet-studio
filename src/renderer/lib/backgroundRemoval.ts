export type BackgroundRemovalProgress = {
  key: string;
  current: number;
  total: number;
  ratio: number;
};

export type BackgroundRemovalOptions = {
  publicPath?: string;
  onProgress?: (progress: BackgroundRemovalProgress) => void;
};

type ImglyRemovalOptions = {
  publicPath: string;
  model: "isnet_quint8";
  device: "cpu";
  progress: (key: string, current: number, total: number) => void;
};

type ImglyRemovalFunction = (source: Blob, options: ImglyRemovalOptions) => Promise<Blob>;

export const backgroundRemovalPublicPath = (): string =>
  new URL("./background-removal/", window.location.href).toString();

/**
 * Runs PixelPet's bundled IMG.LY model without sending the source image to a
 * remote service. Keeping this boundary outside React lets quick-create,
 * manual editing, and Electron smoke tests exercise the exact same pipeline.
 */
export async function removeImageBackground(
  source: Blob,
  options: BackgroundRemovalOptions = {},
): Promise<Blob> {
  const module = (await import("@imgly/background-removal")) as unknown as {
    removeBackground?: ImglyRemovalFunction;
    default?: ImglyRemovalFunction;
  };
  const runRemoval = module.removeBackground ?? module.default;
  if (!runRemoval) throw new Error("배경 제거 모듈을 시작하지 못했습니다.");

  return runRemoval(source, {
    publicPath: options.publicPath ?? backgroundRemovalPublicPath(),
    model: "isnet_quint8",
    device: "cpu",
    progress: (key, current, total) => {
      options.onProgress?.({
        key,
        current,
        total,
        ratio: total > 0 ? Math.min(1, Math.max(0, current / total)) : 0,
      });
    },
  });
}
