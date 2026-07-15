const { app, BrowserWindow } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

const {
  installAppProtocol,
  registerAppScheme,
  rendererEntryUrl,
} = require("../dist-electron/main/app-protocol.js");

app.setAppPath(path.resolve(__dirname, ".."));
registerAppScheme();

app.whenReady().then(async () => {
  await installAppProtocol();
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    show: false,
    backgroundColor: "#0a0b0e",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen: true,
    },
  });

  await window.loadURL(rendererEntryUrl("studio"));
  await window.webContents.executeJavaScript(`new Promise((resolve) => {
    const finish = () => setTimeout(resolve, 500);
    if (document.readyState === "complete") finish();
    else window.addEventListener("load", finish, { once: true });
  })`);

  const image = await window.webContents.capturePage();
  const output = path.resolve(__dirname, "..", "docs", "media", "studio.png");
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, image.toPNG());
  window.destroy();
  console.log(output);
  app.quit();
});
