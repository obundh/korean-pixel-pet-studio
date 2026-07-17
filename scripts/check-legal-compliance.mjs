import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packageJson = await readJson(resolve(root, "package.json"));
const packageLock = await readJson(resolve(root, "package-lock.json"));
const legalDirectory = resolve(root, "build", "legal");
const releaseMode = process.argv.includes("--release");
const packagedMode = process.argv.includes("--packaged");
const failures = [];
const warnings = [];

check(
  isVersionAtLeast(packageJson.version, "0.2.0"),
  "package.json version must be 0.2.0 or newer; do not overwrite v0.1.0 artifacts."
);
check(
  packageJson.license === "AGPL-3.0-or-later",
  "package.json must declare AGPL-3.0-or-later."
);
check(
  packageLock.version === packageJson.version &&
    packageLock.packages?.[""]?.version === packageJson.version,
  "package-lock.json version does not match package.json."
);
check(
  packageLock.packages?.[""]?.license === packageJson.license,
  "package-lock.json license does not match package.json."
);
check(
  packageJson.build?.extraResources?.some(
    (entry) => entry.from === "build/legal" && entry.to === "legal"
  ),
  "electron-builder must copy build/legal to resources/legal."
);

await verifyLegalBundle(legalDirectory, { verifySourceAssets: true });

const gitCommit = git(["rev-parse", "HEAD"]) ?? process.env.GITHUB_SHA ?? "unknown";
const gitStatus = git(["status", "--porcelain", "--untracked-files=normal"]);
const gitDirty = gitStatus === null ? null : gitStatus.length > 0;
const provenance = await readJsonSafe(resolve(legalDirectory, "BUILD_PROVENANCE.json"));
if (provenance) {
  check(
    provenance.version === packageJson.version,
    "BUILD_PROVENANCE.json has the wrong application version."
  );
  check(
    provenance.license === packageJson.license,
    "BUILD_PROVENANCE.json has the wrong application license."
  );
  check(
    provenance.source?.commit === gitCommit,
    "BUILD_PROVENANCE.json does not identify the current source commit."
  );
  check(
    provenance.source?.workingTreeDirty === gitDirty,
    "BUILD_PROVENANCE.json no longer matches the current working-tree state."
  );
}

const sourceOffer = await readTextSafe(resolve(legalDirectory, "SOURCE_OFFER.txt"));
if (sourceOffer) {
  check(
    sourceOffer.includes(`Exact commit: ${gitCommit}`),
    "SOURCE_OFFER.txt does not identify the current source commit."
  );
  if (gitDirty === true) {
    check(
      sourceOffer.includes("Do not redistribute this development build."),
      "A dirty build must be clearly marked as non-redistributable."
    );
  }
}

if (releaseMode) {
  check(gitCommit !== "unknown", "A redistributable build requires a known Git commit.");
  check(gitDirty === false, "Refusing to package a dirty working tree.");

  const expectedTag = `v${packageJson.version}`;
  const githubTag =
    process.env.GITHUB_REF_TYPE === "tag" ||
    process.env.GITHUB_REF?.startsWith("refs/tags/");
  if (githubTag) {
    const actualTag =
      process.env.GITHUB_REF_NAME ??
      process.env.GITHUB_REF?.replace(/^refs\/tags\//, "");
    check(
      actualTag === expectedTag,
      `Release tag ${String(actualTag)} must match package version ${expectedTag}.`
    );
  } else {
    const localTags =
      git(["tag", "--points-at", gitCommit])
        ?.split(/\r?\n/)
        .filter(Boolean) ?? [];
    if (!localTags.includes(expectedTag)) {
      warnings.push(
        `Commit is not tagged ${expectedTag}. This is acceptable for a private test package, but publish only from that version tag.`
      );
    }
  }
}

if (packagedMode) {
  const packagedLegalDirectories = await findPackagedLegalDirectories(
    resolve(root, "release")
  );
  check(
    packagedLegalDirectories.length > 0,
    "No packaged resources/legal directory was found under release/."
  );
  for (const directory of packagedLegalDirectories) {
    await verifyLegalBundle(directory, { verifySourceAssets: false });
  }
}

for (const warning of warnings) console.warn(`LEGAL WARNING: ${warning}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`LEGAL ERROR: ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `Legal compliance check passed${packagedMode ? " (source + packaged apps)" : ""}.`
  );
}

async function verifyLegalBundle(directory, { verifySourceAssets }) {
  const imglyPackage = await readJsonSafe(
    resolve(root, "node_modules", "@imgly", "background-removal", "package.json")
  );
  const electronPackage = await readJsonSafe(
    resolve(root, "node_modules", "electron", "package.json")
  );
  const imglyVersion = imglyPackage?.version ?? "1.7.0";
  const electronVersion = electronPackage?.version;
  const dataPackage = await readJsonSafe(
    resolve(
      directory,
      `IMG.LY-background-removal-data-${imglyVersion}-package.json`
    )
  );
  const stableOnnxVersion =
    imglyPackage?.peerDependencies?.["onnxruntime-web"] ?? "1.21.0";
  const dataOnnxVersion = dataPackage?.dependencies?.["onnxruntime-web"];

  const requiredFiles = [
    "PixelPet-Studio-LICENSE.txt",
    "THIRD_PARTY_NOTICES.md",
    "SOURCE_OFFER.txt",
    "BUILD_PROVENANCE.json",
    "LEGAL_ASSET_MANIFEST.json",
    "NPM_RUNTIME_DEPENDENCIES.json",
    "RUNTIME_DEPENDENCY_SBOM.spdx.json",
    `IMG.LY-background-removal-${imglyVersion}-LICENSE.md`,
    `IMG.LY-background-removal-${imglyVersion}-ThirdPartyLicenses.json`,
    `IMG.LY-background-removal-${imglyVersion}-package.json`,
    `IMG.LY-background-removal-data-${imglyVersion}-LICENSE.md`,
    `IMG.LY-background-removal-data-${imglyVersion}-ThirdPartyLicenses.json`,
    `IMG.LY-background-removal-data-${imglyVersion}-package.json`,
    "DIS-b6764e20381f6f42a70f83fa3324181529ed1403-Apache-2.0-LICENSE.md",
    `ONNX-Runtime-Web-${stableOnnxVersion}-runtime-LICENSE.txt`,
    `ONNX-Runtime-Web-${stableOnnxVersion}-runtime-ThirdPartyNotices.txt`
  ];
  if (dataOnnxVersion) {
    requiredFiles.push(
      `ONNX-Runtime-Web-${dataOnnxVersion}-data-runtime-LICENSE.txt`,
      `ONNX-Runtime-Web-${dataOnnxVersion}-data-runtime-ThirdPartyNotices.txt`
    );
  } else {
    failures.push(`${directory}: data package does not identify its ONNX Runtime version.`);
  }
  if (electronVersion) {
    requiredFiles.push(
      `Electron-${electronVersion}-LICENSE.txt`,
      `Electron-${electronVersion}-LICENSES.chromium.html`
    );
  } else {
    failures.push("Installed Electron package metadata is unavailable.");
  }

  for (const name of requiredFiles) {
    const path = resolve(directory, name);
    try {
      const info = await stat(path);
      check(info.isFile() && info.size > 0, `${path} is empty or is not a file.`);
    } catch {
      failures.push(`${path} is missing.`);
    }
  }

  const projectLicense = await readTextSafe(
    resolve(directory, "PixelPet-Studio-LICENSE.txt")
  );
  if (projectLicense) {
    check(
      /GNU AFFERO GENERAL PUBLIC LICENSE/i.test(projectLicense),
      `${directory}: project license is not the GNU AGPL text.`
    );
  }

  const imglyLicense = await readTextSafe(
    resolve(directory, `IMG.LY-background-removal-${imglyVersion}-LICENSE.md`)
  );
  if (imglyLicense) {
    check(
      /GNU Affero General Public License/i.test(imglyLicense),
      `${directory}: IMG.LY AGPL license text is invalid.`
    );
  }

  const dependencies = await readJsonSafe(
    resolve(directory, "NPM_RUNTIME_DEPENDENCIES.json")
  );
  if (dependencies) {
    check(Array.isArray(dependencies), `${directory}: dependency manifest is not an array.`);
    for (const rootDependency of Object.keys(packageJson.dependencies ?? {})) {
      check(
        dependencies.some((entry) => entry.name === rootDependency),
        `${directory}: dependency manifest omits ${rootDependency}.`
      );
    }
    for (const dependency of dependencies) {
      for (const legalFile of dependency.bundledLegalFiles ?? []) {
        try {
          const info = await stat(resolve(directory, legalFile));
          check(
            info.isFile() && info.size > 0,
            `${directory}: dependency notice ${legalFile} is empty.`
          );
        } catch {
          failures.push(`${directory}: dependency notice ${legalFile} is missing.`);
        }
      }
    }
  }

  const sbom = await readJsonSafe(
    resolve(directory, "RUNTIME_DEPENDENCY_SBOM.spdx.json")
  );
  if (sbom) {
    check(sbom.spdxVersion === "SPDX-2.3", `${directory}: SBOM is not SPDX 2.3.`);
    check(
      sbom.packages?.length === (dependencies?.length ?? -1) + 1,
      `${directory}: SBOM package count does not match the dependency manifest.`
    );
  }

  if (verifySourceAssets) {
    await verifyProjectFilesMatch(directory);
    await verifyBackgroundAssetHashes(directory);
  }
}

async function verifyProjectFilesMatch(directory) {
  for (const [source, bundled] of [
    ["LICENSE", "PixelPet-Studio-LICENSE.txt"],
    ["THIRD_PARTY_NOTICES.md", "THIRD_PARTY_NOTICES.md"]
  ]) {
    try {
      const [sourceBuffer, bundledBuffer] = await Promise.all([
        readFile(resolve(root, source)),
        readFile(resolve(directory, bundled))
      ]);
      check(
        sha256(sourceBuffer) === sha256(bundledBuffer),
        `${bundled} is stale; run npm run prepare:legal again.`
      );
    } catch {
      failures.push(`Could not compare ${source} with ${bundled}.`);
    }
  }
}

async function verifyBackgroundAssetHashes(directory) {
  const manifest = await readJsonSafe(resolve(directory, "LEGAL_ASSET_MANIFEST.json"));
  if (!manifest) return;

  try {
    const resourcesManifest = await readFile(
      resolve(root, "public", manifest.resourcesManifest.path)
    );
    check(
      resourcesManifest.byteLength === manifest.resourcesManifest.size &&
        sha256(resourcesManifest) === manifest.resourcesManifest.sha256,
      "Bundled background-removal resources.json does not match its legal manifest."
    );
  } catch {
    failures.push("Could not verify public/background-removal/resources.json.");
  }

  for (const file of manifest.files ?? []) {
    try {
      const buffer = await readFile(
        resolve(root, "public", "background-removal", file.name)
      );
      check(
        buffer.byteLength === file.size && sha256(buffer) === file.sha256,
        `Background-removal asset hash mismatch: ${file.name}.`
      );
    } catch {
      failures.push(`Background-removal asset is missing: ${file.name}.`);
    }
  }
}

async function findPackagedLegalDirectories(releaseDirectory) {
  const matches = [];
  async function visit(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const path = resolve(directory, entry.name);
      if (
        entry.name === "legal" &&
        ["resources", "Resources"].includes(basename(dirname(path)))
      ) {
        matches.push(path);
      } else {
        await visit(path);
      }
    }
  }
  await visit(releaseDirectory);
  return matches.sort();
}

function check(condition, message) {
  if (!condition) failures.push(message);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readJsonSafe(path) {
  try {
    return await readJson(path);
  } catch (error) {
    failures.push(`${path} is missing or is not valid JSON (${error.message}).`);
    return null;
  }
}

async function readTextSafe(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    failures.push(`${path} is missing or unreadable (${error.message}).`);
    return null;
  }
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function git(args) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return null;
  }
}

function isVersionAtLeast(actual, minimum) {
  const actualParts = String(actual).split("-")[0].split(".").map(Number);
  const minimumParts = String(minimum).split("-")[0].split(".").map(Number);
  if (
    actualParts.length !== 3 ||
    minimumParts.length !== 3 ||
    [...actualParts, ...minimumParts].some(Number.isNaN)
  ) {
    return false;
  }
  for (let index = 0; index < 3; index += 1) {
    if (actualParts[index] > minimumParts[index]) return true;
    if (actualParts[index] < minimumParts[index]) return false;
  }
  return true;
}
