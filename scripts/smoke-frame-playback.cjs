const { app, BrowserWindow } = require("electron");
const path = require("node:path");

const sharp = require("sharp");

const {
  installAppProtocol,
  registerAppScheme,
} = require("../dist-electron/main/app-protocol.js");
const { WindowManager } = require("../dist-electron/main/window-manager.js");

const root = path.resolve(__dirname, "..");
const FRAME_SIZE = 48;
const FPS = 4;
const EXPECTED_LOOP = [0, 1, 2, 3, 0];
const COLORS = [
  [228, 52, 65],
  [47, 181, 91],
  [53, 111, 235],
  [239, 181, 45],
];

app.setAppPath(root);
registerAppScheme();

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function frameDataUrl(color) {
  const buffer = await sharp({
    create: {
      width: FRAME_SIZE,
      height: FRAME_SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: {
          create: {
            width: 32,
            height: 32,
            channels: 4,
            background: { r: color[0], g: color[1], b: color[2], alpha: 1 },
          },
        },
        left: 8,
        top: 8,
      },
    ])
    .png()
    .toBuffer();
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

async function averageVisibleColor(image) {
  const decoded = await sharp(image.toPNG()).ensureAlpha().raw().toBuffer({
    resolveWithObject: true,
  });
  let red = 0;
  let green = 0;
  let blue = 0;
  let weight = 0;
  for (let index = 0; index < decoded.data.length; index += decoded.info.channels) {
    const alpha = decoded.data[index + 3] / 255;
    if (alpha <= 0.5) continue;
    red += decoded.data[index] * alpha;
    green += decoded.data[index + 1] * alpha;
    blue += decoded.data[index + 2] * alpha;
    weight += alpha;
  }
  if (!weight) throw new Error("Captured playback frame contained no visible pixels.");
  return [red / weight, green / weight, blue / weight];
}

function nearestColorIndex(color) {
  let nearest = -1;
  let nearestDistance = Number.POSITIVE_INFINITY;
  COLORS.forEach((candidate, index) => {
    const distance = Math.hypot(
      color[0] - candidate[0],
      color[1] - candidate[1],
      color[2] - candidate[2],
    );
    if (distance < nearestDistance) {
      nearest = index;
      nearestDistance = distance;
    }
  });
  return { index: nearest, distance: nearestDistance };
}

async function findPetWindow() {
  const started = Date.now();
  while (Date.now() - started < 10_000) {
    const window = BrowserWindow.getAllWindows().find(
      (candidate) => !candidate.isDestroyed() && candidate.isAlwaysOnTop(),
    );
    if (window) return window;
    await wait(20);
  }
  throw new Error("Timed out waiting for the desktop-pet window.");
}

async function observeLoop(petWindow, dataUrls) {
  const observations = [];
  const started = performance.now();
  let previousSource = "";
  while (performance.now() - started < 5_000 && observations.length < EXPECTED_LOOP.length) {
    const rendered = await petWindow.webContents.executeJavaScript(`(() => {
      const surface = document.querySelector('.pet-surface');
      const image = surface?.querySelector('img');
      return image
        ? { source: image.currentSrc || image.src, motionDriver: surface.dataset.motionDriver || '' }
        : null;
    })()`);
    if (!rendered?.source || rendered.source === previousSource) {
      await wait(12);
      continue;
    }
    previousSource = rendered.source;
    const sourceIndex = dataUrls.indexOf(rendered.source);
    if (sourceIndex < 0) throw new Error("PetSurface rendered a frame outside the supplied loop.");
    if (rendered.motionDriver !== "frames") {
      throw new Error(`Multi-frame pet used unexpected motion driver: ${rendered.motionDriver}`);
    }

    petWindow.webContents.invalidate();
    await wait(16);
    const capture = await petWindow.webContents.capturePage();
    const sourceAfterCapture = await petWindow.webContents.executeJavaScript(
      "document.querySelector('.pet-surface img')?.currentSrc || document.querySelector('.pet-surface img')?.src || ''",
    );
    // If the timer advanced during capture, discard the ambiguous image and
    // observe the new frame on the next poll instead of creating a flaky
    // source/pixel mismatch.
    if (sourceAfterCapture !== rendered.source) continue;
    const averageColor = await averageVisibleColor(capture);
    const captured = nearestColorIndex(averageColor);
    if (captured.index !== sourceIndex || captured.distance > 18) {
      throw new Error(
        `Rendered source/capture mismatch: source ${sourceIndex}, capture ${captured.index}, distance ${captured.distance.toFixed(2)}`,
      );
    }
    observations.push({
      index: sourceIndex,
      atMs: Math.round(performance.now() - started),
      capturedColor: averageColor.map((channel) => Math.round(channel)),
    });
  }
  return observations;
}

app.whenReady().then(async () => {
  const windows = new WindowManager();
  try {
    await installAppProtocol();
    const dataUrls = await Promise.all(COLORS.map(frameDataUrl));
    const now = "2026-07-16T00:00:00.000Z";
    const frames = dataUrls.map((dataUrl, index) => ({
      id: `playback-${index}`,
      name: `playback-${index}.png`,
      dataUrl,
      originalDataUrl: dataUrl,
      width: FRAME_SIZE,
      height: FRAME_SIZE,
      backgroundRemoved: true,
      updatedAt: now,
    }));
    const project = {
      version: 1,
      name: "frame-playback-smoke",
      activeKitId: "test:playback",
      frames: { idle: frames, walk: [], jump: [], sleep: [], reaction: [] },
      fps: FPS,
      motionFps: {
        idle: FPS,
        walk: 8,
        jump: 8,
        sleep: 4,
        reaction: 8,
      },
      scale: 2,
      createdAt: now,
      updatedAt: now,
    };

    await windows.startPet({
      project,
      animation: "idle",
      motion: { velocityX: 0, velocityY: 0, bounce: false },
    });
    const petWindow = await findPetWindow();
    const observations = await observeLoop(petWindow, dataUrls);
    const observedLoop = observations.map((item) => item.index);
    if (JSON.stringify(observedLoop) !== JSON.stringify(EXPECTED_LOOP)) {
      throw new Error(
        `Frames did not play chronologically: expected ${EXPECTED_LOOP.join("→")}, observed ${observedLoop.join("→")}`,
      );
    }

    const intervals = observations.slice(1).map((item, index) => item.atMs - observations[index].atMs);
    const targetInterval = 1000 / FPS;
    if (intervals.some((interval) => interval < targetInterval * 0.45 || interval > targetInterval * 1.8)) {
      throw new Error(
        `Playback timing drifted outside tolerance: target ${targetInterval}ms, observed ${intervals.join(", ")}ms`,
      );
    }

    console.log(
      JSON.stringify({
        fps: FPS,
        expectedLoop: EXPECTED_LOOP,
        observedLoop,
        intervalsMs: intervals,
        captures: observations.map(({ index, capturedColor }) => ({ index, capturedColor })),
      }),
    );
    windows.dispose();
    app.quit();
  } catch (error) {
    console.error(error);
    windows.dispose();
    app.exit(1);
  }
});
