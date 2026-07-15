const { app, BrowserWindow } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

const {
  installAppProtocol,
  registerAppScheme,
} = require("../dist-electron/main/app-protocol.js");
const { WindowManager } = require("../dist-electron/main/window-manager.js");

const root = path.resolve(__dirname, "..");
app.setAppPath(root);
registerAppScheme();

app.whenReady().then(async () => {
  const windows = new WindowManager();
  try {
    await installAppProtocol();
    const png = await fs.readFile(
      path.resolve(root, "reference-kits/images/example-pets/bori-cloud-fox-preview.png"),
    );
    const now = new Date().toISOString();
    const frame = {
      id: "smoke-frame",
      name: "bori-cloud-fox-preview.png",
      dataUrl: `data:image/png;base64,${png.toString("base64")}`,
      originalDataUrl: `data:image/png;base64,${png.toString("base64")}`,
      width: 64,
      height: 64,
      backgroundRemoved: true,
      updatedAt: now,
    };
    const project = {
      version: 1,
      name: "PixelPet smoke test",
      activeKitId: "bori-cloud-fox:soft-cluster-16",
      frames: { idle: [frame], walk: [], jump: [], sleep: [], reaction: [] },
      fps: 8,
      scale: 3,
      createdAt: now,
      updatedAt: now,
    };

    const state = await windows.startPet({
      project,
      animation: "idle",
      motion: { velocityX: 0, velocityY: 0, bounce: true },
    });
    await new Promise((resolve) => setTimeout(resolve, 600));
    const petWindow = BrowserWindow.getAllWindows().find(
      (window) => window.isAlwaysOnTop() && window.isVisible(),
    );
    if (!petWindow) throw new Error("desktop pet window was not visible");
    const capture = await petWindow.webContents.capturePage();
    if (capture.isEmpty()) throw new Error("desktop pet renderer was empty");

    console.log(JSON.stringify({
      status: state.status,
      size: state.size,
      position: state.position,
      capture: capture.getSize(),
    }));
    windows.dispose();
    app.quit();
  } catch (error) {
    console.error(error);
    windows.dispose();
    app.exit(1);
  }
});
