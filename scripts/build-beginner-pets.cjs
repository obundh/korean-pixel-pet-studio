const { app, BrowserWindow } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const {
  installAppProtocol,
  registerAppScheme,
  rendererEntryUrl,
} = require("../dist-electron/main/app-protocol.js");
const { WindowManager } = require("../dist-electron/main/window-manager.js");

const root = path.resolve(__dirname, "..");
const packageJson = require(path.join(root, "package.json"));
const includeLocalPavi = process.argv.includes("--include-local-pavi");

const publicSamples = [
  "haeori-sun-otter",
  "mongle-cloud-bear",
  "toto-sprout-turtle",
].map((id) => ({
  id,
  public: true,
  source: path.join(root, "examples", "beginner-pets", id, "pixel-master-chroma.png"),
  output: path.join(root, "examples", "beginner-pets", id),
}));

const samples = [...publicSamples];
if (includeLocalPavi) {
  samples.push({
    id: "rra-pavi",
    public: false,
    source: path.join(root, "tmp", "local-examples", "rra-pavi", "pixel-master-chroma.png"),
    output: path.join(root, "tmp", "local-examples", "rra-pavi", "result"),
  });
}

app.setAppPath(root);
registerAppScheme();

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
const relativeToRoot = (value) => path.relative(root, value).split(path.sep).join("/");

function assertInside(candidate, parent, description) {
  const resolvedCandidate = path.resolve(candidate);
  const resolvedParent = path.resolve(parent);
  if (
    resolvedCandidate !== resolvedParent &&
    !resolvedCandidate.startsWith(`${resolvedParent}${path.sep}`)
  ) {
    throw new Error(`${description} escaped its allowed directory: ${resolvedCandidate}`);
  }
}

async function assertInputs() {
  for (const sample of samples) {
    const stats = await fs.stat(sample.source).catch(() => null);
    if (!stats?.isFile()) throw new Error(`Missing sample input: ${relativeToRoot(sample.source)}`);
    if (!sample.public) {
      assertInside(sample.source, path.join(root, "tmp", "local-examples"), "Local Pavi input");
      assertInside(sample.output, path.join(root, "tmp", "local-examples"), "Local Pavi output");
    }
  }
}

function createDownloadQueue(session) {
  const pending = [];

  session.on("will-download", (_event, item) => {
    const job = pending.shift();
    if (!job) {
      item.cancel();
      return;
    }
    clearTimeout(job.waitingForStart);
    item.setSavePath(job.output);
    item.once("done", (_doneEvent, state) => {
      clearTimeout(job.waitingForFinish);
      if (state === "completed") {
        job.resolve({ suggestedName: item.getFilename(), output: job.output });
      } else {
        job.reject(new Error(`Download did not complete (${state}): ${job.output}`));
      }
    });
    job.waitingForFinish = setTimeout(() => {
      item.cancel();
      job.reject(new Error(`Download timed out: ${job.output}`));
    }, 30000);
  });

  return async (output, trigger) => {
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.rm(output, { force: true });
    let job;
    const completed = new Promise((resolve, reject) => {
      job = {
        output,
        resolve,
        reject,
        waitingForStart: setTimeout(() => {
          const index = pending.indexOf(job);
          if (index >= 0) pending.splice(index, 1);
          reject(new Error(`Download never started: ${output}`));
        }, 15000),
        waitingForFinish: null,
      };
      pending.push(job);
    });
    try {
      await trigger();
    } catch (error) {
      clearTimeout(job.waitingForStart);
      const index = pending.indexOf(job);
      if (index >= 0) pending.splice(index, 1);
      throw error;
    }
    return completed;
  };
}

const rendererHelpers = `
  const waitFor = async (predicate, message, limit = 180000) => {
    const started = performance.now();
    while (performance.now() - started < limit) {
      const value = predicate();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(message);
  };
`;

async function prepareQuickPet(window, sample, sourceBuffer) {
  const payload = JSON.stringify({
    id: sample.id,
    name: path.basename(sample.source),
    base64: sourceBuffer.toString("base64"),
  });
  return window.webContents.executeJavaScript(`(async () => {
    ${rendererHelpers}
    const payload = ${payload};
    if (window.pixelPet) throw new Error('sample builder must run in browser mode without preload');
    await waitFor(() => document.querySelector('[data-testid="workflow-step-remove"]'), 'Studio did not mount', 15000);

    const projectName = document.querySelector('[data-testid="project-name"]');
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    valueSetter.call(projectName, payload.id);
    projectName.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-testid="workflow-step-remove"]').click();

    const input = await waitFor(
      () => document.querySelector('[data-testid="quick-pet-file-input"]'),
      'Quick-pet input did not mount',
    );
    const bytes = Uint8Array.from(atob(payload.base64), (character) => character.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], payload.name, { type: 'image/png' }));
    Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
    input.dispatchEvent(new Event('change', { bubbles: true }));

    const card = await waitFor(() => {
      const value = document.querySelector('[data-testid="quick-pet-card"]');
      const finished = value?.dataset.phase === 'success' || value?.dataset.phase === 'error';
      return finished && value.dataset.fileName === payload.name ? value : null;
    }, 'Quick-pet processing timed out');
    if (card.dataset.phase === 'error') {
      throw new Error(document.querySelector('[data-testid="quick-pet-progress"]')?.textContent || 'Quick-pet failed');
    }
    const frames = [...document.querySelectorAll('[data-testid="quick-pet-result"] img')];
    if (frames.length !== 4) throw new Error('Expected four idle frames, got ' + frames.length);
    await waitFor(() => frames.every((image) => image.complete && image.naturalWidth > 0), 'Idle frames did not decode');
    const key = card.dataset.chromaKey
      ? card.dataset.chromaKey.split(',').map(Number)
      : null;
    const inspectFrame = (image) => {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const pixelCount = canvas.width * canvas.height;
      const transparent = new Uint8Array(pixelCount);
      let opaquePixels = 0;
      let softAlphaPixels = 0;
      let chromaFringePixels = 0;
      let left = canvas.width;
      let top = canvas.height;
      let right = -1;
      let bottom = -1;
      for (let pixel = 0; pixel < pixelCount; pixel += 1) {
        const index = pixel * 4;
        const alpha = data[index + 3];
        if (alpha === 0) transparent[pixel] = 1;
        if (alpha === 255) opaquePixels += 1;
        if (alpha !== 0 && alpha !== 255) softAlphaPixels += 1;
        if (alpha > 0) {
          const x = pixel % canvas.width;
          const y = Math.floor(pixel / canvas.width);
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x);
          bottom = Math.max(bottom, y);
          if (key && Math.hypot(data[index] - key[0], data[index + 1] - key[1], data[index + 2] - key[2]) < 80) {
            chromaFringePixels += 1;
          }
        }
      }

      const visited = new Uint8Array(pixelCount);
      const queue = new Int32Array(pixelCount);
      let largestEnclosedTransparentRegion = 0;
      for (let start = 0; start < pixelCount; start += 1) {
        if (!transparent[start] || visited[start]) continue;
        let head = 0;
        let tail = 0;
        let touchesEdge = false;
        visited[start] = 1;
        queue[tail++] = start;
        while (head < tail) {
          const pixel = queue[head++];
          const x = pixel % canvas.width;
          const y = Math.floor(pixel / canvas.width);
          if (x === 0 || y === 0 || x === canvas.width - 1 || y === canvas.height - 1) touchesEdge = true;
          const neighbors = [
            x > 0 ? pixel - 1 : -1,
            x + 1 < canvas.width ? pixel + 1 : -1,
            y > 0 ? pixel - canvas.width : -1,
            y + 1 < canvas.height ? pixel + canvas.width : -1,
          ];
          for (const neighbor of neighbors) {
            if (neighbor >= 0 && transparent[neighbor] && !visited[neighbor]) {
              visited[neighbor] = 1;
              queue[tail++] = neighbor;
            }
          }
        }
        if (!touchesEdge) largestEnclosedTransparentRegion = Math.max(largestEnclosedTransparentRegion, tail);
      }
      const alphaBounds = right >= left
        ? { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }
        : null;
      return {
        width: canvas.width,
        height: canvas.height,
        opaquePixels,
        softAlphaPixels,
        chromaFringePixels,
        alphaBounds,
        largestEnclosedTransparentRegion,
      };
    };
    const frameDiagnostics = frames.map(inspectFrame);
    return {
      backgroundRemoval: card.dataset.backgroundRemoval,
      chromaCleanup: card.dataset.chromaCleanup,
      chromaKey: card.dataset.chromaKey,
      frameSizes: frames.map((image) => ({ width: image.naturalWidth, height: image.naturalHeight })),
      frameDiagnostics,
    };
  })()`, true);
}

async function downloadIdleFrame(window, downloadTo, output, index) {
  await downloadTo(output, () =>
    window.webContents.executeJavaScript(`(async () => {
      const image = document.querySelector('[data-testid="quick-pet-frame-${index}"] img');
      if (!image) throw new Error('Missing quick-pet frame ${index + 1}');
      const blob = await (await fetch(image.src)).blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'idle-${String(index + 1).padStart(2, "0")}.png';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    })()`, true),
  );
}

async function clickExport(window, downloadTo, output, testId) {
  await downloadTo(output, () =>
    window.webContents.executeJavaScript(`(() => {
      const button = document.querySelector('[data-testid="${testId}"]');
      if (!button) throw new Error('Missing export button: ${testId}');
      if (button.disabled) throw new Error('Export button is disabled: ${testId}');
      button.click();
    })()`, true),
  );
}

async function capturePreview(window, output) {
  const bounds = await window.webContents.executeJavaScript(`(async () => {
    ${rendererHelpers}
    document.querySelector('[data-testid="workflow-step-preview"]').click();
    const stage = await waitFor(
      () => document.querySelector('[data-testid="animation-preview"]'),
      'Animation preview did not mount',
    );
    const preview = await waitFor(() => stage.querySelector('img'), 'Animation frame did not mount');
    await waitFor(() => preview.complete && preview.naturalWidth > 0, 'Animation preview did not decode');
    await new Promise((resolve) => setTimeout(resolve, 350));
    const rectangle = stage.getBoundingClientRect();
    return {
      x: Math.max(0, Math.floor(rectangle.left)),
      y: Math.max(0, Math.floor(rectangle.top)),
      width: Math.max(1, Math.ceil(rectangle.width)),
      height: Math.max(1, Math.ceil(rectangle.height)),
    };
  })()`, true);
  const captures = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    window.webContents.invalidate();
    await wait(180);
    captures.push(await window.webContents.capturePage(bounds));
  }
  const visiblePixelScore = (image) => {
    const bitmap = image.toBitmap();
    let visible = 0;
    for (let index = 0; index < bitmap.length; index += 4) {
      if (bitmap[index] > 8 || bitmap[index + 1] > 8 || bitmap[index + 2] > 8) visible += 1;
    }
    return visible;
  };
  const capture = captures.sort((left, right) => visiblePixelScore(right) - visiblePixelScore(left))[0];
  if (capture.isEmpty()) throw new Error("App preview capture was empty.");
  await fs.writeFile(output, capture.toPNG());
}

async function verifyDesktopPet(windows, studioWindow, project) {
  let runningState;
  try {
    runningState = await windows.startPet({
      project,
      animation: "idle",
      motion: { velocityX: 0, velocityY: 0, bounce: false },
    });
    if (runningState.status !== "running") {
      throw new Error(`Desktop pet did not enter the running state: ${project.name}`);
    }

    let petWindow = null;
    const started = Date.now();
    while (Date.now() - started < 15000) {
      petWindow = BrowserWindow.getAllWindows().find(
        (candidate) =>
          candidate !== studioWindow &&
          !candidate.isDestroyed() &&
          candidate.isAlwaysOnTop() &&
          candidate.isVisible(),
      );
      if (petWindow) break;
      await wait(100);
    }
    if (!petWindow) throw new Error(`Desktop pet window was not visible: ${project.name}`);

    const captures = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      petWindow.webContents.invalidate();
      await wait(220);
      captures.push(await petWindow.webContents.capturePage());
    }
    const nonTransparentPixels = (image) => {
      const bitmap = image.toBitmap();
      let count = 0;
      for (let index = 3; index < bitmap.length; index += 4) {
        if (bitmap[index] > 0) count += 1;
      }
      return count;
    };
    const capture = captures.sort(
      (left, right) => nonTransparentPixels(right) - nonTransparentPixels(left),
    )[0];
    const visiblePixels = nonTransparentPixels(capture);
    if (capture.isEmpty() || visiblePixels === 0) {
      throw new Error(`Desktop pet renderer was empty: ${project.name}`);
    }
    const capturePng = capture.toPNG();
    return {
      status: runningState.status,
      animation: runningState.animation,
      size: runningState.size,
      position: runningState.position,
      windowVisible: petWindow.isVisible(),
      alwaysOnTop: petWindow.isAlwaysOnTop(),
      capture: capture.getSize(),
      nonTransparentPixels: visiblePixels,
      captureSha256: sha256(capturePng),
      verificationPath: "exported project -> WindowManager.startPet -> visible pet capture",
    };
  } finally {
    windows.stopPet();
  }
}

async function buildSample(window, downloadTo, windows, sample) {
  const generatedDirectory = path.join(sample.output, "generated");
  const projectPath = path.join(sample.output, `${sample.id}.pixelpet`);
  const spriteSheetPath = path.join(sample.output, `${sample.id}-spritesheet.png`);
  const previewPath = path.join(sample.output, "app-preview.png");
  const runLogPath = path.join(sample.output, "run-log.json");
  // Never leave an older authoritative log beside partially replaced files if
  // this run fails halfway through.
  await fs.rm(runLogPath, { force: true });
  await fs.mkdir(generatedDirectory, { recursive: true });

  const sourceBuffer = await fs.readFile(sample.source);
  const startedAt = new Date().toISOString();
  const quickResult = await prepareQuickPet(window, sample, sourceBuffer);
  for (const [index, diagnostics] of quickResult.frameDiagnostics.entries()) {
    if (diagnostics.opaquePixels <= 100 || !diagnostics.alphaBounds) {
      throw new Error(`Quick-pet frame ${index + 1} has no usable foreground: ${sample.id}`);
    }
    if (diagnostics.softAlphaPixels !== 0 || diagnostics.chromaFringePixels !== 0) {
      throw new Error(`Quick-pet frame ${index + 1} retained soft alpha or chroma: ${sample.id}`);
    }
    if (diagnostics.largestEnclosedTransparentRegion > 32) {
      throw new Error(
        `Quick-pet frame ${index + 1} contains a large transparent interior hole (${diagnostics.largestEnclosedTransparentRegion} px): ${sample.id}`,
      );
    }
  }

  const idlePaths = [];
  for (let index = 0; index < 4; index += 1) {
    const output = path.join(generatedDirectory, `idle-${String(index + 1).padStart(2, "0")}.png`);
    await downloadIdleFrame(window, downloadTo, output, index);
    idlePaths.push(output);
  }
  const distinctIdleHashes = new Set(
    await Promise.all(idlePaths.map(async (output) => sha256(await fs.readFile(output)))),
  );
  if (distinctIdleHashes.size < 3) {
    throw new Error(`Quick-pet idle loop did not contain enough visible frame variation: ${sample.id}`);
  }

  await capturePreview(window, previewPath);
  await window.webContents.executeJavaScript(`(async () => {
    ${rendererHelpers}
    document.querySelector('[data-testid="workflow-step-publish"]').click();
    await waitFor(() => document.querySelector('[data-testid="export-project-json"]'), 'Publish exports did not mount');
  })()`, true);
  await clickExport(window, downloadTo, projectPath, "export-project-json");
  await clickExport(window, downloadTo, spriteSheetPath, "export-spritesheet");

  const projectBuffer = await fs.readFile(projectPath);
  const project = JSON.parse(projectBuffer.toString("utf8"));
  if (project.name !== sample.id) {
    throw new Error(`App export used an unexpected project name: ${project.name}`);
  }
  if (project.frames?.idle?.filter(Boolean).length !== 4) {
    throw new Error(`App export did not contain four idle frames: ${sample.id}`);
  }
  const desktopPetVerification = await verifyDesktopPet(windows, window, project);

  const outputPaths = [projectPath, spriteSheetPath, ...idlePaths, previewPath];
  const outputHashes = {};
  for (const output of outputPaths) {
    outputHashes[relativeToRoot(output)] = sha256(await fs.readFile(output));
  }
  const firstFrame = project.frames.idle.find(Boolean);
  const runLog = {
    schemaVersion: "1.0.0",
    sampleId: sample.id,
    public: sample.public,
    startedAt,
    completedAt: new Date().toISOString(),
    source: {
      path: relativeToRoot(sample.source),
      sha256: sha256(sourceBuffer),
      bytes: sourceBuffer.byteLength,
    },
    pipeline: {
      app: "PixelPet Studio",
      appVersion: packageJson.version,
      mode: "hidden-electron-browser-mode",
      entryPoint: "Step 3 / quick-pet UI",
      imageProcessing: "PixelPet quick UI only; no external image post-processing",
      backgroundRemoval: quickResult.backgroundRemoval,
      backgroundRemovalModel:
        quickResult.backgroundRemoval === "performed" ? "IMG.LY isnet_quint8 / CPU" : "skipped-existing-alpha",
      flatChromaPostprocess:
        quickResult.chromaCleanup === "applied"
          ? {
              applied: true,
              keyRgb: quickResult.chromaKey.split(",").map(Number),
              operations: ["key-distance matte", "despill", "pixel hard-alpha"],
            }
          : { applied: false },
      fit: "cleaned alpha bbox / bottom-center / nearest-neighbor",
      idlePreset: ["neutral", "inhale-up", "soft-squash", "exhale"],
      canvas: { width: firstFrame.width, height: firstFrame.height },
      frameDiagnostics: quickResult.frameDiagnostics,
      fps: project.fps,
      scale: project.scale,
    },
    appExports: {
      project: relativeToRoot(projectPath),
      spriteSheet: relativeToRoot(spriteSheetPath),
      projectExportButton: "export-project-json",
      spriteSheetExportButton: "export-spritesheet",
      downloadTransport: "Electron will-download",
    },
    generatedFrames: idlePaths.map(relativeToRoot),
    preview: relativeToRoot(previewPath),
    desktopPetVerification,
    reproducibility: {
      deterministic: false,
      reason: "Frame UUIDs, timestamps, and animated preview capture vary between runs.",
      stableInputs: "Source SHA-256, app version, pipeline settings, and every completed output hash are recorded.",
      runtime: {
        node: process.versions.node,
        electron: process.versions.electron,
        chrome: process.versions.chrome,
      },
    },
    outputSha256: outputHashes,
    rightsBoundary: sample.public
      ? "Original public sample assets created for this repository."
      : "LOCAL ONLY. RRA Pavi input and derivatives must not be committed or redistributed without permission.",
  };
  await fs.writeFile(runLogPath, `${JSON.stringify(runLog, null, 2)}\n`);

  console.log(
    JSON.stringify({
      sample: sample.id,
      public: sample.public,
      canvas: runLog.pipeline.canvas,
      removal: quickResult.backgroundRemoval,
      output: relativeToRoot(sample.output),
    }),
  );
}

app.whenReady().then(async () => {
  let window;
  const windows = new WindowManager();
  try {
    await assertInputs();
    await installAppProtocol();
    window = new BrowserWindow({
      width: 1360,
      height: 940,
      show: false,
      backgroundColor: "#0a0b0e",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        offscreen: true,
        backgroundThrottling: false,
      },
    });
    const downloadTo = createDownloadQueue(window.webContents.session);
    for (const sample of samples) {
      // A fresh renderer makes every sample independent and forces Chromium's
      // hidden offscreen surface to repaint the complete preview before capture.
      await window.loadURL(rendererEntryUrl("studio"));
      await buildSample(window, downloadTo, windows, sample);
    }

    await wait(100);
    windows.dispose();
    window.destroy();
    app.quit();
  } catch (error) {
    console.error(error);
    windows.dispose();
    if (window && !window.isDestroyed()) window.destroy();
    app.exit(1);
  }
});
