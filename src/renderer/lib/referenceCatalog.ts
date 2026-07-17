import type {
  ExamplePet,
  PoseReferenceSet,
  ReferenceAsset,
  ReferenceCatalog,
  StyleReference,
} from "../types";

type JsonRecord = Record<string, unknown>;

const FALLBACK_POSES = ["idle", "walk", "jump", "sleep", "reaction"];

const fallbackCatalog: ReferenceCatalog = {
  schemaVersion: "fallback-1",
  kitName: "PixelPet 기본 레퍼런스",
  licenseNote: "내장 안내 데이터입니다. 실제 레퍼런스 팩을 불러오면 자동으로 교체됩니다.",
  isFallback: true,
  examples: [
    {
      id: "mongle",
      name: "몽글",
      animal: "구름 강아지",
      description: "둥근 실루엣과 큰 표정을 살린 포근한 예시 펫",
      defaultStyleId: "soft-cluster",
    },
    {
      id: "tori",
      name: "토리",
      animal: "숲 다람쥐",
      description: "꼬리와 귀처럼 식별 포인트가 분명한 예시 펫",
      defaultStyleId: "classic-rpg",
    },
    {
      id: "nuri",
      name: "누리",
      animal: "파랑새",
      description: "작은 날개 움직임과 선명한 기관 컬러를 위한 예시 펫",
      defaultStyleId: "handheld",
    },
    {
      id: "koko",
      name: "코코",
      animal: "우주 토끼",
      description: "긴 귀와 소품을 프레임마다 일관되게 유지하는 예시 펫",
      defaultStyleId: "soft-cluster",
    },
    {
      id: "bibi",
      name: "비비",
      animal: "꼬마 공룡",
      description: "비대칭 디테일과 강한 윤곽선을 다루는 예시 펫",
      defaultStyleId: "classic-rpg",
    },
  ],
  styles: [
    {
      id: "soft-cluster",
      label: "소프트 클러스터",
      description: "둥근 픽셀 덩어리, 부드러운 3단 명암",
      canvas: "64 × 64",
      paletteMax: 16,
    },
    {
      id: "classic-rpg",
      label: "클래식 RPG",
      description: "진한 외곽선과 명확한 16-bit 실루엣",
      canvas: "48 × 48",
      paletteMax: 20,
    },
    {
      id: "handheld",
      label: "핸드헬드 미니",
      description: "제한된 팔레트와 큰 표정의 휴대용 게임 스타일",
      canvas: "32 × 32",
      paletteMax: 8,
    },
  ],
  poses: FALLBACK_POSES.map((id) => ({
    id,
    label: {
      idle: "기본 대기",
      walk: "걷기 루프",
      jump: "점프",
      sleep: "잠자기",
      reaction: "클릭 반응",
    }[id] ?? id,
    loop: id !== "jump" && id !== "reaction",
    durationsMs: Array.from(
      { length: id === "walk" ? 8 : id === "jump" || id === "reaction" ? 6 : 4 },
      () => 140,
    ),
    frames: Array.from(
      { length: id === "walk" ? 8 : id === "jump" || id === "reaction" ? 6 : 4 },
      (_, index) => ({
        id: `${id}-${index + 1}`,
        label: `${index + 1} 프레임`,
        description: "이미지 팩 로드 전 포즈 가이드",
      }),
    ),
  })),
};

const isRecord = (value: unknown): value is JsonRecord =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const asLocalizedString = (value: unknown, fallback = ""): string => {
  if (typeof value === "string") return value;
  if (isRecord(value)) {
    return asString(value.ko || value.en, fallback);
  }
  return fallback;
};

const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const collectRecords = (value: unknown, records: Map<string, JsonRecord>): void => {
  if (Array.isArray(value)) {
    value.forEach((item) => collectRecords(item, records));
    return;
  }
  if (!isRecord(value)) return;

  const id = asString(value.id || value.assetId);
  if (id) records.set(id, { ...(records.get(id) ?? {}), ...value });
  Object.values(value).forEach((item) => collectRecords(item, records));
};

const findPrompt = (record?: JsonRecord): string | undefined => {
  if (!record) return undefined;
  const candidates = [
    record.prompt,
    record.generationPrompt,
    record.promptTemplate,
    record.promptFragment,
  ];
  const direct = candidates.find(
    (value) => typeof value === "string",
  );
  if (typeof direct === "string") return direct;
  const localized = candidates.map((value) => asLocalizedString(value)).find(Boolean);
  if (localized) return localized;
  if (isRecord(record.prompts)) {
    return Object.values(record.prompts).find(
      (value): value is string => typeof value === "string",
    );
  }
  return undefined;
};

const resolveUrl = (baseUrl: string, value: string | undefined): string | undefined => {
  if (!value) return undefined;
  if (/^(https?:|data:|blob:)/.test(value) || value.startsWith("/")) return value;
  return `${baseUrl.replace(/\/$/, "")}/${value.replace(/^\.\//, "")}`;
};

const fetchJson = async (url: string): Promise<unknown> => {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) throw new Error(`${url} (${response.status})`);
  return response.json() as Promise<unknown>;
};

const getCatalogFiles = (manifest: JsonRecord): string[] => {
  if (!isRecord(manifest.catalogFiles)) return [];
  const files: string[] = [];
  Object.values(manifest.catalogFiles).forEach((value) => {
    if (typeof value === "string" && value.endsWith(".json")) files.push(value);
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (typeof item === "string" && item.endsWith(".json")) files.push(item);
      });
    }
  });
  return [...new Set(files)];
};

export const loadReferenceCatalog = async (): Promise<ReferenceCatalog> => {
  try {
    const rawManifest = await fetchJson("/reference-kits/manifest.json");
    if (!isRecord(rawManifest)) throw new Error("manifest 형식이 올바르지 않습니다.");

    const baseUrl = asString(rawManifest.assetBaseUrl, "/reference-kits/");
    const catalogFiles = getCatalogFiles(rawManifest);
    const catalogs = await Promise.all(
      catalogFiles.map(async (file) => {
        try {
          return await fetchJson(resolveUrl(baseUrl, file) ?? file);
        } catch {
          return null;
        }
      }),
    );

    const records = new Map<string, JsonRecord>();
    collectRecords(rawManifest, records);
    catalogs.forEach((catalog) => collectRecords(catalog, records));

    const runtime = isRecord(rawManifest.runtimeCatalog) ? rawManifest.runtimeCatalog : {};
    const rawExamples = Array.isArray(runtime.examplePets) ? runtime.examplePets : [];
    const rawStyles = Array.isArray(runtime.styles) ? runtime.styles : [];
    const rawAnimations = Array.isArray(runtime.animations) ? runtime.animations : [];

    const assetUrl = (assetId: unknown): string | undefined => {
      if (typeof assetId !== "string") return undefined;
      if (/\.(png|jpe?g|webp|gif)$/i.test(assetId)) return resolveUrl(baseUrl, assetId);
      const asset = records.get(assetId);
      if (!asset) return undefined;
      return resolveUrl(
        baseUrl,
        asString(asset.filename || asset.path || asset.url) || undefined,
      );
    };

    const examples: ExamplePet[] = rawExamples.filter(isRecord).map((item, index) => {
      const detail = records.get(asString(item.id));
      return {
        id: asString(item.id, `example-${index + 1}`),
        name: asLocalizedString(item.name, `예시 펫 ${index + 1}`),
        animal: asLocalizedString(item.animal, "마스코트"),
        description: asLocalizedString(
          detail?.description || detail?.summary || item.description,
          "캐릭터 정체성을 유지한 픽셀 펫 예시",
        ),
        sourceImage:
          resolveUrl(baseUrl, asString(item.sourceFilename || detail?.sourceFilename) || undefined) ||
          assetUrl(item.sourceAssetId || detail?.sourceAssetId),
        previewImage:
          resolveUrl(baseUrl, asString(item.previewFilename || detail?.previewFilename) || undefined) ||
          assetUrl(item.previewAssetId || detail?.previewAssetId),
        defaultStyleId: asString(item.defaultStyleId || detail?.defaultStyleId) || undefined,
        prompt:
          findPrompt(detail) ||
          findPrompt(item) ||
          asLocalizedString(detail?.purpose || item.purpose) ||
          undefined,
      };
    });

    const styles: StyleReference[] = rawStyles.filter(isRecord).map((item, index) => {
      const detail = records.get(asString(item.id));
      const canvas = item.canvas ?? detail?.canvas;
      const canvasLabel = Array.isArray(canvas)
        ? canvas.join(" × ")
        : isRecord(canvas)
          ? `${asNumber(canvas.width) ?? 64} × ${asNumber(canvas.height) ?? 64}`
          : asString(canvas) || undefined;
      return {
        id: asString(item.id, `style-${index + 1}`),
        label: asLocalizedString(item.name || detail?.name, `스타일 ${index + 1}`),
        image:
          resolveUrl(baseUrl, asString(item.previewFilename || detail?.previewFilename) || undefined) ||
          assetUrl(item.previewAssetId || detail?.previewAssetId),
        description: asLocalizedString(detail?.description || item.description) || undefined,
        canvas: canvasLabel,
        paletteMax: asNumber(item.paletteMax ?? detail?.paletteMax),
        prompt:
          findPrompt(detail) ||
          findPrompt(item) ||
          asLocalizedString(detail?.purpose || item.purpose) ||
          undefined,
      };
    });

    const poses: PoseReferenceSet[] = rawAnimations.filter(isRecord).map((item, index) => {
      const detail = records.get(asString(item.id));
      const runtimeFrames = Array.isArray(item.frames) ? item.frames.filter(isRecord) : [];
      const frameIds = runtimeFrames.length
        ? runtimeFrames.map((frame) => frame.assetId || frame.id || frame.filename)
        : Array.isArray(item.frameAssetIds)
          ? item.frameAssetIds
          : Array.isArray(detail?.frameAssetIds)
            ? detail.frameAssetIds
            : [];
      const durations = Array.isArray(item.durationsMs)
        ? item.durationsMs.filter((value): value is number => typeof value === "number")
        : runtimeFrames
            .map((frame) => frame.durationMs)
            .filter((value): value is number => typeof value === "number");
      const frames: ReferenceAsset[] = frameIds.map((frameId, frameIndex) => ({
        id: asString(frameId, `${asString(item.id)}-${frameIndex + 1}`),
        label: `${frameIndex + 1} 프레임`,
        image:
          resolveUrl(baseUrl, asString(runtimeFrames[frameIndex]?.filename) || undefined) ||
          assetUrl(frameId),
      }));
      return {
        id: asString(item.id, `pose-${index + 1}`),
        label: asLocalizedString(item.name || detail?.name, `동작 ${index + 1}`),
        loop: Boolean(item.loop ?? detail?.loop),
        guideImage:
          resolveUrl(baseUrl, asString(item.guideFilename) || undefined) ||
          assetUrl(item.guideAssetId),
        frames,
        durationsMs: durations,
        prompt:
          findPrompt(detail) ||
          findPrompt(item) ||
          asLocalizedString(detail?.purpose || item.purpose) ||
          undefined,
      };
    });

    if (!examples.length || !styles.length || !poses.length) {
      throw new Error("manifest에 표시할 레퍼런스가 부족합니다.");
    }

    const kit = isRecord(rawManifest.kit) ? rawManifest.kit : {};
    return {
      schemaVersion: asString(rawManifest.schemaVersion, "1"),
      kitName: asLocalizedString(kit.name, "PixelPet Reference Kit"),
      licenseNote:
        asLocalizedString(kit.licenseNote || rawManifest.copyrightPolicy) || undefined,
      examples,
      styles,
      poses,
      isFallback: false,
    };
  } catch (error) {
    console.info("Reference kit fallback enabled", error);
    return fallbackCatalog;
  }
};

export { fallbackCatalog };
