import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generatedDir = path.resolve(root, "docs", "prompting", "generated");
const stage = "animation-frame";
const unresolvedVariable = /\{\{[A-Z0-9_]+\}\}/;

const providerLabels = {
  gpt: "GPT",
  gemini: "Gemini",
};

const languageLabels = {
  ko: "한국어",
  en: "English",
};

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.resolve(root, relativePath), "utf8"));
}

function indexById(items, label) {
  const result = new Map();
  for (const item of items) {
    if (result.has(item.id)) throw new Error(`Duplicate ${label} id: ${item.id}`);
    result.set(item.id, item);
  }
  return result;
}

function required(map, id, label) {
  const value = map.get(id);
  if (!value) throw new Error(`Unknown ${label} id: ${id}`);
  return value;
}

function extractAnimationFrameTemplate(markdown, filename) {
  const start = markdown.search(/^## B\./m);
  const end = markdown.search(/^## C\./m);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`${filename} must contain ordered ## B. and ## C. stages`);
  }

  const match = markdown.slice(start, end).match(/```text\r?\n([\s\S]*?)\r?\n```/);
  if (!match) throw new Error(`${filename} has no text fence in stage B`);
  return match[1];
}

function formatIdentityLocks(pet, language) {
  const palette = pet.palette
    .map(({ role, hex }) => `${role} ${hex}`)
    .join(", ");

  if (language === "ko") {
    return [
      `캐릭터: ${pet.name.ko} (${pet.id})`,
      `정체성 요약: ${pet.summary.ko}`,
      `고정 실루엣 클래스: ${pet.silhouetteClass}`,
      `고정 팔레트: ${palette}`,
      "시그니처 특징(매니페스트 원문):",
      ...pet.signatureTraits.map((trait) => `- ${trait}`),
      "절대 보존 규칙(매니페스트 원문):",
      ...pet.mustPreserve.map((rule) => `- ${rule}`),
    ].join("\n");
  }

  return [
    `Character: ${pet.name.en} (${pet.id})`,
    `Identity summary: ${pet.summary.en}`,
    `Locked silhouette class: ${pet.silhouetteClass}`,
    `Locked palette: ${palette}`,
    "Signature traits:",
    ...pet.signatureTraits.map((trait) => `- ${trait}`),
    "Must-preserve rules:",
    ...pet.mustPreserve.map((rule) => `- ${rule}`),
  ].join("\n");
}

function formatFrameNotes(animation, frame, language) {
  const { x, y } = frame.bodyOffset;
  if (language === "ko") {
    const contact = frame.floorContact
      ? "바닥 접지를 유지한다"
      : "공중 프레임이므로 새 바닥 접지를 만들지 않는다";
    return `${animation.purpose.ko}. ${contact}. 기준 몸 오프셋은 (x: ${x}, y: ${y}), 표시 시간은 ${frame.durationMs}ms다.`;
  }

  const contact = frame.floorContact
    ? "Keep the declared floor contact"
    : "This is airborne; do not invent floor contact";
  return `${animation.purpose.en}. ${contact}. The normalized body offset is (x: ${x}, y: ${y}) and the display duration is ${frame.durationMs}ms.`;
}

function resolvePrompt(template, variables, requiredVariables, templateId) {
  for (const name of requiredVariables) {
    if (!(name in variables) || String(variables[name]).trim() === "") {
      throw new Error(`${templateId} is missing required variable ${name}`);
    }
  }

  const tokens = [...template.matchAll(/\{\{([A-Z0-9_]+)\}\}/g)].map(
    (match) => match[1],
  );
  for (const token of tokens) {
    if (!(token in variables)) {
      throw new Error(`${templateId} uses undeclared variable ${token}`);
    }
  }

  const resolved = template.replace(
    /\{\{([A-Z0-9_]+)\}\}/g,
    (_match, token) => String(variables[token]),
  );
  if (unresolvedVariable.test(resolved)) {
    throw new Error(`${templateId} left an unresolved variable`);
  }
  return resolved;
}

function referenceForRole(role, { pet, style, frame }, assetsById) {
  const assetIdByRole = {
    CANONICAL_PIXEL_MASTER: pet.previewAssetId,
    STYLE_REFERENCE: style.previewAssetId,
    POSE_REFERENCE: frame.assetId,
    CHARACTER_REFERENCE_OPTIONAL: pet.sourceAssetId,
  };
  const assetId = assetIdByRole[role];
  if (!assetId) throw new Error(`No asset mapping for reference role ${role}`);
  const asset = required(assetsById, assetId, "asset");
  return {
    role,
    assetId,
    path: `reference-kits/${asset.filename}`,
  };
}

function markdownLinkToReference(referencePath) {
  return `../../../${referencePath}`;
}

function renderMarkdownCatalog(templateInfo, entries) {
  const provider = providerLabels[templateInfo.provider];
  const language = languageLabels[templateInfo.language];
  const pets = [...new Map(entries.map((entry) => [entry.pet.id, entry])).values()];
  const lines = [
    `# ${provider} · ${language} — resolved animation prompts`,
    "",
    "> 자동 생성 파일입니다. 직접 수정하지 말고 `npm run prompts:generate`를 실행하세요.",
    "",
    `이 문서는 **${entries.length}개**의 즉시 사용 가능한 동작 프레임 프롬프트를 담고 있습니다. 각 프롬프트는 템플릿과 레퍼런스 키트 매니페스트에서 완전히 치환되었으며, 이미지 첨부 순서도 함께 제공합니다.`,
    "",
    "## 빠른 인덱스",
    "",
    "| 예시 펫 | 기본 스타일 | 동작 프레임 |",
    "|---|---|---:|",
    ...pets.map((entry) => {
      const count = entries.filter((candidate) => candidate.pet.id === entry.pet.id).length;
      return `| ${entry.pet.name} | ${entry.style.name} | ${count} |`;
    }),
    "",
  ];

  let serial = 0;
  for (const petEntry of pets) {
    const petEntries = entries.filter((entry) => entry.pet.id === petEntry.pet.id);
    lines.push(
      `## ${petEntry.pet.name} · ${petEntry.style.name}`,
      "",
      `기준 픽셀 마스터는 \`${petEntry.references[0].path}\`, 스타일 레퍼런스는 \`${petEntry.references[1].path}\`입니다.`,
      "",
    );

    for (const entry of petEntries) {
      serial += 1;
      const frame = String(entry.frame.index).padStart(2, "0");
      lines.push(
        `### ${String(serial).padStart(3, "0")} · ${entry.action.name} · f${frame} · ${entry.frame.phase}`,
        "",
        `- ID: \`${entry.id}\``,
        `- 결과 파일: \`${entry.outputFilename}\``,
        `- 프레임: ${entry.frame.index} / ${entry.frame.count} · ${entry.frame.durationMs}ms · ${entry.frame.floorContact ? "접지" : "공중"}`,
        "- 첨부 순서:",
        ...entry.references.map(
          (reference, index) =>
            `  ${index + 1}. \`${reference.role}\` — [\`${reference.path}\`](${markdownLinkToReference(reference.path)})`,
        ),
        "",
        "```text",
        entry.prompt,
        "```",
        "",
      );
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function renderReadme(catalog, markdownCatalogs) {
  const rows = markdownCatalogs.map(({ template, file, count }) =>
    `| ${providerLabels[template.provider]} | ${languageLabels[template.language]} | ${count} | [\`${file}\`](${file}) |`,
  );
  const actionRows = catalog.summary.actions.map(
    (action) =>
      `| ${action.name.ko} / ${action.name.en} | ${action.framesPerPet} | ${action.framesPerPet * catalog.summary.pets} |`,
  );

  return `# 완전 치환 프롬프트 카탈로그

이 디렉터리에는 **${catalog.counts.prompts}개**의 실행 가능한 동작 프레임 프롬프트가 있습니다.

\`${catalog.summary.pets} pets × ${catalog.summary.poseFrames} pose frames × ${catalog.summary.providers} providers × ${catalog.summary.languages} languages = ${catalog.counts.prompts}\`

모든 프롬프트는 [상위 템플릿](../templates/catalog.json), [펫·스타일·애니메이션 매니페스트](../../../reference-kits/manifest.json), 이미지 asset catalog를 단일 소스로 생성합니다. 미치환 변수 토큰은 남아 있지 않으며, 각 엔트리에는 제공자·언어·펫·스타일·동작·프레임 정보와 레퍼런스 이미지 4장의 첨부 순서가 들어 있습니다.

## 산출물

| 제공자 | 언어 | 프롬프트 | Markdown |
|---|---|---:|---|
${rows.join("\n")}

- [\`index.json\`](index.json): ${catalog.counts.prompts}개 프롬프트 전문과 모든 구조화 메타데이터를 담은 기계 판독용 카탈로그
- 제공자·언어별 Markdown: 이미지 첨부 순서와 복사 가능한 프롬프트를 함께 담은 사람용 카탈로그

## 프레임 구성

| 동작 | 펫당 프레임 | 5개 펫 합계 |
|---|---:|---:|
${actionRows.join("\n")}

각 제공자·언어 조합은 위 ${catalog.summary.poseFrames}개 포즈를 5개 예시 펫에 모두 적용한 ${catalog.counts.promptsPerTemplate}개 프롬프트를 갖습니다.

## 재생성 및 검증

\`\`\`bash
npm run prompts:generate
npm run prompts:check
\`\`\`

\`prompts:check\`는 현재 파일이 템플릿과 매니페스트에서 다시 계산한 결과와 바이트 단위로 같은지 검사합니다. 프롬프트 템플릿이나 레퍼런스 키트를 바꿨다면 \`prompts:generate\`를 실행하고 생성된 변경도 함께 커밋하세요.
`;
}

async function buildOutputs() {
  const [
    templateCatalog,
    petsCatalog,
    stylesCatalog,
    animationsCatalog,
    exampleAssets,
    styleAssets,
    poseAssets,
  ] = await Promise.all([
    readJson("docs/prompting/templates/catalog.json"),
    readJson("reference-kits/pets.json"),
    readJson("reference-kits/styles.json"),
    readJson("reference-kits/animations.json"),
    readJson("reference-kits/assets.example-pets.json"),
    readJson("reference-kits/assets.style-references.json"),
    readJson("reference-kits/assets.pose-references.json"),
  ]);

  const petsById = indexById(petsCatalog.pets, "pet");
  const stylesById = indexById(stylesCatalog.styles, "style");
  const poseAssetsById = indexById(poseAssets.assets, "pose asset");
  const allAssets = [
    ...exampleAssets.assets,
    ...styleAssets.assets,
    ...poseAssets.assets,
  ];
  const assetsById = indexById(allAssets, "asset");
  const templateDefinitions = templateCatalog.templates.filter((template) =>
    template.stages.includes(stage),
  );
  const referenceOrder = templateCatalog.referenceOrder[stage];
  const requiredVariables = templateCatalog.requiredVariables[stage];

  if (petsById.size !== 5) throw new Error(`Expected 5 pets, found ${petsById.size}`);
  if (templateDefinitions.length !== 4) {
    throw new Error(`Expected 4 provider/language templates, found ${templateDefinitions.length}`);
  }
  if (!Array.isArray(referenceOrder) || referenceOrder.length !== 4) {
    throw new Error("animation-frame must declare four ordered reference roles");
  }

  const templates = await Promise.all(
    templateDefinitions.map(async (definition) => {
      const relativePath = `docs/prompting/templates/${definition.file}`;
      const markdown = await readFile(path.resolve(root, relativePath), "utf8");
      return {
        ...definition,
        relativePath,
        body: extractAnimationFrameTemplate(markdown, definition.file),
      };
    }),
  );

  const poseFrameCount = animationsCatalog.animations.reduce(
    (total, animation) => total + animation.frames.length,
    0,
  );
  if (poseFrameCount !== 28) {
    throw new Error(`Expected 28 animation frames, found ${poseFrameCount}`);
  }

  const prompts = [];
  for (const template of templates) {
    for (const pet of petsCatalog.pets) {
      const style = required(stylesById, pet.defaultStyleId, "style");
      for (const animation of animationsCatalog.animations) {
        for (const frame of animation.frames) {
          const poseAsset = required(poseAssetsById, frame.assetId, "pose asset");
          if (
            poseAsset.animationId !== animation.id ||
            poseAsset.frameIndex !== frame.index
          ) {
            throw new Error(`${frame.assetId} disagrees with animations.json`);
          }

          const outputFilename = `${pet.id}-${animation.id}-f${String(frame.index).padStart(2, "0")}.png`;
          const variables = {
            IDENTITY_LOCKS: formatIdentityLocks(pet, template.language),
            STYLE_NAME: `${style.name[template.language]} (${style.id})`,
            STYLE_RULES: style.promptFragment[template.language],
            CANVAS_WIDTH: String(style.canvas.width),
            CANVAS_HEIGHT: String(style.canvas.height),
            LOGICAL_GRID: String(style.canvas.logicalGrid),
            PALETTE_MAX: String(style.paletteMax),
            ACTION_NAME: `${animation.name[template.language]} (${animation.id})`,
            FRAME_INDEX: String(frame.index),
            FRAME_COUNT: String(animation.frames.length),
            POSE_PHASE: frame.phase,
            ANCHOR_X: String(animationsCatalog.coordinateSystem.defaultPivot.x),
            ANCHOR_Y: String(animationsCatalog.coordinateSystem.defaultPivot.y),
            FRAME_NOTES: formatFrameNotes(animation, frame, template.language),
            OUTPUT_FILENAME: outputFilename,
          };
          const references = referenceOrder.map((role) =>
            referenceForRole(role, { pet, style, frame }, assetsById),
          );
          for (const reference of references) {
            await access(path.resolve(root, reference.path));
          }

          prompts.push({
            id: `${template.provider}.${template.language}.${pet.id}.${animation.id}.f${String(frame.index).padStart(2, "0")}`,
            provider: template.provider,
            language: template.language,
            stage,
            template: {
              id: template.id,
              path: template.relativePath,
            },
            pet: {
              id: pet.id,
              name: pet.name[template.language],
            },
            style: {
              id: style.id,
              name: style.name[template.language],
            },
            action: {
              id: animation.id,
              name: animation.name[template.language],
              loop: animation.loop,
            },
            frame: {
              assetId: frame.assetId,
              index: frame.index,
              count: animation.frames.length,
              phase: frame.phase,
              durationMs: frame.durationMs,
              floorContact: frame.floorContact,
              bodyOffset: frame.bodyOffset,
            },
            outputFilename,
            references,
            variables,
            prompt: resolvePrompt(
              template.body,
              variables,
              requiredVariables,
              template.id,
            ),
          });
        }
      }
    }
  }

  const expectedPromptCount =
    petsCatalog.pets.length * poseFrameCount * templateDefinitions.length;
  if (prompts.length !== expectedPromptCount) {
    throw new Error(`Expected ${expectedPromptCount} prompts, found ${prompts.length}`);
  }

  const catalog = {
    schemaVersion: "1.0.0",
    generatedBy: "scripts/generate-prompt-catalog.mjs",
    stage,
    sourceFiles: [
      "docs/prompting/templates/catalog.json",
      ...templates.map((template) => template.relativePath),
      "reference-kits/pets.json",
      "reference-kits/styles.json",
      "reference-kits/animations.json",
      "reference-kits/assets.example-pets.json",
      "reference-kits/assets.style-references.json",
      "reference-kits/assets.pose-references.json",
    ],
    counts: {
      prompts: prompts.length,
      promptsPerTemplate: petsCatalog.pets.length * poseFrameCount,
    },
    summary: {
      pets: petsCatalog.pets.length,
      poseFrames: poseFrameCount,
      providers: new Set(templateDefinitions.map((template) => template.provider)).size,
      languages: new Set(templateDefinitions.map((template) => template.language)).size,
      templates: templateDefinitions.length,
      actions: animationsCatalog.animations.map((animation) => ({
        id: animation.id,
        name: animation.name,
        framesPerPet: animation.frames.length,
      })),
    },
    markdownCatalogs: templates.map((template) => ({
      templateId: template.id,
      path: `docs/prompting/generated/${template.provider}.${template.language}.md`,
      prompts: petsCatalog.pets.length * poseFrameCount,
    })),
    prompts,
  };

  const markdownCatalogs = templates.map((template) => {
    const entries = prompts.filter(
      (entry) =>
        entry.provider === template.provider && entry.language === template.language,
    );
    return {
      template,
      file: `${template.provider}.${template.language}.md`,
      count: entries.length,
      contents: renderMarkdownCatalog(template, entries),
    };
  });

  return new Map([
    ["index.json", `${JSON.stringify(catalog, null, 2)}\n`],
    ["README.md", renderReadme(catalog, markdownCatalogs)],
    ...markdownCatalogs.map(({ file, contents }) => [file, contents]),
  ]);
}

async function main() {
  const check = process.argv.includes("--check");
  const outputs = await buildOutputs();

  if (check) {
    const stale = [];
    for (const [filename, expected] of outputs) {
      try {
        const actual = await readFile(path.resolve(generatedDir, filename), "utf8");
        if (actual !== expected) stale.push(filename);
      } catch {
        stale.push(filename);
      }
    }
    if (stale.length > 0) {
      throw new Error(
        `Generated prompt catalog is missing or stale: ${stale.join(", ")}. Run npm run prompts:generate.`,
      );
    }
    console.log(`Verified ${outputs.size} generated prompt catalog files.`);
    return;
  }

  await mkdir(generatedDir, { recursive: true });
  for (const [filename, contents] of outputs) {
    await writeFile(path.resolve(generatedDir, filename), contents, "utf8");
  }
  console.log(`Generated ${outputs.size} prompt catalog files in docs/prompting/generated.`);
}

await main();
