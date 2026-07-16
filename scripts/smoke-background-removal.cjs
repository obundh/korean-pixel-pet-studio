const { app, BrowserWindow } = require("electron");
const path = require("node:path");

const {
  installAppProtocol,
  registerAppScheme,
  rendererEntryUrl,
} = require("../dist-electron/main/app-protocol.js");

app.setAppPath(path.resolve(__dirname, ".."));
registerAppScheme();

const timeout = (milliseconds, message) =>
  new Promise((_, reject) => setTimeout(() => reject(new Error(message)), milliseconds));

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
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
        const waitFor = async (predicate, message, limit = 120000) => {
          const started = performance.now();
          while (performance.now() - started < limit) {
            const value = predicate();
            if (value) return value;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          throw new Error(message);
        };
        const button = (label) => [...document.querySelectorAll('button')]
          .find((node) => node.textContent?.replace(/\\s+/g, ' ').trim().includes(label));

        await waitFor(() => button('프레임 가져오기'), 'studio did not mount', 15000);
        button('프레임 가져오기').click();
        const input = await waitFor(
          () => document.querySelector('[data-testid="bulk-motion-frames-input"]'),
          'frame input did not mount',
        );

        const canvas = document.createElement('canvas');
        canvas.width = 160;
        canvas.height = 160;
        const context = canvas.getContext('2d');
        context.fillStyle = '#f6f1e7';
        context.fillRect(0, 0, 160, 160);
        context.fillStyle = '#2667ff';
        context.beginPath();
        context.arc(80, 78, 47, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = '#ff6f61';
        context.fillRect(60, 65, 12, 12);
        context.fillRect(90, 65, 12, 12);
        const blob = await new Promise((resolve, reject) =>
          canvas.toBlob((value) => value ? resolve(value) : reject(new Error('fixture encode failed')), 'image/png')
        );
        const transfer = new DataTransfer();
        transfer.items.add(new File([blob], 'smoke-mascot.png', { type: 'image/png' }));
        Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
        input.dispatchEvent(new Event('change', { bubbles: true }));

        await waitFor(() => document.querySelector('.frame-slot.has-frame'), 'frame import failed');
        button('배경 제거하기').click();
        await waitFor(() => document.querySelector('.remove-workspace'), 'remove step did not mount');
        const removalButton = document.querySelector('.removal-console__actions .button--primary');
        if (!removalButton) throw new Error('background removal action did not mount');
        removalButton.click();
        await waitFor(
          () => document.querySelector('.removal-console--success') || document.querySelector('.removal-console--error'),
          'background removal timed out',
        );
        const error = document.querySelector('.removal-console--error');
        if (error) throw new Error(error.textContent || 'background removal failed');

        const image = document.querySelector('img[alt="현재 결과"]');
        await waitFor(() => image?.complete && image.naturalWidth > 0, 'result image did not decode');
        const resultCanvas = document.createElement('canvas');
        resultCanvas.width = image.naturalWidth;
        resultCanvas.height = image.naturalHeight;
        const resultContext = resultCanvas.getContext('2d');
        resultContext.drawImage(image, 0, 0);
        const corners = [
          [0, 0],
          [resultCanvas.width - 1, 0],
          [0, resultCanvas.height - 1],
          [resultCanvas.width - 1, resultCanvas.height - 1],
        ].map(([x, y]) => resultContext.getImageData(x, y, 1, 1).data[3]);
        const pixels = resultContext.getImageData(
          0,
          0,
          resultCanvas.width,
          resultCanvas.height,
        ).data;
        let foregroundPixels = 0;
        for (let index = 3; index < pixels.length; index += 4) {
          if (pixels[index] > 8) foregroundPixels += 1;
        }
        return {
          width: resultCanvas.width,
          height: resultCanvas.height,
          cornerAlpha: corners,
          foregroundPixels,
        };
      })()`, true),
      timeout(150000, "background-removal smoke test timed out"),
    ]);
    console.log(JSON.stringify(result));
    if (!result.cornerAlpha.every((alpha) => alpha <= 8)) {
      throw new Error(`background remained at the corners: ${result.cornerAlpha.join(",")}`);
    }
    const totalPixels = result.width * result.height;
    if (result.foregroundPixels < 1000 || result.foregroundPixels > totalPixels * 0.75) {
      throw new Error(`foreground segmentation was implausible: ${result.foregroundPixels}/${totalPixels}`);
    }
    window.destroy();
    app.quit();
  } catch (error) {
    console.error(error);
    window.destroy();
    app.exit(1);
  }
});
