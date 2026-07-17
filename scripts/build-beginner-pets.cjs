const { app, BrowserWindow } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");

const {
  installAppProtocol,
  registerAppScheme,
  rendererEntryUrl,
} = require("../dist-electron/main/app-protocol.js");
const { WindowManager } = require("../dist-electron/main/window-manager.js");

const root = path.resolve(__dirname, "..");
const packageJson = require(path.join(root, "package.json"));
const includeLocalPavi = process.argv.includes("--include-local-pavi");
const projectMotionFps = (project, animation) =>
  project.motionFps?.[animation] ?? project.fps;

const publicSamples = [
  "haeori-sun-otter",
  "mongle-cloud-bear",
  "toto-sprout-turtle",
].map((id) => ({
  id,
  public: true,
  sourceSheet: path.join(
    root,
    "examples",
    "beginner-pets",
    id,
    "ai-idle-sheet-chroma.png",
  ),
  output: path.join(root, "examples", "beginner-pets", id),
}));

const samples = [...publicSamples];
if (includeLocalPavi) {
  samples.push({
    id: "rra-pavi",
    public: false,
    sourceSheet: path.join(
      root,
      "tmp",
      "local-examples",
      "rra-pavi",
      "ai-idle-sheet-chroma.png",
    ),
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
    const stats = await fs.stat(sample.sourceSheet).catch(() => null);
    if (!stats?.isFile()) {
      throw new Error(`Missing sample input: ${relativeToRoot(sample.sourceSheet)}`);
    }
    if (!sample.public) {
      assertInside(
        sample.sourceSheet,
        path.join(root, "tmp", "local-examples"),
        "Local Pavi input",
      );
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

async function preparePoseSheet(window, sample, sourceBuffer) {
  const payload = JSON.stringify({
    id: sample.id,
    name: path.basename(sample.sourceSheet),
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
    document.querySelector('[data-testid="workflow-step-frames"]').click();

    const input = await waitFor(
      () => document.querySelector('[data-testid="pose-sheet-input"]'),
      'Pose-sheet input did not mount',
    );
    const bytes = Uint8Array.from(atob(payload.base64), (character) => character.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], payload.name, { type: 'image/png' }));
    Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
    input.dispatchEvent(new Event('change', { bubbles: true }));

    const importedFrames = await waitFor(() => {
      const images = [...document.querySelectorAll('[data-testid^="frame-slot-idle-"] img')];
      return images.length === 4 &&
        images.every((image) => image.complete && image.naturalWidth > 0)
        ? images
        : null;
    }, 'Pose sheet did not fill four idle slots');
    if (!importedFrames.every((image) =>
      image.naturalWidth === importedFrames[0].naturalWidth &&
      image.naturalHeight === importedFrames[0].naturalHeight
    )) {
      throw new Error('Pose sheet cells did not retain equal dimensions.');
    }
    const sourceCellSizes = importedFrames.map((image) => ({
      width: image.naturalWidth,
      height: image.naturalHeight,
    }));

    const processButton = await waitFor(
      () => document.querySelector('[data-testid="process-motion-frames"]'),
      'Motion batch processor did not mount',
    );
    if (processButton.disabled) throw new Error('Motion batch processor was unexpectedly disabled.');
    processButton.click();

    const status = await waitFor(() => {
      const value = document.querySelector('[data-testid="motion-frame-processing-status"]');
      if (value?.classList.contains('motion-batch-status--success')) return value;
      if (value?.classList.contains('motion-batch-status--error')) return value;
      return null;
    }, 'Pose frame processing timed out');
    if (status.classList.contains('motion-batch-status--error')) {
      throw new Error(status.textContent || 'Pose frame processing failed');
    }

    const processedFrames = await waitFor(() => {
      const images = [...document.querySelectorAll('[data-testid^="frame-slot-idle-"] img')];
      return images.length === 4 &&
        images.every((image) => image.complete && image.naturalWidth === 64 && image.naturalHeight === 64)
        ? images
        : null;
    }, 'Processed idle frames did not become 64 x 64');

    return {
      sourceCellSizes,
      frameSizes: processedFrames.map((image) => ({
        width: image.naturalWidth,
        height: image.naturalHeight,
      })),
      processingDetail: [
        status.querySelector('strong')?.textContent,
        status.querySelector('span')?.textContent,
      ]
        .map((value) => value?.replace(/\\s+/g, ' ').trim())
        .filter(Boolean)
        .join(' · '),
    };
  })()`, true);
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

    const dataUrls = project.frames.idle.filter(Boolean).map((frame) => frame.dataUrl);
    const expectedLoop = [0, 1, 2, 3, 0];
    const nonTransparentPixels = (image) => {
      const bitmap = image.toBitmap();
      let count = 0;
      for (let index = 3; index < bitmap.length; index += 4) {
        if (bitmap[index] > 0) count += 1;
      }
      return count;
    };

    const waitForFirstFrame = async () => {
      const startedAt = Date.now();
      while (Date.now() - startedAt < 5000) {
        const rendered = await petWindow.webContents.executeJavaScript(`(() => {
          const surface = document.querySelector('.pet-surface');
          const image = surface?.querySelector('img');
          return image
            ? {
                source: image.currentSrc || image.src,
                motionDriver: surface.dataset.motionDriver || '',
              }
            : null;
        })()`);
        if (rendered?.source === dataUrls[0]) return rendered;
        await wait(12);
      }
      throw new Error(`Desktop pet did not render the first frame: ${project.name}`);
    };
    const firstRendered = await waitForFirstFrame();
    if (firstRendered.motionDriver !== "frames") {
      throw new Error(`Desktop pet combined frame playback with CSS motion: ${project.name}`);
    }

    const observations = [];
    let previousSource = "";
    const observationStart = performance.now();
    while (
      performance.now() - observationStart < 5000 &&
      observations.length < expectedLoop.length
    ) {
      const rendered = await petWindow.webContents.executeJavaScript(`(() => {
        const surface = document.querySelector('.pet-surface');
        const image = surface?.querySelector('img');
        return image
          ? {
              source: image.currentSrc || image.src,
              motionDriver: surface.dataset.motionDriver || '',
            }
          : null;
      })()`);
      if (!rendered?.source || rendered.source === previousSource) {
        await wait(12);
        continue;
      }
      previousSource = rendered.source;
      const frameIndex = dataUrls.indexOf(rendered.source);
      if (frameIndex < 0) {
        throw new Error(`Desktop pet rendered an unknown frame: ${project.name}`);
      }
      if (rendered.motionDriver !== "frames") {
        throw new Error(`Desktop pet used an unexpected motion driver: ${project.name}`);
      }

      petWindow.webContents.invalidate();
      await wait(18);
      const capture = await petWindow.webContents.capturePage();
      const sourceAfterCapture = await petWindow.webContents.executeJavaScript(
        "document.querySelector('.pet-surface img')?.currentSrc || document.querySelector('.pet-surface img')?.src || ''",
      );
      if (sourceAfterCapture !== rendered.source) continue;
      const visiblePixels = nonTransparentPixels(capture);
      if (capture.isEmpty() || visiblePixels === 0) {
        throw new Error(`Desktop pet renderer was empty: ${project.name}`);
      }
      observations.push({
        index: frameIndex,
        atMs: Math.round(performance.now() - observationStart),
        capture: capture.getSize(),
        nonTransparentPixels: visiblePixels,
        captureSha256: sha256(capture.toPNG()),
      });
    }

    const observedLoop = observations.map((item) => item.index);
    if (JSON.stringify(observedLoop) !== JSON.stringify(expectedLoop)) {
      throw new Error(
        `Desktop pet frames were out of order for ${project.name}: ${observedLoop.join("→")}`,
      );
    }
    const intervals = observations
      .slice(1)
      .map((item, index) => item.atMs - observations[index].atMs);
    const targetInterval = 1000 / projectMotionFps(project, "idle");
    if (
      intervals.some(
        (interval) =>
          interval < targetInterval * 0.45 || interval > targetInterval * 1.8,
      )
    ) {
      throw new Error(
        `Desktop pet timing drifted for ${project.name}: ${intervals.join(", ")}ms`,
      );
    }

    return {
      status: runningState.status,
      animation: runningState.animation,
      size: runningState.size,
      position: runningState.position,
      windowVisible: petWindow.isVisible(),
      alwaysOnTop: petWindow.isAlwaysOnTop(),
      motionDriver: firstRendered.motionDriver,
      expectedLoop,
      observedLoop,
      intervalsMs: intervals,
      captures: observations,
      verificationPath:
        "exported project -> WindowManager.startPet -> chronological visible captures",
    };
  } finally {
    windows.stopPet();
  }
}

function pngDataUrlBuffer(dataUrl, label) {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=\r\n]+)$/.exec(dataUrl);
  if (!match) throw new Error(`${label}: expected an embedded PNG data URL`);
  return Buffer.from(match[1], "base64");
}

async function writeIdleFrames(project, generatedDirectory) {
  const frames = project.frames?.idle?.filter(Boolean) ?? [];
  if (frames.length !== 4) {
    throw new Error(`Expected four exported idle frames, got ${frames.length}.`);
  }
  await fs.rm(generatedDirectory, { recursive: true, force: true });
  await fs.mkdir(generatedDirectory, { recursive: true });
  const paths = [];
  for (let index = 0; index < frames.length; index += 1) {
    const output = path.join(
      generatedDirectory,
      `idle-${String(index + 1).padStart(2, "0")}.png`,
    );
    await fs.writeFile(
      output,
      pngDataUrlBuffer(frames[index].dataUrl, `idle frame ${index + 1}`),
    );
    paths.push(output);
  }
  return paths;
}

async function evaluateProjectFrames(project, projectLabel) {
  const { evaluateFrameSequence } = await import("./frame-quality.mjs");
  const idle = project.frames?.idle?.filter(Boolean) ?? [];
  const frames = await Promise.all(
    idle.map(async (frame, index) => {
      const [decoded, evidence] = await Promise.all([
        sharp(
          pngDataUrlBuffer(frame.dataUrl, `${projectLabel} idle frame ${index + 1}`),
        )
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true }),
        sharp(
          pngDataUrlBuffer(
            frame.originalDataUrl,
            `${projectLabel} idle original frame ${index + 1}`,
          ),
        )
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true }),
      ]);
      return {
        label: `${projectLabel}#idle-${index + 1}`,
        rgba: decoded.data,
        evidenceRgba: evidence.data,
        width: decoded.info.width,
        height: decoded.info.height,
        keyRgb: Array.isArray(frame.chromaKey) ? frame.chromaKey : null,
      };
    }),
  );
  return evaluateFrameSequence(frames);
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
  const sourceBuffer = await fs.readFile(sample.sourceSheet);
  const sourceMetadata = await sharp(sourceBuffer).metadata();
  if (
    !sourceMetadata.width ||
    !sourceMetadata.height ||
    sourceMetadata.width % 4 !== 0
  ) {
    throw new Error(`Pose sheet must contain four equal horizontal cells: ${sample.id}`);
  }
  const startedAt = new Date().toISOString();
  const poseResult = await preparePoseSheet(window, sample, sourceBuffer);

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
  if (projectMotionFps(project, "idle") !== 4) {
    throw new Error(`App export did not use the idle-safe 4 FPS setting: ${sample.id}`);
  }
  const idlePaths = await writeIdleFrames(project, generatedDirectory);
  const distinctIdleHashes = new Set(
    await Promise.all(
      idlePaths.map(async (output) => sha256(await fs.readFile(output))),
    ),
  );
  if (distinctIdleHashes.size !== 4) {
    throw new Error(`AI pose loop must contain four distinct frames: ${sample.id}`);
  }
  const qualityReport = await evaluateProjectFrames(project, sample.id);
  if (!qualityReport.passed) {
    throw new Error(
      `Frame quality gate failed for ${sample.id}: ${qualityReport.violations
        .map((violation) => violation.code)
        .join(", ")}`,
    );
  }
  const desktopPetVerification = await verifyDesktopPet(windows, window, project);

  const outputPaths = [projectPath, spriteSheetPath, ...idlePaths, previewPath];
  const outputHashes = {};
  for (const output of outputPaths) {
    outputHashes[relativeToRoot(output)] = sha256(await fs.readFile(output));
  }
  const firstFrame = project.frames.idle.find(Boolean);
  const runLog = {
    schemaVersion: "2.0.0",
    sampleId: sample.id,
    public: sample.public,
    startedAt,
    completedAt: new Date().toISOString(),
    source: {
      path: relativeToRoot(sample.sourceSheet),
      sha256: sha256(sourceBuffer),
      bytes: sourceBuffer.byteLength,
      sheet: {
        width: sourceMetadata.width,
        height: sourceMetadata.height,
        layout: "one horizontal row / four equal cells / left-to-right",
        cellWidth: sourceMetadata.width / 4,
        cellHeight: sourceMetadata.height,
      },
    },
    pipeline: {
      app: "PixelPet Studio",
      appVersion: packageJson.version,
      mode: "hidden-electron-browser-mode",
      entryPoint: "Step 2 / pose-sheet import and shared motion-frame processing",
      imageProcessing:
        "PixelPet Studio UI only after image generation; browser-canvas equal split, flat-chroma cleanup, shared alignment, export",
      sourceFrameSizes: poseResult.sourceCellSizes,
      backgroundRemoval: "flat-chroma-direct",
      backgroundRemovalModel: "not used for the uniform prompt background",
      flatChromaPostprocess: {
        applied: true,
        keyRgb: firstFrame.chromaKey,
        operations: [
          "key-distance matte",
          "despill",
          "HSV hue and chroma-direction residue detection",
          "exterior-boundary nearest-foreground color repair",
          "source and final-canvas fringe pass",
          "pixel hard-alpha",
        ],
      },
      fit:
        "robust body-row anchor stabilization with capped correction / shared union alpha bounds / one common scale and placement / nearest-neighbor",
      idlePreset: [
        "AI-authored neutral",
        "AI-authored inhale",
        "AI-authored local-part transition",
        "AI-authored exhale",
      ],
      canvas: { width: firstFrame.width, height: firstFrame.height },
      frameDiagnostics: qualityReport.diagnostics,
      transitions: qualityReport.transitions,
      processingDetail: poseResult.processingDetail,
      fps: projectMotionFps(project, "idle"),
      motionFps: project.motionFps,
      scale: project.scale,
    },
    qualityGate: {
      passed: qualityReport.passed,
      thresholds: qualityReport.thresholds,
      violations: qualityReport.violations,
      checks: [
        "no whole-character squash/stretch",
        "no excessive centroid or baseline jump",
        "no soft alpha",
        "no hue-preserving chroma fringe",
        "last-to-first loop boundary included",
      ],
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
      reason:
        "The image-generation step, frame UUIDs, timestamps, and animated captures can vary.",
      stableInputs:
        "The approved pose sheet SHA-256, app version, processing settings, quality diagnostics, and completed output hashes are recorded.",
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
      removal: runLog.pipeline.backgroundRemoval,
      quality: runLog.qualityGate.passed,
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
