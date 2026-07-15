import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const PACKAGE_VERSION = "1.7.0";
const CDN_ROOT = `https://staticimgly.com/@imgly/background-removal-data/${PACKAGE_VERSION}/dist/`;
const root = resolve(import.meta.dirname, "..");
const destination = resolve(root, "public", "background-removal");
const manifestPath = resolve(destination, "resources.json");

const requiredResources = new Set([
  "/onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm",
  "/onnxruntime-web/ort-wasm-simd-threaded.wasm",
  "/onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs",
  "/onnxruntime-web/ort-wasm-simd-threaded.mjs",
  "/models/isnet_quint8"
]);

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Asset download failed (${response.status}): ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function hasMatchingSize(path, size) {
  try {
    return (await stat(path)).size === size;
  } catch {
    return false;
  }
}

async function loadChunk(name) {
  try {
    return await readFile(resolve(root, "tmp", "imgly-data", "package", "dist", name));
  } catch {
    return download(`${CDN_ROOT}${name}`);
  }
}

await mkdir(destination, { recursive: true });

let fullManifest;
try {
  fullManifest = JSON.parse(await readFile(resolve(root, "tmp", "imgly-data", "package", "dist", "resources.json"), "utf8"));
} catch {
  fullManifest = JSON.parse((await download(`${CDN_ROOT}resources.json`)).toString("utf8"));
}

const bundledManifest = Object.fromEntries(
  Object.entries(fullManifest).filter(([resource]) => requiredResources.has(resource))
);

if (Object.keys(bundledManifest).length !== requiredResources.size) {
  throw new Error("IMG.LY resource manifest did not contain every required runtime asset.");
}

const chunks = new Map();
for (const resource of Object.values(bundledManifest)) {
  for (const chunk of resource.chunks) {
    chunks.set(chunk.name, chunk.offsets[1] - chunk.offsets[0]);
  }
}

let downloaded = 0;
for (const [name, expectedSize] of chunks) {
  const output = resolve(destination, name);
  if (await hasMatchingSize(output, expectedSize)) continue;
  await writeFile(output, await loadChunk(name));
  downloaded += 1;
}

await writeFile(manifestPath, `${JSON.stringify(bundledManifest, null, 2)}\n`);
console.log(`Background-removal runtime ready (${chunks.size} chunks, ${downloaded} downloaded).`);
