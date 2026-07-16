import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "build", "legal");
const cache = resolve(root, "tmp", "legal-cache");
const backgroundAssets = resolve(root, "public", "background-removal");

const packageJson = await readJson(resolve(root, "package.json"));
const packageLock = await readJson(resolve(root, "package-lock.json"));
const repositoryUrl = normalizeRepositoryUrl(packageJson.repository);
const commit = git(["rev-parse", "HEAD"]) ?? process.env.GITHUB_SHA ?? "unknown";
const gitStatus = git(["status", "--porcelain", "--untracked-files=normal"]);
const dirty = gitStatus === null ? null : gitStatus.length > 0;
const exactTags =
  git(["tag", "--points-at", commit])
    ?.split(/\r?\n/)
    .filter(Boolean)
    .sort() ?? [];
const versionTag = exactTags.find((tag) => tag === `v${packageJson.version}`) ?? null;

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await mkdir(cache, { recursive: true });

await copyRequired(
  resolve(root, "LICENSE"),
  resolve(output, "PixelPet-Studio-LICENSE.txt")
);
await copyRequired(
  resolve(root, "THIRD_PARTY_NOTICES.md"),
  resolve(output, "THIRD_PARTY_NOTICES.md")
);

for (const [source, destination] of [
  ["ASSET_LICENSE.md", "ASSET_LICENSE.md"],
  ["ASSETS_LICENSE.md", "ASSETS_LICENSE.md"],
  ["MODEL_PROVENANCE.md", "MODEL_PROVENANCE.md"],
  ["SOURCE_OFFER.md", "SOURCE_OFFER.md"],
  ["CONTRIBUTING.md", "CONTRIBUTING.md"],
  ["TRADEMARKS.md", "TRADEMARKS.md"],
  ["docs/assets/APP_ICON_SOURCE_AND_RIGHTS.md", "APP_ICON_SOURCE_AND_RIGHTS.md"],
  ["build/ICON_SOURCE_AND_RIGHTS.md", "APP_ICON_SOURCE_AND_RIGHTS.md"]
]) {
  await copyOptional(resolve(root, source), resolve(output, destination));
}
await copyDirectoryOptional(resolve(root, "legal"), resolve(output, "project"));

const imglyPackageDir = resolve(root, "node_modules", "@imgly", "background-removal");
const imglyPackage = await readJson(resolve(imglyPackageDir, "package.json"));
await copyRequired(
  resolve(imglyPackageDir, "LICENSE.md"),
  resolve(output, `IMG.LY-background-removal-${imglyPackage.version}-LICENSE.md`)
);
await copyRequired(
  resolve(imglyPackageDir, "ThirdPartyLicenses.json"),
  resolve(
    output,
    `IMG.LY-background-removal-${imglyPackage.version}-ThirdPartyLicenses.json`
  )
);
await writeJson(
  resolve(output, `IMG.LY-background-removal-${imglyPackage.version}-package.json`),
  imglyPackage
);

const dataVersion = imglyPackage.version;
const dataBaseUrl = `https://staticimgly.com/@imgly/background-removal-data/${dataVersion}`;
const dataPackageBuffer = await downloadCached(
  `${dataBaseUrl}/package.json`,
  `imgly-background-removal-data-${dataVersion}-package.json`,
  resolve(root, "tmp", "imgly-data", "package", "package.json")
);
const dataPackage = JSON.parse(dataPackageBuffer.toString("utf8"));
const dataLicense = await downloadCached(
  `${dataBaseUrl}/LICENSE.md`,
  `imgly-background-removal-data-${dataVersion}-LICENSE.md`,
  resolve(imglyPackageDir, "LICENSE.md")
);
const dataThirdParty = await downloadCached(
  `${dataBaseUrl}/ThirdPartyLicenses.json`,
  `imgly-background-removal-data-${dataVersion}-ThirdPartyLicenses.json`,
  resolve(root, "tmp", "imgly-data", "package", "ThirdPartyLicenses.json")
);
JSON.parse(dataThirdParty.toString("utf8"));
const disRevision = "b6764e20381f6f42a70f83fa3324181529ed1403";
const disLicense = await downloadCached(
  `https://raw.githubusercontent.com/xuebinqin/DIS/${disRevision}/LICENSE.md`,
  `DIS-${disRevision}-LICENSE.md`
);
await writeFile(
  resolve(output, `IMG.LY-background-removal-data-${dataVersion}-LICENSE.md`),
  dataLicense
);
await writeFile(
  resolve(
    output,
    `IMG.LY-background-removal-data-${dataVersion}-ThirdPartyLicenses.json`
  ),
  dataThirdParty
);
await writeJson(
  resolve(output, `IMG.LY-background-removal-data-${dataVersion}-package.json`),
  dataPackage
);
await writeFile(
  resolve(output, `DIS-${disRevision}-Apache-2.0-LICENSE.md`),
  disLicense
);

const stableOnnxVersion = imglyPackage.peerDependencies?.["onnxruntime-web"];
const dataOnnxVersion = dataPackage.dependencies?.["onnxruntime-web"];
if (!stableOnnxVersion || !dataOnnxVersion) {
  throw new Error("Could not determine both ONNX Runtime versions used by IMG.LY.");
}

await prepareOnnxNotices(stableOnnxVersion, `v${stableOnnxVersion}`, "runtime");
const dataOnnxRevision = dataOnnxVersion.split("-").at(-1);
if (!dataOnnxRevision || dataOnnxRevision === dataOnnxVersion) {
  throw new Error(`Could not determine the ONNX Runtime revision from ${dataOnnxVersion}.`);
}
await prepareOnnxNotices(dataOnnxVersion, dataOnnxRevision, "data-runtime");

const electronDir = resolve(root, "node_modules", "electron");
const electronPackage = await readJson(resolve(electronDir, "package.json"));
await copyRequired(
  resolve(electronDir, "dist", "LICENSE"),
  resolve(output, `Electron-${electronPackage.version}-LICENSE.txt`)
);
await copyRequired(
  resolve(electronDir, "dist", "LICENSES.chromium.html"),
  resolve(output, `Electron-${electronPackage.version}-LICENSES.chromium.html`)
);

const runtimeDependencies = await prepareRuntimeDependencyNotices();
await writeJson(
  resolve(output, "NPM_RUNTIME_DEPENDENCIES.json"),
  runtimeDependencies
);
await writeJson(
  resolve(output, "RUNTIME_DEPENDENCY_SBOM.spdx.json"),
  createSpdxSbom(runtimeDependencies)
);

const legalAssetManifest = await createLegalAssetManifest(dataVersion);
await writeJson(resolve(output, "LEGAL_ASSET_MANIFEST.json"), legalAssetManifest);

const sourceArchive =
  repositoryUrl && commit !== "unknown"
    ? `${repositoryUrl}/archive/${commit}.zip`
    : null;
const provenance = {
  schemaVersion: 1,
  product: packageJson.build?.productName ?? packageJson.name,
  packageName: packageJson.name,
  version: packageJson.version,
  license: packageJson.license,
  generatedAt: new Date().toISOString(),
  source: {
    repository: repositoryUrl,
    commit,
    tag: versionTag,
    archive: sourceArchive,
    workingTreeDirty: dirty
  },
  buildEnvironment: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    githubRef: process.env.GITHUB_REF ?? null,
    githubRunId: process.env.GITHUB_RUN_ID ?? null
  },
  bundledRuntime: {
    imglyBackgroundRemoval: imglyPackage.version,
    imglyBackgroundRemovalData: dataPackage.version,
    onnxRuntimeWeb: stableOnnxVersion,
    onnxRuntimeDataAssets: dataOnnxVersion,
    electron: electronPackage.version
  },
  assetManifest: "LEGAL_ASSET_MANIFEST.json",
  dependencyManifest: "NPM_RUNTIME_DEPENDENCIES.json",
  sbom: "RUNTIME_DEPENDENCY_SBOM.spdx.json"
};
await writeJson(resolve(output, "BUILD_PROVENANCE.json"), provenance);
await writeFile(
  resolve(output, "SOURCE_OFFER.txt"),
  createSourceOffer({ packageJson, repositoryUrl, commit, sourceArchive, dirty, versionTag })
);

console.log(
  `Legal bundle ready (${runtimeDependencies.length} runtime packages, commit ${commit.slice(0, 12)}, dirty=${String(dirty)}).`
);

async function prepareOnnxNotices(version, revision, role) {
  const baseUrl = `https://raw.githubusercontent.com/microsoft/onnxruntime/${revision}`;
  const safeVersion = sanitize(version);
  const license = await downloadCached(
    `${baseUrl}/LICENSE`,
    `onnxruntime-${safeVersion}-LICENSE.txt`
  );
  const thirdParty = await downloadCached(
    `${baseUrl}/ThirdPartyNotices.txt`,
    `onnxruntime-${safeVersion}-ThirdPartyNotices.txt`
  );
  await writeFile(
    resolve(output, `ONNX-Runtime-Web-${version}-${role}-LICENSE.txt`),
    license
  );
  await writeFile(
    resolve(output, `ONNX-Runtime-Web-${version}-${role}-ThirdPartyNotices.txt`),
    thirdParty
  );
}

async function prepareRuntimeDependencyNotices() {
  const dependencies = [];
  const npmOutput = resolve(output, "dependencies");
  await mkdir(npmOutput, { recursive: true });

  for (const [packagePath, lockEntry] of Object.entries(packageLock.packages ?? {})) {
    if (!packagePath.startsWith("node_modules/") || lockEntry.dev) continue;

    const directory = resolve(root, packagePath);
    const metadataPath = resolve(directory, "package.json");
    let metadata;
    try {
      metadata = await readJson(metadataPath);
    } catch {
      throw new Error(`Installed runtime dependency is missing: ${packagePath}`);
    }

    const noticeDirectory = resolve(
      npmOutput,
      `${sanitize(metadata.name)}-${sanitize(metadata.version)}`
    );
    const legalFiles = (
      await readdir(directory, { withFileTypes: true })
    )
      .filter(
        (entry) =>
          entry.isFile() &&
          /^(licen[cs]e|copying|notice|thirdpartylicenses)(?:\.|$)/i.test(entry.name)
      )
      .map((entry) => entry.name)
      .sort();
    const bundledLegalFiles = [...legalFiles];

    if (legalFiles.length > 0) {
      await mkdir(noticeDirectory, { recursive: true });
      for (const name of legalFiles) {
        await copyRequired(resolve(directory, name), resolve(noticeDirectory, name));
      }
    }
    if (metadata.name === "guid-typescript" && legalFiles.length === 0) {
      const generatedName = "LICENSE.generated-from-package-metadata.txt";
      await mkdir(noticeDirectory, { recursive: true });
      await writeFile(
        resolve(noticeDirectory, generatedName),
        createGuidTypescriptNotice(metadata)
      );
      bundledLegalFiles.push(generatedName);
    }

    dependencies.push({
      name: metadata.name,
      version: metadata.version,
      license: metadata.license ?? lockEntry.license ?? "UNKNOWN",
      packageLockPath: packagePath,
      repository: normalizeRepositoryUrl(metadata.repository),
      homepage: metadata.homepage ?? null,
      resolved: lockEntry.resolved ?? null,
      integrity: lockEntry.integrity ?? null,
      bundledLegalFiles: bundledLegalFiles.map((name) =>
        relative(output, resolve(noticeDirectory, name)).replaceAll("\\", "/")
      )
    });
  }

  return dependencies.sort((a, b) => a.name.localeCompare(b.name));
}

function createGuidTypescriptNotice(metadata) {
  return [
    `${metadata.name} ${metadata.version}`,
    "",
    "Supplier metadata:",
    `  Author: ${metadata.author ?? "nicolas"}`,
    `  License: ${metadata.license ?? "ISC"}`,
    `  Repository: ${normalizeRepositoryUrl(metadata.repository) ?? "https://github.com/NicolasDeveloper/guid-typescript"}`,
    "",
    "The published npm package does not contain a separate license file.",
    "The following is the standard ISC license text identified by its package metadata:",
    "Attribution reconstructed from the published author field; no year was supplied.",
    "",
    `Copyright (c) ${metadata.author ?? "nicolas"}`,
    "",
    "Permission to use, copy, modify, and/or distribute this software for any",
    "purpose with or without fee is hereby granted, provided that the above",
    "copyright notice and this permission notice appear in all copies.",
    "",
    "THE SOFTWARE IS PROVIDED \"AS IS\" AND THE AUTHOR DISCLAIMS ALL WARRANTIES",
    "WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF",
    "MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR",
    "ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES",
    "WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN",
    "ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF",
    "OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.",
    ""
  ].join("\n");
}

function createSpdxSbom(dependencies) {
  const documentNamespace = [
    repositoryUrl ?? `https://example.invalid/${packageJson.name}`,
    "sbom",
    packageJson.version,
    commit,
    Date.now()
  ].join("/");
  const packages = [
    {
      name: packageJson.name,
      SPDXID: "SPDXRef-Package-Application",
      versionInfo: packageJson.version,
      downloadLocation: sourceArchiveForSbom(),
      filesAnalyzed: false,
      licenseConcluded: packageJson.license,
      licenseDeclared: packageJson.license,
      copyrightText: "NOASSERTION",
      homepage: packageJson.homepage
    },
    ...dependencies.map((dependency, index) => ({
      name: dependency.name,
      SPDXID: `SPDXRef-Package-${index + 1}-${sanitize(dependency.name)}`,
      versionInfo: dependency.version,
      downloadLocation: dependency.resolved ?? "NOASSERTION",
      filesAnalyzed: false,
      licenseConcluded: "NOASSERTION",
      licenseDeclared: isSpdxExpression(dependency.license)
        ? dependency.license
        : "NOASSERTION",
      copyrightText: "NOASSERTION",
      homepage: dependency.homepage ?? dependency.repository ?? undefined,
      externalRefs: [
        {
          referenceCategory: "PACKAGE-MANAGER",
          referenceType: "purl",
          referenceLocator: npmPurl(dependency.name, dependency.version)
        }
      ],
      comment:
        dependency.license === "SEE LICENSE IN LICENSE.md"
          ? "The supplier's full license file is included in the legal bundle."
          : undefined
    }))
  ].map((entry) =>
    Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== undefined))
  );

  return {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: `${packageJson.name}-${packageJson.version}-runtime`,
    documentNamespace,
    creationInfo: {
      created: new Date().toISOString(),
      creators: ["Tool: PixelPet-Studio-prepare-legal-assets"]
    },
    packages,
    relationships: [
      {
        spdxElementId: "SPDXRef-DOCUMENT",
        relationshipType: "DESCRIBES",
        relatedSpdxElement: "SPDXRef-Package-Application"
      },
      ...packages.slice(1).map((entry) => ({
        spdxElementId: "SPDXRef-Package-Application",
        relationshipType: "DEPENDS_ON",
        relatedSpdxElement: entry.SPDXID
      }))
    ]
  };
}

async function createLegalAssetManifest(dataVersion) {
  const manifestPath = resolve(backgroundAssets, "resources.json");
  const manifestBuffer = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBuffer.toString("utf8"));
  const chunks = new Map();
  const resources = {};

  for (const [resourceName, resource] of Object.entries(manifest)) {
    resources[resourceName] = {
      ...resource,
      chunks: resource.chunks.map((chunk) => ({
        name: chunk.name,
        offsets: chunk.offsets
      }))
    };
    for (const chunk of resource.chunks) {
      if (!chunks.has(chunk.name)) chunks.set(chunk.name, chunk);
    }
  }

  const files = [];
  for (const [name, chunk] of [...chunks.entries()].sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    const path = resolve(backgroundAssets, name);
    const buffer = await readFile(path);
    const expectedSize = chunk.offsets[1] - chunk.offsets[0];
    if (buffer.byteLength !== expectedSize) {
      throw new Error(
        `Background-removal chunk ${name} has ${buffer.byteLength} bytes; expected ${expectedSize}.`
      );
    }
    files.push({
      name,
      size: buffer.byteLength,
      sha256: sha256(buffer)
    });
  }

  return {
    schemaVersion: 1,
    supplier: "@imgly/background-removal-data",
    version: dataVersion,
    source: `https://staticimgly.com/@imgly/background-removal-data/${dataVersion}/dist/`,
    resourcesManifest: {
      path: "background-removal/resources.json",
      size: manifestBuffer.byteLength,
      sha256: sha256(manifestBuffer)
    },
    resources,
    files
  };
}

function createSourceOffer({
  packageJson,
  repositoryUrl,
  commit,
  sourceArchive,
  dirty,
  versionTag
}) {
  const distributable =
    dirty === false && commit !== "unknown" && repositoryUrl && sourceArchive;
  const status =
    dirty === true
      ? "DEVELOPMENT BUILD: the working tree had uncommitted changes."
      : dirty === null
        ? "DEVELOPMENT BUILD: Git state could not be determined."
        : "CLEAN SOURCE BUILD";

  return [
    "PixelPet Studio — Corresponding Source",
    "",
    `Version: ${packageJson.version}`,
    `License: ${packageJson.license}`,
    `Build status: ${status}`,
    `Repository: ${repositoryUrl ?? "unknown"}`,
    `Exact commit: ${commit}`,
    `Release tag: ${versionTag ?? "none"}`,
    `Exact source archive: ${distributable ? sourceArchive : "not available for redistribution"}`,
    "",
    distributable
      ? "The complete Corresponding Source for this binary is available at no charge from the exact source archive above."
      : "Do not redistribute this development build. Commit every source change, make that commit publicly available, and rebuild before distribution.",
    "",
    "The source repository includes the build scripts, package lockfile, interface definitions, and installation information needed to rebuild and modify the program.",
    "",
    "Typical rebuild commands:",
    "  npm ci",
    "  npm run dist:mac   # macOS",
    "  npm run dist:win   # Windows",
    "",
    "License copies, third-party notices, dependency metadata, and hashes for the bundled model/WASM assets are stored beside this file.",
    "",
    "If the source archive link becomes unavailable, open an issue at:",
    `${packageJson.bugs?.url ?? `${repositoryUrl}/issues`}`,
    ""
  ].join("\n");
}

async function downloadCached(url, cacheName, fallbackPath) {
  const cachePath = resolve(cache, cacheName);
  try {
    const cached = await readFile(cachePath);
    if (cached.byteLength > 0) return cached;
  } catch {
    // Download below.
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength === 0) throw new Error("empty response");
    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(cachePath, buffer);
    return buffer;
  } catch (error) {
    if (fallbackPath) {
      try {
        const fallback = await readFile(fallbackPath);
        if (fallback.byteLength > 0) return fallback;
      } catch {
        // Report the original download error below.
      }
    }
    throw new Error(`Could not download required legal notice ${url}: ${error.message}`);
  }
}

async function copyDirectoryOptional(source, destination) {
  let entries;
  try {
    entries = await readdir(source, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  await mkdir(destination, { recursive: true });
  for (const entry of entries) {
    const from = resolve(source, entry.name);
    const to = resolve(destination, entry.name);
    if (entry.isDirectory()) {
      await copyDirectoryOptional(from, to);
    } else if (entry.isFile()) {
      await copyRequired(from, to);
    }
  }
}

async function copyOptional(source, destination) {
  try {
    await copyRequired(source, destination);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function copyRequired(source, destination) {
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function sanitize(value) {
  return String(value)
    .replaceAll("@", "")
    .replaceAll("/", "__")
    .replaceAll(/[^a-zA-Z0-9._+-]/g, "_");
}

function npmPurl(name, version) {
  const encodedName = name.startsWith("@")
    ? name
        .split("/")
        .map((part) => encodeURIComponent(part))
        .join("/")
    : encodeURIComponent(name);
  return `pkg:npm/${encodedName}@${encodeURIComponent(version)}`;
}

function isSpdxExpression(value) {
  return (
    typeof value === "string" &&
    /^(?:[A-Za-z0-9-.+]+)(?:\s+(?:AND|OR|WITH)\s+[A-Za-z0-9-.+]+)*$/.test(value)
  );
}

function sourceArchiveForSbom() {
  if (!repositoryUrl || commit === "unknown" || dirty !== false) return "NOASSERTION";
  return `${repositoryUrl}/archive/${commit}.zip`;
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

function normalizeRepositoryUrl(repository) {
  const raw = typeof repository === "string" ? repository : repository?.url;
  if (!raw) return null;
  return raw
    .replace(/^git\+/, "")
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/\.git$/, "");
}
