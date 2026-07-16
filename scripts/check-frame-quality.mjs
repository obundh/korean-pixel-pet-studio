import { readFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { evaluateFrameSequence } from "./frame-quality.mjs";

const root = path.resolve(import.meta.dirname, "..");
const defaultProjects = [
  "haeori-sun-otter",
  "mongle-cloud-bear",
  "toto-sprout-turtle",
].map((id) => path.join(root, "examples", "beginner-pets", id, `${id}.pixelpet`));

function dataUrlBuffer(dataUrl, label) {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=\r\n]+)$/.exec(dataUrl);
  if (!match) throw new Error(`${label}: expected an embedded PNG data URL`);
  return Buffer.from(match[1], "base64");
}

async function loadIdleFrames(projectPath) {
  const project = JSON.parse(await readFile(projectPath, "utf8"));
  const idleFrames = project.frames?.idle?.filter(Boolean) ?? [];
  if (!idleFrames.length) throw new Error(`${projectPath}: idle animation has no frames`);

  return Promise.all(
    idleFrames.map(async (frame, index) => {
      const [decoded, evidence] = await Promise.all([
        sharp(
          dataUrlBuffer(frame.dataUrl, `${projectPath} idle frame ${index + 1}`),
        )
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true }),
        sharp(
          dataUrlBuffer(
            frame.originalDataUrl,
            `${projectPath} idle original frame ${index + 1}`,
          ),
        )
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true }),
      ]);
      return {
        label: `${path.basename(projectPath)}#idle-${index + 1}`,
        rgba: decoded.data,
        evidenceRgba: evidence.data,
        width: decoded.info.width,
        height: decoded.info.height,
        keyRgb: Array.isArray(frame.chromaKey) ? frame.chromaKey : null,
      };
    }),
  );
}

const arguments_ = process.argv.slice(2);
const jsonOnly = arguments_.includes("--json");
const requestedPaths = arguments_.filter((value) => value !== "--json");
const projectPaths = (requestedPaths.length ? requestedPaths : defaultProjects).map((value) =>
  path.resolve(value),
);
const reports = [];
let failed = false;

for (const projectPath of projectPaths) {
  try {
    const frames = await loadIdleFrames(projectPath);
    const report = evaluateFrameSequence(frames);
    reports.push({ project: path.relative(root, projectPath), ...report });
    if (!report.passed) failed = true;
  } catch (error) {
    failed = true;
    reports.push({
      project: path.relative(root, projectPath),
      passed: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

if (jsonOnly) {
  console.log(JSON.stringify(reports, null, 2));
} else {
  for (const report of reports) {
    if (report.error) {
      console.error(`FAIL ${report.project}: ${report.error}`);
      continue;
    }
    const status = report.passed ? "PASS" : "FAIL";
    console.log(`${status} ${report.project}`);
    for (const violation of report.violations) {
      console.error(`  - ${violation.code}: ${JSON.stringify(violation)}`);
    }
  }
}

if (failed) process.exitCode = 1;
