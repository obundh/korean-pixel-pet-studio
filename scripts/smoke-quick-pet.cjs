const { app, BrowserWindow } = require("electron");
const path = require("node:path");

const {
  installAppProtocol,
  registerAppScheme,
  rendererEntryUrl,
} = require("../dist-electron/main/app-protocol.js");

// GitHub's ephemeral Linux runner cannot grant Electron's downloaded helper
// the root-owned SUID sandbox bit. Keep the exception explicit and CI-only;
// normal app and local smoke runs retain Electron's sandbox.
if (process.platform === "linux" && process.env.PIXELPET_SMOKE_NO_SANDBOX === "1") {
  app.commandLine.appendSwitch("no-sandbox");
}

app.setAppPath(path.resolve(__dirname, ".."));
registerAppScheme();

const timeout = (milliseconds, message) =>
  new Promise((_, reject) => setTimeout(() => reject(new Error(message)), milliseconds));

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1280,
    height: 900,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen: true,
    },
  });

  try {
    await installAppProtocol();
    await window.loadURL(rendererEntryUrl("studio"));
    const result = await Promise.race([
      window.webContents.executeJavaScript(`(async () => {
        const waitFor = async (predicate, message, limit = 150000) => {
          const started = performance.now();
          while (performance.now() - started < limit) {
            const value = predicate();
            if (value) return value;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          throw new Error(message);
        };
        const makeFixture = async (transparent, name) => {
          const canvas = document.createElement('canvas');
          canvas.width = 160;
          canvas.height = 160;
          const context = canvas.getContext('2d');
          if (!transparent) {
            context.fillStyle = '#ff00ff';
            context.fillRect(0, 0, 160, 160);
          }
          context.fillStyle = '#2667ff';
          context.beginPath();
          context.arc(80, 82, 46, 0, Math.PI * 2);
          context.fill();
          context.fillStyle = '#ffda44';
          context.fillRect(61, 69, 12, 12);
          context.fillRect(87, 69, 12, 12);
          const blob = await new Promise((resolve, reject) =>
            canvas.toBlob((value) => value ? resolve(value) : reject(new Error('fixture encode failed')), 'image/png')
          );
          return new File([blob], name, { type: 'image/png' });
        };
        const importQuick = async (file, expectedRemoval, expectedChromaCleanup) => {
          const input = document.querySelector('[data-testid="quick-pet-file-input"]');
          if (!input) throw new Error('quick-pet input did not mount');
          const transfer = new DataTransfer();
          transfer.items.add(file);
          Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
          input.dispatchEvent(new Event('change', { bubbles: true }));
          const card = await waitFor(() => {
            const value = document.querySelector('[data-testid="quick-pet-card"]');
            const finished = value?.dataset.phase === 'success' || value?.dataset.phase === 'error';
            return finished && value.dataset.fileName === file.name ? value : null;
          }, 'quick-pet processing timed out');
          if (card.dataset.phase === 'error') {
            throw new Error(document.querySelector('[data-testid="quick-pet-progress"]')?.textContent || 'quick-pet failed');
          }
          if (card.dataset.backgroundRemoval !== expectedRemoval) {
            throw new Error('unexpected removal mode: ' + card.dataset.backgroundRemoval);
          }
          if (card.dataset.chromaCleanup !== expectedChromaCleanup) {
            throw new Error('unexpected chroma cleanup: ' + card.dataset.chromaCleanup);
          }
          const key = card.dataset.chromaKey
            ? card.dataset.chromaKey.split(',').map(Number)
            : null;
          const images = [...document.querySelectorAll('[data-testid="quick-pet-result"] img')];
          if (images.length !== 4) throw new Error('expected four quick-pet frames, got ' + images.length);
          await waitFor(() => images.every((image) => image.complete && image.naturalWidth > 0), 'quick frames did not decode');
          return Promise.all(images.map(async (image) => {
            const canvas = document.createElement('canvas');
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            const context = canvas.getContext('2d');
            context.drawImage(image, 0, 0);
            const corners = [
              [0, 0],
              [canvas.width - 1, 0],
              [0, canvas.height - 1],
              [canvas.width - 1, canvas.height - 1],
            ].map(([x, y]) => context.getImageData(x, y, 1, 1).data[3]);
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
            let softAlpha = 0;
            let chromaFringe = 0;
            let opaquePixels = 0;
            for (let index = 0; index < pixels.length; index += 4) {
              const alpha = pixels[index + 3];
              if (alpha !== 0 && alpha !== 255) softAlpha += 1;
              if (alpha === 255) opaquePixels += 1;
              if (key && alpha > 0) {
                const distance = Math.hypot(
                  pixels[index] - key[0],
                  pixels[index + 1] - key[1],
                  pixels[index + 2] - key[2],
                );
                if (distance < 80) chromaFringe += 1;
              }
            }
            return { width: canvas.width, height: canvas.height, corners, softAlpha, chromaFringe, opaquePixels };
          }));
        };

        await waitFor(() => document.querySelector('[data-testid="workflow-step-remove"]'), 'studio did not mount', 15000);
        document.querySelector('[data-testid="workflow-step-remove"]').click();
        await waitFor(() => document.querySelector('[data-testid="quick-pet-file-input"]'), 'remove step did not mount');
        const opaque = await importQuick(
          await makeFixture(false, 'opaque-mascot.png'),
          'performed',
          'applied',
        );
        const manualButton = document.querySelector('[data-testid="manual-remove-background"]');
        const quickButton = document.querySelector('[data-testid="quick-pet-choose"]');
        if (!manualButton || !quickButton || manualButton.disabled) {
          throw new Error('manual re-clean button was not ready after quick-pet');
        }
        manualButton.click();
        await waitFor(
          () => manualButton.disabled && quickButton.disabled,
          'quick/manual shared mutex did not lock both controls',
        );
        const navigationButton = document.querySelector('[data-testid="workflow-step-frames"]');
        if (!navigationButton?.disabled) throw new Error('workflow navigation remained active during image processing');
        await waitFor(
          () => !manualButton.disabled && !quickButton.disabled,
          'manual background re-clean did not finish',
        );
        const manuallyCleanedImage = document.querySelector('[data-testid="quick-pet-frame-0"] img');
        await waitFor(
          () => manuallyCleanedImage?.complete && manuallyCleanedImage.naturalWidth > 0,
          'manually re-cleaned frame did not decode',
        );
        const manualCanvas = document.createElement('canvas');
        manualCanvas.width = manuallyCleanedImage.naturalWidth;
        manualCanvas.height = manuallyCleanedImage.naturalHeight;
        const manualContext = manualCanvas.getContext('2d');
        manualContext.drawImage(manuallyCleanedImage, 0, 0);
        const manualPixels = manualContext.getImageData(0, 0, manualCanvas.width, manualCanvas.height).data;
        const manualKey = document.querySelector('[data-testid="quick-pet-card"]').dataset.chromaKey.split(',').map(Number);
        let manualOpaquePixels = 0;
        let manualSoftAlpha = 0;
        let manualChromaFringe = 0;
        for (let index = 0; index < manualPixels.length; index += 4) {
          const alpha = manualPixels[index + 3];
          if (alpha === 255) manualOpaquePixels += 1;
          else if (alpha !== 0) manualSoftAlpha += 1;
          if (
            alpha > 0 &&
            Math.hypot(
              manualPixels[index] - manualKey[0],
              manualPixels[index + 1] - manualKey[1],
              manualPixels[index + 2] - manualKey[2],
            ) < 80
          ) {
            manualChromaFringe += 1;
          }
        }
        const manualCorners = [
          [0, 0],
          [manualCanvas.width - 1, 0],
          [0, manualCanvas.height - 1],
          [manualCanvas.width - 1, manualCanvas.height - 1],
        ].map(([x, y]) => manualContext.getImageData(x, y, 1, 1).data[3]);
        const manualReclean = {
          width: manualCanvas.width,
          height: manualCanvas.height,
          corners: manualCorners,
          opaquePixels: manualOpaquePixels,
          softAlpha: manualSoftAlpha,
          chromaFringe: manualChromaFringe,
        };
        const transparent = await importQuick(
          await makeFixture(true, 'transparent-mascot.png'),
          'skipped',
          'not-needed',
        );
        return { opaque, manualReclean, transparent };
      })()`, true),
      timeout(180000, "quick-pet smoke test timed out"),
    ]);

    for (const mode of ["opaque", "transparent"]) {
      if (
        !result[mode].every(
          (frame) =>
            frame.width === 64 &&
            frame.height === 64 &&
            frame.corners.every((alpha) => alpha === 0) &&
            frame.opaquePixels > 100 &&
            (mode !== "opaque" || frame.softAlpha === 0) &&
            frame.chromaFringe === 0,
        )
      ) {
        throw new Error(`invalid ${mode} quick-pet frames: ${JSON.stringify(result[mode])}`);
      }
    }
    if (
      result.manualReclean.width !== 64 ||
      result.manualReclean.height !== 64 ||
      !result.manualReclean.corners.every((alpha) => alpha === 0) ||
      result.manualReclean.opaquePixels <= 100 ||
      result.manualReclean.softAlpha !== 0 ||
      result.manualReclean.chromaFringe !== 0
    ) {
      throw new Error(`invalid manual chroma re-clean: ${JSON.stringify(result.manualReclean)}`);
    }
    console.log(JSON.stringify(result));
    window.destroy();
    app.quit();
  } catch (error) {
    console.error(error);
    window.destroy();
    app.exit(1);
  }
});
