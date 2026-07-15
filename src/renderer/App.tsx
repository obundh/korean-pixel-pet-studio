import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
} from "react";
import type { PetWindowState } from "../shared/ipc";
import type { PixelPetProject } from "../shared/project";
import { Icon, type IconName } from "./components/Icon";
import { PetSurface } from "./components/PetSurface";
import { removeImageBackground } from "./lib/backgroundRemoval";
import {
  createFrameAsset,
  dataUrlToBlob,
  downloadTextFile,
  fileToDataUrl,
} from "./lib/images";
import {
  createQuickPetFrames,
  imageHasMeaningfulTransparency,
  parseCanvasSize,
  postprocessFlatChromaDataUrl,
} from "./lib/quickPet";
import { loadReferenceCatalog } from "./lib/referenceCatalog";
import {
  ANIMATION_STATES,
  type AnimationState,
  type FrameAsset,
  type FrameCollection,
  type PoseReferenceSet,
  type ReferenceCatalog,
  type SelectedFrame,
  type StyleReference,
} from "./types";

type StudioStep = "guide" | "frames" | "remove" | "preview" | "publish";
type ToastMessage = { tone: "success" | "error" | "info"; message: string };
type RemovalState = {
  phase: "idle" | "loading" | "processing" | "success" | "error";
  progress: number;
  detail: string;
};
type QuickPetState = {
  phase: "idle" | "reading" | "removing" | "generating" | "success" | "error";
  progress: number;
  detail: string;
  fileName?: string;
  backgroundRemoval?: "skipped" | "performed";
  chromaCleanup?: "applied" | "not-needed";
  chromaKey?: string;
};

const STEP_ITEMS: Array<{
  id: StudioStep;
  eyebrow: string;
  label: string;
  description: string;
  icon: IconName;
}> = [
  {
    id: "guide",
    eyebrow: "STEP 01",
    label: "생성 가이드",
    description: "스타일과 포즈 준비",
    icon: "sparkles",
  },
  {
    id: "frames",
    eyebrow: "STEP 02",
    label: "프레임 가져오기",
    description: "AI 결과를 슬롯에 배치",
    icon: "layers",
  },
  {
    id: "remove",
    eyebrow: "STEP 03",
    label: "배경 제거",
    description: "선택 프레임 알파 처리",
    icon: "cut",
  },
  {
    id: "preview",
    eyebrow: "STEP 04",
    label: "움직임 확인",
    description: "속도와 크기 조정",
    icon: "play",
  },
  {
    id: "publish",
    eyebrow: "STEP 05",
    label: "펫 완성",
    description: "실행 · 저장 · 내보내기",
    icon: "download",
  },
];

const MOTION_META: Record<
  AnimationState,
  { label: string; shortLabel: string; description: string; slots: number }
> = {
  idle: {
    label: "대기",
    shortLabel: "IDLE",
    description: "가볍게 숨 쉬거나 제자리에서 기다려요.",
    slots: 4,
  },
  walk: {
    label: "걷기",
    shortLabel: "WALK",
    description: "좌우 이동에 사용할 자연스러운 반복 동작이에요.",
    slots: 8,
  },
  jump: {
    label: "점프",
    shortLabel: "JUMP",
    description: "도약부터 착지까지 한 번 재생되는 동작이에요.",
    slots: 6,
  },
  sleep: {
    label: "잠자기",
    shortLabel: "SLEEP",
    description: "오래 움직이지 않을 때 보여 줄 편안한 루프예요.",
    slots: 4,
  },
  reaction: {
    label: "반응",
    shortLabel: "REACT",
    description: "클릭하거나 쓰다듬을 때 보여 줄 짧은 동작이에요.",
    slots: 6,
  },
};

const createInitialFrames = (): FrameCollection =>
  Object.fromEntries(
    ANIMATION_STATES.map((state) => [
      state,
      Array.from({ length: MOTION_META[state].slots }, () => null),
    ]),
  ) as FrameCollection;

const normalizeFrames = (frames: PixelPetProject["frames"]): FrameCollection =>
  Object.fromEntries(
    ANIMATION_STATES.map((state) => {
      const source = Array.isArray(frames[state]) ? frames[state] : [];
      return [
        state,
        [
          ...source,
          ...Array.from(
            { length: Math.max(0, MOTION_META[state].slots - source.length) },
            () => null,
          ),
        ],
      ];
    }),
  ) as FrameCollection;

const isPixelPetProject = (value: unknown): value is PixelPetProject => {
  if (!value || typeof value !== "object") return false;
  const project = value as Partial<PixelPetProject>;
  return (
    project.version === 1 &&
    typeof project.name === "string" &&
    Boolean(project.frames) &&
    ANIMATION_STATES.every((state) => Array.isArray(project.frames?.[state]))
  );
};

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "예상하지 못한 오류가 발생했습니다.";

const slugify = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-|-$/g, "") || "pixel-pet";

const motionFromPoseId = (poseId: string): AnimationState | undefined =>
  ANIMATION_STATES.find((state) => poseId.toLowerCase().includes(state));

const buildPrompt = (style: StyleReference | undefined): string => {
  const dimensions = style?.canvas ?? "64 × 64";
  const palette = style?.paletteMax ? `최대 ${style.paletteMax}색` : "제한된 색상 팔레트";
  return [
    "[역할]",
    "당신은 캐릭터 정체성을 보존하는 게임용 픽셀 캐릭터 전문 아티스트입니다.",
    "",
    "[첨부 이미지의 역할]",
    "1번 이미지는 변형하면 안 되는 원본 마스코트입니다. 얼굴, 대표 색상, 로고, 의상과 고유 장식을 정확히 유지하세요.",
    `2번 이미지는 '${style?.label ?? "소프트 픽셀아트"}' 스타일 레퍼런스입니다. 픽셀 크기, 외곽선과 명암 방식만 참고하고 다른 캐릭터의 생김새는 복사하지 마세요.`,
    "",
    "[할 일]",
    "원본 마스코트가 한눈에 같은 캐릭터로 보이는 중립 자세의 기준 픽셀 마스터 한 장을 만드세요. 정면 또는 원본을 가장 잘 알아볼 수 있는 자연스러운 3/4 시점으로 서 있고, 팔다리와 대표 장식이 가려지지 않아야 합니다.",
    "",
    "[출력 규격]",
    `- ${dimensions} 기준의 정사각형 캔버스, nearest-neighbor로 읽히는 또렷한 하드 픽셀`,
    `- ${palette}, 안티앨리어싱·블러·반투명 그림자·서로 다른 크기의 가짜 픽셀 금지`,
    "- 결과는 캐릭터 한 명이 들어간 정사각형 이미지 한 장만 출력하고 스프라이트시트, 여러 포즈, 비교판, 설명문을 만들지 않기",
    "- 캐릭터를 중앙에 크게 배치하되 머리 위와 발 아래에 충분한 여백을 두고 발 기준선을 수평으로 유지",
    "- 캐릭터 외부에는 소품, 글자, 프레임 번호, UI, 바닥 그림자를 추가하지 않기",
    "- 배경은 무늬·그라디언트·그림자가 전혀 없는 완전한 단색 한 가지로 채우기",
    "- 배경색은 캐릭터의 외곽선, 몸, 눈, 로고, 의상 어디에도 쓰이지 않는 강한 대비색으로 선택해 캐릭터와 절대 겹치지 않게 하기",
    "",
    "[중요]",
    "새 캐릭터나 새 포즈 세트를 창작하지 마세요. 이 한 장은 이후 모든 동작의 정체성 기준이 되는 픽셀 마스터입니다.",
    style?.prompt ? `\n[스타일 세부 규칙]\n${style.prompt}` : "",
  ]
    .filter(Boolean)
    .join("\n");
};

function ReferenceImage({
  src,
  fallbackSrc,
  label,
}: {
  src?: string;
  fallbackSrc?: string;
  label: string;
}) {
  const [activeSrc, setActiveSrc] = useState(src || fallbackSrc);
  useEffect(() => setActiveSrc(src || fallbackSrc), [fallbackSrc, src]);

  if (!activeSrc) {
    return (
      <span className="reference-placeholder" aria-label={`${label} 미리보기 준비 중`}>
        <span className="reference-placeholder__face">••</span>
        <span className="reference-placeholder__label">PREVIEW</span>
      </span>
    );
  }
  return (
    <img
      alt={`${label} 레퍼런스`}
      src={activeSrc}
      onError={() => setActiveSrc(activeSrc === src ? fallbackSrc : undefined)}
    />
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
  aside,
}: {
  eyebrow: string;
  title: string;
  description: string;
  aside?: ReactNode;
}) {
  return (
    <header className="section-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {aside}
    </header>
  );
}

function MotionTabs({
  active,
  frames,
  onChange,
}: {
  active: AnimationState;
  frames: FrameCollection;
  onChange: (state: AnimationState) => void;
}) {
  return (
    <div className="motion-tabs" role="tablist" aria-label="펫 동작 선택">
      {ANIMATION_STATES.map((state) => {
        const count = frames[state].filter(Boolean).length;
        return (
          <button
            aria-selected={active === state}
            className={active === state ? "is-active" : ""}
            key={state}
            onClick={() => onChange(state)}
            role="tab"
            type="button"
          >
            <span>{MOTION_META[state].label}</span>
            <small>{count}/{frames[state].length}</small>
          </button>
        );
      })}
    </div>
  );
}

function FrameSlot({
  frame,
  index,
  state,
  selected,
  disabled,
  onSelect,
  onImport,
  onRemove,
}: {
  frame: FrameAsset | null;
  index: number;
  state: AnimationState;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  onImport: (files: File[]) => void;
  onRemove: () => void;
}) {
  const inputId = `frame-${state}-${index}`;
  const [dragging, setDragging] = useState(false);
  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    onImport(Array.from(event.dataTransfer.files));
  };

  return (
    <div
      className={`frame-slot ${frame ? "has-frame" : ""} ${selected ? "is-selected" : ""} ${dragging ? "is-dragging" : ""}`}
      data-testid={`frame-slot-${state}-${index}`}
      onDragEnter={(event) => {
        event.preventDefault();
        if (disabled) return;
        setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <span className="frame-slot__number">{String(index + 1).padStart(2, "0")}</span>
      {frame ? (
        <>
          <button
            aria-label={`${MOTION_META[state].label} ${index + 1}번 프레임 선택`}
            className="frame-slot__preview checkerboard"
            onClick={onSelect}
            type="button"
          >
            <img alt="" src={frame.dataUrl} />
            {frame.backgroundRemoved && (
              <span className="frame-slot__clean" title="배경 제거 완료">
                <Icon name="check" />
              </span>
            )}
          </button>
          <div className="frame-slot__actions">
            <label htmlFor={inputId}>교체</label>
            <button aria-label={`${index + 1}번 프레임 삭제`} disabled={disabled} onClick={onRemove} type="button">
              <Icon name="trash" />
            </button>
          </div>
        </>
      ) : (
        <label className="frame-slot__empty" htmlFor={inputId}>
          <Icon name="plus" />
          <span>이미지 놓기</span>
          <small>PNG · JPG · WebP</small>
        </label>
      )}
      <input
        accept="image/png,image/jpeg,image/webp"
        className="visually-hidden"
        disabled={disabled}
        id={inputId}
        onChange={(event) => {
          onImport(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
        type="file"
      />
    </div>
  );
}

async function createSpriteSheet(project: PixelPetProject): Promise<Uint8Array> {
  const populated = ANIMATION_STATES.map((state) =>
    project.frames[state].filter((frame): frame is FrameAsset => frame !== null),
  );
  const flat = populated.flat();
  if (!flat.length) throw new Error("내보낼 프레임이 없습니다.");
  const cellWidth = Math.max(...flat.map((frame) => frame.width));
  const cellHeight = Math.max(...flat.map((frame) => frame.height));
  const columns = Math.max(...populated.map((frames) => frames.length));
  const canvas = document.createElement("canvas");
  canvas.width = columns * cellWidth;
  canvas.height = ANIMATION_STATES.length * cellHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("스프라이트 캔버스를 만들 수 없습니다.");
  context.imageSmoothingEnabled = false;

  const loadImage = (src: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("프레임 이미지를 읽지 못했습니다."));
      image.src = src;
    });

  for (let row = 0; row < populated.length; row += 1) {
    const images = await Promise.all(populated[row].map((frame) => loadImage(frame.dataUrl)));
    images.forEach((image, column) => {
      context.drawImage(
        image,
        column * cellWidth + Math.floor((cellWidth - image.naturalWidth) / 2),
        row * cellHeight + (cellHeight - image.naturalHeight),
      );
    });
  }

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error("PNG 변환에 실패했습니다."))),
      "image/png",
    ),
  );
  return new Uint8Array(await blob.arrayBuffer());
}

export default function App() {
  const isPetMode = new URLSearchParams(window.location.search).get("mode") === "pet";
  if (isPetMode) return <PetSurface />;
  return <Studio />;
}

function Studio() {
  const [step, setStep] = useState<StudioStep>("guide");
  const [catalog, setCatalog] = useState<ReferenceCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [activeExampleId, setActiveExampleId] = useState("");
  const [activeStyleId, setActiveStyleId] = useState("");
  const [activePoseId, setActivePoseId] = useState("idle");
  const [activeMotion, setActiveMotion] = useState<AnimationState>("idle");
  const [frames, setFrames] = useState<FrameCollection>(createInitialFrames);
  const [selectedFrame, setSelectedFrame] = useState<SelectedFrame | null>(null);
  const [projectName, setProjectName] = useState("나의 픽셀 펫");
  const [projectPath, setProjectPath] = useState<string | undefined>();
  const [createdAt, setCreatedAt] = useState(() => new Date().toISOString());
  const [fps, setFps] = useState(8);
  const [scale, setScale] = useState(3);
  const [playing, setPlaying] = useState(true);
  const [previewFrameIndex, setPreviewFrameIndex] = useState(0);
  const [petState, setPetState] = useState<PetWindowState | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [removal, setRemoval] = useState<RemovalState>({
    phase: "idle",
    progress: 0,
    detail: "프레임을 선택하면 로컬 AI가 배경을 분리합니다.",
  });
  const [quickPet, setQuickPet] = useState<QuickPetState>({
    phase: "idle",
    progress: 0,
    detail: "픽셀 마스코트 한 장만 고르면 나머지는 앱이 준비합니다.",
  });
  const bulkInputRef = useRef<HTMLInputElement>(null);
  const quickPetInputRef = useRef<HTMLInputElement>(null);
  const imageOperationRef = useRef({ busy: false, generation: 0 });

  useEffect(() => {
    let mounted = true;
    void loadReferenceCatalog().then((result) => {
      if (!mounted) return;
      setCatalog(result);
      setCatalogLoading(false);
      const firstExample = result.examples[0];
      const styleId = firstExample?.defaultStyleId || result.styles[0]?.id || "";
      setActiveExampleId(firstExample?.id ?? "");
      setActiveStyleId(styleId);
      setActivePoseId(result.poses[0]?.id ?? "idle");
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!window.pixelPet) return undefined;
    const unsubscribe = window.pixelPet.onPetState(setPetState);
    void window.pixelPet.getPetState().then(setPetState).catch(() => undefined);
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const activeExample = catalog?.examples.find((item) => item.id === activeExampleId);
  const activeStyle = catalog?.styles.find((item) => item.id === activeStyleId);
  const activePose = catalog?.poses.find((item) => item.id === activePoseId);
  const prompt = useMemo(
    () => buildPrompt(activeStyle),
    [activeStyle],
  );

  const project = useMemo<PixelPetProject>(
    () => ({
      version: 1,
      name: projectName.trim() || "나의 픽셀 펫",
      activeKitId: `${activeExampleId || "custom"}:${activeStyleId || "default"}`,
      frames,
      fps,
      scale,
      createdAt,
      updatedAt: new Date().toISOString(),
    }),
    [activeExampleId, activeStyleId, createdAt, fps, frames, projectName, scale],
  );

  const importedCount = useMemo(
    () => ANIMATION_STATES.reduce((sum, state) => sum + frames[state].filter(Boolean).length, 0),
    [frames],
  );
  const cleanedCount = useMemo(
    () =>
      ANIMATION_STATES.reduce(
        (sum, state) =>
          sum + frames[state].filter((frame) => frame?.backgroundRemoved).length,
        0,
      ),
    [frames],
  );
  const activePreviewFrames = useMemo(
    () => frames[activeMotion].filter((frame): frame is FrameAsset => frame !== null),
    [activeMotion, frames],
  );

  useEffect(() => setPreviewFrameIndex(0), [activeMotion, activePreviewFrames.length]);
  useEffect(() => {
    if (!playing || activePreviewFrames.length <= 1) return undefined;
    const timer = window.setInterval(
      () => setPreviewFrameIndex((index) => (index + 1) % activePreviewFrames.length),
      Math.max(50, 1000 / fps),
    );
    return () => window.clearInterval(timer);
  }, [activePreviewFrames.length, fps, playing]);

  const selectedAsset = selectedFrame
    ? frames[selectedFrame.state]?.[selectedFrame.index] ?? null
    : null;

  const notify = (tone: ToastMessage["tone"], message: string) =>
    setToast({ tone, message });

  const beginImageOperation = (action: "quick-pet" | "remove-background"): number | null => {
    if (imageOperationRef.current.busy || busyAction) return null;
    imageOperationRef.current.busy = true;
    imageOperationRef.current.generation += 1;
    setBusyAction(action);
    return imageOperationRef.current.generation;
  };

  const isCurrentImageOperation = (generation: number): boolean =>
    imageOperationRef.current.busy && imageOperationRef.current.generation === generation;

  const finishImageOperation = (generation: number) => {
    if (!isCurrentImageOperation(generation)) return;
    imageOperationRef.current.busy = false;
    setBusyAction(null);
  };

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      notify("success", "생성 프롬프트를 복사했습니다.");
    } catch {
      notify("error", "클립보드에 접근하지 못했습니다. 프롬프트를 직접 선택해 주세요.");
    }
  };

  const importFiles = async (state: AnimationState, startIndex: number, filesToAdd: File[]) => {
    if (!filesToAdd.length) return;
    if (busyAction || imageOperationRef.current.busy) {
      notify("info", "현재 이미지 작업이 끝난 뒤 다시 시도해 주세요.");
      return;
    }
    setBusyAction("import");
    try {
      const imported = await Promise.all(filesToAdd.map(createFrameAsset));
      setFrames((current) => {
        const nextState = [...current[state]];
        imported.forEach((frame, offset) => {
          const preferred = startIndex + offset;
          const emptyAfter = nextState.findIndex((value, index) => index >= preferred && !value);
          const target = offset === 0 ? preferred : emptyAfter;
          if (target >= 0 && target < nextState.length) nextState[target] = frame;
        });
        return { ...current, [state]: nextState };
      });
      setSelectedFrame({ state, index: startIndex });
      notify("success", `${imported.length}개 프레임을 가져왔습니다.`);
    } catch (error) {
      notify("error", getErrorMessage(error));
    } finally {
      setBusyAction(null);
    }
  };

  const removeFrame = (state: AnimationState, index: number) => {
    if (busyAction || imageOperationRef.current.busy) return;
    setFrames((current) => ({
      ...current,
      [state]: current[state].map((frame, frameIndex) =>
        frameIndex === index ? null : frame,
      ),
    }));
    if (selectedFrame?.state === state && selectedFrame.index === index) setSelectedFrame(null);
  };

  const createQuickPet = async (file: File) => {
    if (!file) return;
    const operationGeneration = beginImageOperation("quick-pet");
    if (operationGeneration === null) return;
    setQuickPet({
      phase: "reading",
      progress: 4,
      detail: "이미지 크기와 투명 배경을 확인하는 중…",
      fileName: file.name,
    });

    try {
      const source = await createFrameAsset(file);
      const alreadyTransparent = await imageHasMeaningfulTransparency(source.originalDataUrl);
      let cleanedDataUrl = source.originalDataUrl;

      if (alreadyTransparent) {
        setQuickPet({
          phase: "generating",
          progress: 72,
          detail: "이미 투명한 이미지라 배경 제거를 건너뛰고 크기를 맞추는 중…",
          fileName: file.name,
          backgroundRemoval: "skipped",
        });
      } else {
        setQuickPet({
          phase: "removing",
          progress: 10,
          detail: "로컬 AI가 캐릭터와 배경을 분리하는 중…",
          fileName: file.name,
          backgroundRemoval: "performed",
        });
        const cleaned = await removeImageBackground(
          await dataUrlToBlob(source.originalDataUrl),
          {
            onProgress: ({ key, ratio }) => {
              if (!isCurrentImageOperation(operationGeneration)) return;
              const loadingModel = /model|wasm|onnx/i.test(key);
              setQuickPet({
                phase: "removing",
                progress: Math.min(70, Math.max(10, Math.round(10 + ratio * 60))),
                detail: loadingModel
                  ? "앱에 포함된 AI 모델을 여는 중…"
                  : "캐릭터 가장자리를 투명하게 정리하는 중…",
                fileName: file.name,
                backgroundRemoval: "performed",
              });
            },
          },
        );
        cleanedDataUrl = await fileToDataUrl(cleaned);
        setQuickPet({
          phase: "generating",
          progress: 76,
          detail: "캐릭터를 아래 중앙에 맞추고 대기 동작을 만드는 중…",
          fileName: file.name,
          backgroundRemoval: "performed",
        });
      }

      const targetCanvas = parseCanvasSize(activeStyle?.canvas);
      const result = await createQuickPetFrames({
        originalDataUrl: source.originalDataUrl,
        cleanedDataUrl,
        sourceName: file.name,
        canvas: targetCanvas,
      });
      if (!isCurrentImageOperation(operationGeneration)) return;
      setFrames((current) => ({ ...current, idle: result.frames }));
      setActiveMotion("idle");
      setSelectedFrame({ state: "idle", index: 0 });
      setRemoval({
        phase: "success",
        progress: 100,
        detail: result.chromaCleanup.applied
          ? "단색 배경과 경계색을 제거하고 픽셀용 투명도로 정리했습니다."
          : alreadyTransparent
            ? "원본 투명도를 유지해 대기 프레임을 만들었습니다."
            : "투명 배경 PNG로 정리하고 대기 프레임을 만들었습니다.",
      });
      const chromaColor = result.chromaCleanup.key?.color;
      setQuickPet({
        phase: "success",
        progress: 100,
        detail: `${result.canvas.width} × ${result.canvas.height} 투명 프레임 4개가 준비됐습니다.`,
        fileName: file.name,
        backgroundRemoval: alreadyTransparent ? "skipped" : "performed",
        chromaCleanup: result.chromaCleanup.applied ? "applied" : "not-needed",
        chromaKey: chromaColor
          ? `${chromaColor.red},${chromaColor.green},${chromaColor.blue}`
          : undefined,
      });
      notify("success", "이미지 한 장으로 대기 애니메이션을 완성했습니다.");
    } catch (error) {
      if (!isCurrentImageOperation(operationGeneration)) return;
      const message = getErrorMessage(error);
      setQuickPet({
        phase: "error",
        progress: 0,
        detail: message,
        fileName: file.name,
      });
      notify("error", `자동 완성 실패: ${message}`);
    } finally {
      finishImageOperation(operationGeneration);
    }
  };

  const removeBackground = async () => {
    if (!selectedFrame || !selectedAsset) {
      notify("info", "먼저 배경을 제거할 프레임을 선택해 주세요.");
      return;
    }

    const operationGeneration = beginImageOperation("remove-background");
    if (operationGeneration === null) return;
    const targetFrame = { ...selectedFrame };
    const targetFrameId = selectedAsset.id;

    setRemoval({ phase: "loading", progress: 4, detail: "앱에 포함된 AI 모델을 여는 중…" });
    try {
      const source = await dataUrlToBlob(selectedAsset.originalDataUrl);
      setRemoval({ phase: "processing", progress: 12, detail: "캐릭터와 배경을 구분하는 중…" });
      const result = await removeImageBackground(source, {
        onProgress: ({ key, ratio }) => {
          if (!isCurrentImageOperation(operationGeneration)) return;
          const progress = Math.min(94, Math.max(12, Math.round(12 + ratio * 82)));
          const loadingModel = /model|wasm|onnx/i.test(key);
          setRemoval({
            phase: "processing",
            progress,
            detail: loadingModel ? "로컬 AI 모델을 메모리에 올리는 중…" : "배경 픽셀을 정리하는 중…",
          });
        },
      });
      const rawDataUrl = await fileToDataUrl(result);
      const forcedKey = selectedAsset.chromaKey
        ? {
            red: selectedAsset.chromaKey[0],
            green: selectedAsset.chromaKey[1],
            blue: selectedAsset.chromaKey[2],
          }
        : undefined;
      const processed = await postprocessFlatChromaDataUrl(
        selectedAsset.originalDataUrl,
        rawDataUrl,
        forcedKey,
      );
      const dataUrl = processed.dataUrl;
      const processedKey = processed.chromaCleanup.key?.color;
      if (!isCurrentImageOperation(operationGeneration)) return;
      setFrames((current) => ({
        ...current,
        [targetFrame.state]: current[targetFrame.state].map((frame, index) =>
          index === targetFrame.index && frame?.id === targetFrameId
            ? {
                ...frame,
                dataUrl,
                backgroundRemoved: true,
                chromaKey: processedKey
                  ? [processedKey.red, processedKey.green, processedKey.blue]
                  : frame.chromaKey,
                updatedAt: new Date().toISOString(),
              }
            : frame,
        ),
      }));
      setRemoval({
        phase: "success",
        progress: 100,
        detail: processed.chromaCleanup.applied
          ? "단색 배경과 경계색을 제거해 픽셀용 투명도로 정리했습니다."
          : "투명 배경 PNG로 정리했습니다.",
      });
      notify("success", "선택한 프레임의 배경을 제거했습니다.");
    } catch (error) {
      if (!isCurrentImageOperation(operationGeneration)) return;
      setRemoval({ phase: "error", progress: 0, detail: getErrorMessage(error) });
      notify("error", `배경 제거 실패: ${getErrorMessage(error)}`);
    } finally {
      finishImageOperation(operationGeneration);
    }
  };

  const restoreBackground = () => {
    if (!selectedFrame || !selectedAsset) return;
    setFrames((current) => ({
      ...current,
      [selectedFrame.state]: current[selectedFrame.state].map((frame, index) =>
        index === selectedFrame.index && frame
          ? {
              ...frame,
              dataUrl: frame.originalDataUrl,
              backgroundRemoved: false,
              updatedAt: new Date().toISOString(),
            }
          : frame,
      ),
    }));
    setRemoval({ phase: "idle", progress: 0, detail: "원본 이미지로 되돌렸습니다." });
  };

  const applyLoadedProject = (loaded: PixelPetProject, path?: string) => {
    const [loadedExampleId, loadedStyleId] = loaded.activeKitId.split(":");
    setProjectName(loaded.name);
    setFrames(normalizeFrames(loaded.frames));
    setFps(Math.min(16, Math.max(2, loaded.fps)));
    setScale(Math.min(6, Math.max(0.25, loaded.scale)));
    setCreatedAt(loaded.createdAt);
    if (loadedExampleId) setActiveExampleId(loadedExampleId);
    if (loadedStyleId) setActiveStyleId(loadedStyleId);
    setProjectPath(path);
    setSelectedFrame(null);
    setStep("frames");
  };

  const saveProject = async (saveAs = false) => {
    setBusyAction("save");
    try {
      if (window.pixelPet) {
        const result = await window.pixelPet.saveProject({
          project,
          currentPath: projectPath,
          saveAs,
        });
        if (result.status === "saved") {
          setProjectPath(result.path);
          notify("success", `프로젝트를 저장했습니다: ${result.path}`);
        }
      } else {
        localStorage.setItem("pixelpet:autosave", JSON.stringify(project));
        notify("success", "브라우저 임시 저장소에 프로젝트를 저장했습니다.");
      }
    } catch (error) {
      notify("error", `저장 실패: ${getErrorMessage(error)}`);
    } finally {
      setBusyAction(null);
    }
  };

  const loadProject = async () => {
    setBusyAction("load");
    try {
      if (window.pixelPet) {
        const result = await window.pixelPet.loadProject();
        if (result.status === "loaded") {
          applyLoadedProject(result.project, result.path);
          notify("success", "프로젝트를 불러왔습니다.");
        }
      } else {
        const stored = localStorage.getItem("pixelpet:autosave");
        const parsed: unknown = stored ? JSON.parse(stored) : null;
        if (!isPixelPetProject(parsed)) throw new Error("저장된 프로젝트가 없습니다.");
        applyLoadedProject(parsed);
        notify("success", "임시 저장 프로젝트를 불러왔습니다.");
      }
    } catch (error) {
      notify("error", `불러오기 실패: ${getErrorMessage(error)}`);
    } finally {
      setBusyAction(null);
    }
  };

  const startPet = async () => {
    if (!importedCount) {
      notify("info", "실행할 프레임을 먼저 가져와 주세요.");
      return;
    }
    if (!window.pixelPet) {
      notify("info", "데스크톱 펫 실행은 설치된 앱에서 사용할 수 있어요.");
      return;
    }
    setBusyAction("pet");
    try {
      const nextState = await window.pixelPet.startPet({
        project,
        animation: activeMotion,
        motion: { velocityX: 42, velocityY: 0, bounce: true },
      });
      setPetState(nextState);
      notify("success", "데스크톱에 픽셀 펫을 실행했습니다.");
    } catch (error) {
      notify("error", `펫 실행 실패: ${getErrorMessage(error)}`);
    } finally {
      setBusyAction(null);
    }
  };

  const stopPet = async () => {
    if (!window.pixelPet) return;
    setBusyAction("stop");
    try {
      setPetState(await window.pixelPet.stopPet());
    } catch (error) {
      notify("error", `펫 종료 실패: ${getErrorMessage(error)}`);
    } finally {
      setBusyAction(null);
    }
  };

  const exportProject = async () => {
    const fileName = `${slugify(project.name)}.json`;
    const data = JSON.stringify(project, null, 2);
    setBusyAction("export-json");
    try {
      if (window.pixelPet) {
        const result = await window.pixelPet.exportPet({
          suggestedName: fileName,
          format: "json",
          data,
        });
        if (result.status === "exported") notify("success", `내보냈습니다: ${result.path}`);
      } else {
        downloadTextFile(fileName, data);
      }
    } catch (error) {
      notify("error", `내보내기 실패: ${getErrorMessage(error)}`);
    } finally {
      setBusyAction(null);
    }
  };

  const exportSpriteSheet = async () => {
    setBusyAction("export-sheet");
    try {
      const data = await createSpriteSheet(project);
      if (window.pixelPet) {
        const result = await window.pixelPet.exportPet({
          suggestedName: `${slugify(project.name)}-spritesheet.png`,
          format: "spritesheet",
          data,
        });
        if (result.status === "exported") notify("success", `내보냈습니다: ${result.path}`);
      } else {
        const blob = new Blob([data.slice().buffer as ArrayBuffer], { type: "image/png" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${slugify(project.name)}-spritesheet.png`;
        anchor.click();
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      notify("error", `스프라이트시트 실패: ${getErrorMessage(error)}`);
    } finally {
      setBusyAction(null);
    }
  };

  const stepComplete = (target: StudioStep): boolean => {
    if (target === "guide") return Boolean(catalog && activeStyle && activePose);
    if (target === "frames") return importedCount > 0;
    if (target === "remove") return cleanedCount > 0;
    if (target === "preview") return importedCount > 0;
    return petState?.status === "running" || Boolean(projectPath);
  };

  return (
    <div className="studio-shell">
      <header className="app-bar">
        <button className="brand" disabled={Boolean(busyAction)} onClick={() => setStep("guide")} type="button">
          <span className="brand__mark" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span>
            <strong>PixelPet</strong>
            <small>STUDIO</small>
          </span>
        </button>
        <div className="app-bar__project">
          <span className="status-dot" />
          <input
            aria-label="프로젝트 이름"
            data-testid="project-name"
            maxLength={48}
            onChange={(event) => setProjectName(event.target.value)}
            value={projectName}
          />
          <span className="save-state">{projectPath ? "저장됨" : "새 프로젝트"}</span>
        </div>
        <div className="app-bar__actions">
          <button className="button button--ghost" disabled={Boolean(busyAction)} onClick={loadProject} type="button">
            <Icon name="folder" />
            <span>불러오기</span>
          </button>
          <button className="button button--soft" disabled={Boolean(busyAction)} onClick={() => saveProject(false)} type="button">
            <Icon name="save" />
            <span>저장</span>
          </button>
        </div>
      </header>

      <aside className="workflow-sidebar" aria-label="제작 단계">
        <div className="workflow-sidebar__intro">
          <p>CREATE YOUR PET</p>
          <span>생성부터 실행까지 한곳에서</span>
        </div>
        <nav>
          {STEP_ITEMS.map((item, index) => {
            const active = step === item.id;
            const complete = stepComplete(item.id);
            return (
              <button
                aria-current={active ? "step" : undefined}
                className={`${active ? "is-active" : ""} ${complete ? "is-complete" : ""}`}
                data-testid={`workflow-step-${item.id}`}
                disabled={Boolean(busyAction)}
                key={item.id}
                onClick={() => setStep(item.id)}
                type="button"
              >
                <span className="workflow-sidebar__rail">
                  <span>{complete && !active ? <Icon name="check" /> : index + 1}</span>
                </span>
                <span className="workflow-sidebar__copy">
                  <small>{item.eyebrow}</small>
                  <strong>{item.label}</strong>
                  <em>{item.description}</em>
                </span>
                <Icon className="workflow-sidebar__arrow" name="arrow" />
              </button>
            );
          })}
        </nav>
        <div className="sidebar-progress">
          <div>
            <span>프로젝트 진행률</span>
            <strong>{Math.round((STEP_ITEMS.filter((item) => stepComplete(item.id)).length / STEP_ITEMS.length) * 100)}%</strong>
          </div>
          <span className="progress-track">
            <i style={{ width: `${(STEP_ITEMS.filter((item) => stepComplete(item.id)).length / STEP_ITEMS.length) * 100}%` }} />
          </span>
          <small>{importedCount}개 프레임 · {cleanedCount}개 투명화</small>
        </div>
      </aside>

      <main className="studio-main">
        {step === "guide" && (
          <section className="studio-section">
            <SectionHeading
              eyebrow="01 · GENERATION GUIDE"
              title="AI에게 정확히 보여줄 세 가지"
              description="캐릭터는 사용자가, 스타일과 움직임 규칙은 PixelPet이 준비합니다. 아래 레퍼런스와 프롬프트를 GPT 또는 Gemini에 함께 넣어 주세요."
              aside={
                catalog?.isFallback ? (
                  <span className="manifest-state manifest-state--fallback"><Icon name="warning" /> 기본 안내 모드</span>
                ) : (
                  <span className="manifest-state"><Icon name="check" /> 레퍼런스 팩 연결됨</span>
                )
              }
            />

            <div className="guide-overview">
              <article className="guide-overview__hero">
                <span className="guide-overview__number">01</span>
                <div className="guide-overview__icon"><Icon name="image" /></div>
                <div>
                  <h2>원본 마스코트</h2>
                  <p>가장 선명한 정면 이미지와 가능하면 측면 이미지를 준비하세요.</p>
                </div>
                <ul>
                  <li><Icon name="check" /> 로고와 장식이 가리지 않은 이미지</li>
                  <li><Icon name="check" /> 기관이 허가한 공식 원본</li>
                </ul>
              </article>
              <article className="guide-overview__hero guide-overview__hero--accent">
                <span className="guide-overview__number">02</span>
                <div className="guide-overview__icon"><Icon name="sparkles" /></div>
                <div>
                  <h2>픽셀 스타일</h2>
                  <p>캔버스와 팔레트가 정의된 검증 스타일을 하나 고르세요.</p>
                </div>
                <strong>{activeStyle?.canvas ?? "64 × 64"} <i>·</i> {activeStyle?.paletteMax ?? 16} COLORS</strong>
              </article>
              <article className="guide-overview__hero">
                <span className="guide-overview__number">03</span>
                <div className="guide-overview__icon"><Icon name="layers" /></div>
                <div>
                  <h2>포즈 시퀀스</h2>
                  <p>형태가 아니라 관절과 무게중심만 가져오도록 안내합니다.</p>
                </div>
                <strong>{activePose?.frames.length ?? 4} FRAMES <i>·</i> {activePose?.loop ? "LOOP" : "ONE SHOT"}</strong>
              </article>
            </div>

            <div className="guide-grid">
              <article className="panel example-panel">
                <div className="panel__heading">
                  <div>
                    <span className="panel__step">EXAMPLE PETS</span>
                    <h2>5가지 완성 예시</h2>
                  </div>
                  <span className="panel__count">{catalogLoading ? "…" : catalog?.examples.length ?? 0}</span>
                </div>
                <div className="example-list" aria-busy={catalogLoading}>
                  {catalog?.examples.map((example) => (
                    <button
                      className={activeExampleId === example.id ? "is-active" : ""}
                      key={example.id}
                      onClick={() => {
                        setActiveExampleId(example.id);
                        if (example.defaultStyleId) setActiveStyleId(example.defaultStyleId);
                      }}
                      type="button"
                    >
                      <span className="example-list__image checkerboard">
                        <ReferenceImage
                          fallbackSrc={example.sourceImage}
                          label={example.name}
                          src={example.previewImage}
                        />
                      </span>
                      <span>
                        <strong>{example.name}</strong>
                        <small>{example.animal}</small>
                      </span>
                      <span className="example-list__radio"><i /></span>
                    </button>
                  ))}
                </div>
                {activeExample && <p className="example-note">{activeExample.description}</p>}
              </article>

              <article className="panel style-panel">
                <div className="panel__heading">
                  <div>
                    <span className="panel__step">STYLE REFERENCE</span>
                    <h2>스타일 선택</h2>
                  </div>
                </div>
                <div className="style-list">
                  {catalog?.styles.map((style) => (
                    <button
                      className={activeStyleId === style.id ? "is-active" : ""}
                      key={style.id}
                      onClick={() => setActiveStyleId(style.id)}
                      type="button"
                    >
                      <span className="style-list__image checkerboard">
                        <ReferenceImage label={style.label} src={style.image} />
                      </span>
                      <span className="style-list__copy">
                        <strong>{style.label}</strong>
                        <small>{style.description ?? "일관된 픽셀 클러스터와 외곽선"}</small>
                        <em>{style.canvas ?? "64 × 64"} <i /> {style.paletteMax ?? 16}색</em>
                      </span>
                      <span className="style-list__check"><Icon name="check" /></span>
                    </button>
                  ))}
                </div>
                {activeStyle?.image && (
                  <a
                    className="reference-open-link"
                    download
                    href={activeStyle.image}
                  >
                    <Icon name="download" /> 선택한 스타일 레퍼런스 저장
                  </a>
                )}
              </article>
            </div>

            <article className="panel pose-panel">
              <div className="panel__heading panel__heading--row">
                <div>
                  <span className="panel__step">POSE REFERENCE</span>
                  <h2>동작과 프레임 순서</h2>
                </div>
                <div className="pose-selector" role="tablist" aria-label="포즈 레퍼런스 선택">
                  {catalog?.poses.map((pose) => (
                    <button
                      aria-selected={activePoseId === pose.id}
                      className={activePoseId === pose.id ? "is-active" : ""}
                      key={pose.id}
                      onClick={() => {
                        setActivePoseId(pose.id);
                        const nextMotion = motionFromPoseId(pose.id);
                        if (nextMotion) setActiveMotion(nextMotion);
                      }}
                      role="tab"
                      type="button"
                    >
                      {pose.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="pose-frames">
                {activePose?.frames.map((frame, index) => (
                  <a
                    className="pose-frame"
                    download
                    href={frame.image}
                    key={frame.id}
                    onClick={(event) => !frame.image && event.preventDefault()}
                  >
                    <span className="pose-frame__index">F{String(index + 1).padStart(2, "0")}</span>
                    <span className="pose-frame__image checkerboard">
                      <ReferenceImage label={`${activePose.label} ${index + 1}`} src={frame.image} />
                    </span>
                    <small>{frame.label}</small>
                  </a>
                ))}
                {!activePose?.frames.length && (
                  <div className="empty-inline"><Icon name="warning" /> 이 동작의 포즈 이미지가 준비 중입니다.</div>
                )}
              </div>
              <footer className="pose-panel__footer">
                <span><i className="status-dot" /> 프레임을 누르면 원본 레퍼런스를 저장할 수 있어요.</span>
                <span>고급 동작용 · 프레임별 생성법은 docs/prompting 참고</span>
              </footer>
            </article>

            <article className="prompt-panel">
              <div className="prompt-panel__heading">
                <div className="prompt-panel__mark"><Icon name="sparkles" /></div>
                <div>
                  <span>READY-TO-USE PROMPT</span>
                  <h2>기준 픽셀 마스터 생성 프롬프트</h2>
                  <p>원본 마스코트 → 스타일 레퍼런스 순서로 두 장만 첨부한 다음 붙여 넣으세요.</p>
                </div>
                <button className="button button--primary" onClick={copyPrompt} type="button">
                  <Icon name="copy" /> 프롬프트 복사
                </button>
              </div>
              <pre tabIndex={0}>{prompt}</pre>
            </article>

            <div className="section-footer">
              <p><Icon name="check" /> 초보자는 완성된 기준 픽셀 마스터 한 장을 3단계 빠른 자동 완성에 넣으세요. 포즈별 제작은 고급 경로입니다.</p>
              <button className="button button--primary button--large" onClick={() => setStep("remove")} type="button">
                한 장으로 빠르게 만들기 <Icon name="arrow" />
              </button>
            </div>
          </section>
        )}

        {step === "frames" && (
          <section className="studio-section">
            <SectionHeading
              eyebrow="02 · IMPORT FRAMES"
              title="만든 이미지를 동작별로 채우세요"
              description="파일을 슬롯에 끌어 놓거나 눌러서 선택하세요. 여러 장을 한 번에 가져오면 빈 슬롯 순서대로 들어갑니다."
              aside={<span className="counter-pill"><strong>{importedCount}</strong> FRAME{importedCount === 1 ? "" : "S"}</span>}
            />
            <MotionTabs active={activeMotion} frames={frames} onChange={setActiveMotion} />
            <article className="panel frames-panel">
              <div className="frames-panel__heading">
                <div>
                  <span>{MOTION_META[activeMotion].shortLabel}</span>
                  <h2>{MOTION_META[activeMotion].label} 프레임</h2>
                  <p>{MOTION_META[activeMotion].description}</p>
                </div>
                <button className="button button--soft" disabled={Boolean(busyAction)} onClick={() => bulkInputRef.current?.click()} type="button">
                  <Icon name="upload" /> 여러 장 가져오기
                </button>
                <input
                  accept="image/png,image/jpeg,image/webp"
                  className="visually-hidden"
                  disabled={Boolean(busyAction)}
                  multiple
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    const firstEmpty = frames[activeMotion].findIndex((frame) => !frame);
                    if (firstEmpty < 0) {
                      notify("info", "이 동작의 프레임 슬롯이 모두 채워졌습니다.");
                    } else {
                      void importFiles(activeMotion, firstEmpty, Array.from(event.target.files ?? []));
                    }
                    event.target.value = "";
                  }}
                  ref={bulkInputRef}
                  type="file"
                />
              </div>
              <div className="frame-grid">
                {frames[activeMotion].map((frame, index) => (
                  <FrameSlot
                    disabled={Boolean(busyAction)}
                    frame={frame}
                    index={index}
                    key={`${activeMotion}-${index}`}
                    onImport={(filesToAdd) => void importFiles(activeMotion, index, filesToAdd)}
                    onRemove={() => removeFrame(activeMotion, index)}
                    onSelect={() => setSelectedFrame({ state: activeMotion, index })}
                    selected={selectedFrame?.state === activeMotion && selectedFrame.index === index}
                    state={activeMotion}
                  />
                ))}
              </div>
              <div className="frames-panel__tips">
                <span><Icon name="layers" /> 같은 캔버스 크기와 발 기준선을 유지하면 흔들림이 줄어요.</span>
                <span>최대 20MB · 4MP · 한 변 4096px · PNG 권장</span>
              </div>
            </article>
            <div className="section-footer">
              <p>{selectedAsset ? <><Icon name="check" /> {selectedAsset.name} 선택됨</> : <><Icon name="warning" /> 프레임을 선택하면 다음 단계에서 바로 편집할 수 있어요.</>}</p>
              <button className="button button--primary button--large" disabled={Boolean(busyAction) || !importedCount} onClick={() => setStep("remove")} type="button">
                배경 제거하기 <Icon name="arrow" />
              </button>
            </div>
          </section>
        )}

        {step === "remove" && (
          <section className="studio-section">
            <SectionHeading
              eyebrow="03 · REMOVE BACKGROUND"
              title="캐릭터만 깨끗하게 남기세요"
              description="브라우저 안에서 동작하는 로컬 AI 모델이 선택한 프레임을 처리합니다. 이미지가 외부 서버로 전송되지 않습니다."
              aside={<span className="privacy-pill"><span className="status-dot" /> ON-DEVICE</span>}
            />
            <article
              aria-busy={
                quickPet.phase === "reading" ||
                quickPet.phase === "removing" ||
                quickPet.phase === "generating"
              }
              className={`quick-pet-card quick-pet-card--${quickPet.phase}`}
              data-background-removal={quickPet.backgroundRemoval ?? "pending"}
              data-chroma-cleanup={quickPet.chromaCleanup ?? "pending"}
              data-chroma-key={quickPet.chromaKey ?? ""}
              data-file-name={quickPet.fileName ?? ""}
              data-phase={quickPet.phase}
              data-testid="quick-pet-card"
            >
              <div className="quick-pet-card__icon"><Icon name="sparkles" /></div>
              <div className="quick-pet-card__copy">
                <div className="quick-pet-card__title">
                  <span>QUICK START · RECOMMENDED</span>
                  <h2>이미지 한 장으로 자동 완성</h2>
                  <em>추천</em>
                </div>
                <p>
                  배경을 투명하게 만들고 {activeStyle?.canvas ?? "64 × 64"} 크기로 맞춘 뒤,
                  가볍게 숨 쉬는 대기 프레임 4개를 자동으로 만듭니다.
                </p>
                <small>기존 대기 프레임은 교체되며 걷기·점프 등 다른 동작은 그대로 유지됩니다.</small>
              </div>
              <div className="quick-pet-card__action">
                <button
                  className="button button--primary"
                  data-testid="quick-pet-choose"
                  disabled={Boolean(busyAction)}
                  onClick={() => quickPetInputRef.current?.click()}
                  type="button"
                >
                  <Icon name="upload" /> {quickPet.phase === "success" ? "다른 이미지로 다시 만들기" : "이미지 한 장 고르기"}
                </button>
                <input
                  accept="image/png,image/jpeg,image/webp"
                  className="visually-hidden"
                  data-testid="quick-pet-file-input"
                  disabled={Boolean(busyAction)}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void createQuickPet(file);
                    event.target.value = "";
                  }}
                  ref={quickPetInputRef}
                  type="file"
                />
                <span>{quickPet.fileName ?? "PNG · JPG · WebP / 최대 20MB · 4MP · 한 변 4096px"}</span>
              </div>
              <div
                aria-live="polite"
                className="quick-pet-card__progress"
                data-testid="quick-pet-progress"
              >
                <div>
                  <strong data-testid="quick-pet-status">
                    {quickPet.phase === "success"
                      ? "자동 완성됨"
                      : quickPet.phase === "error"
                        ? "다시 확인해 주세요"
                        : quickPet.phase === "idle"
                          ? "시작할 준비가 됐어요"
                          : "자동으로 만드는 중"}
                  </strong>
                  <span>{quickPet.detail}</span>
                  <b>{quickPet.progress}%</b>
                </div>
                <span
                  aria-label="자동 완성 진행률"
                  aria-valuemax={100}
                  aria-valuemin={0}
                  aria-valuenow={quickPet.progress}
                  className="progress-track"
                  role="progressbar"
                >
                  <i style={{ width: `${quickPet.progress}%` }} />
                </span>
              </div>
              {quickPet.phase === "success" && (
                <div className="quick-pet-card__frames" data-testid="quick-pet-result">
                  {frames.idle.slice(0, 4).map((frame, index) =>
                    frame ? (
                      <span className="checkerboard" data-testid={`quick-pet-frame-${index}`} key={frame.id}>
                        <img alt={`자동 생성 대기 프레임 ${index + 1}`} src={frame.dataUrl} />
                      </span>
                    ) : null,
                  )}
                </div>
              )}
            </article>
            <div className="quick-pet-divider"><span>또는 프레임별로 직접 다듬기</span></div>
            <div className="remove-layout">
              <aside className="panel frame-browser">
                <div className="panel__heading">
                  <div>
                    <span className="panel__step">FRAME LIST</span>
                    <h2>처리할 프레임</h2>
                  </div>
                  <span className="panel__count">{cleanedCount}/{importedCount}</span>
                </div>
                <div className="frame-browser__motions">
                  {ANIMATION_STATES.map((state) => {
                    const stateFrames = frames[state]
                      .map((frame, index) => ({ frame, index }))
                      .filter((item): item is { frame: FrameAsset; index: number } => Boolean(item.frame));
                    if (!stateFrames.length) return null;
                    return (
                      <div key={state}>
                        <p><strong>{MOTION_META[state].label}</strong><span>{stateFrames.filter(({ frame }) => frame.backgroundRemoved).length}/{stateFrames.length}</span></p>
                        <div>
                          {stateFrames.map(({ frame, index }) => (
                            <button
                              aria-label={`${MOTION_META[state].label} ${index + 1}번 프레임`}
                              className={`checkerboard ${selectedFrame?.state === state && selectedFrame.index === index ? "is-active" : ""}`}
                              disabled={Boolean(busyAction) || removal.phase === "loading" || removal.phase === "processing"}
                              key={frame.id}
                              onClick={() => {
                                setSelectedFrame({ state, index });
                                setRemoval({ phase: "idle", progress: 0, detail: "배경 제거를 실행할 준비가 됐습니다." });
                              }}
                              type="button"
                            >
                              <img alt="" src={frame.dataUrl} />
                              <span>{index + 1}</span>
                              {frame.backgroundRemoved && <i><Icon name="check" /></i>}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  {!importedCount && <div className="empty-inline"><Icon name="image" /> 가져온 프레임이 없습니다.</div>}
                </div>
              </aside>

              <article className="remove-workspace">
                <div className="compare-stage">
                  {selectedAsset ? (
                    <>
                      <div className="compare-stage__pane">
                        <header><span>ORIGINAL</span><small>{selectedAsset.width} × {selectedAsset.height}</small></header>
                        <div className="checkerboard"><img alt="배경 제거 전" src={selectedAsset.originalDataUrl} /></div>
                      </div>
                      <div className="compare-stage__divider"><Icon name="arrow" /></div>
                      <div className="compare-stage__pane">
                        <header><span>RESULT</span><small>{selectedAsset.backgroundRemoved ? "ALPHA PNG" : "WAITING"}</small></header>
                        <div className="checkerboard"><img alt="현재 결과" src={selectedAsset.dataUrl} /></div>
                      </div>
                    </>
                  ) : (
                    <div className="remove-empty">
                      <span><Icon name="cut" /></span>
                      <h2>프레임을 하나 선택하세요</h2>
                      <p>왼쪽 목록에서 배경을 제거할 이미지를 골라 주세요.</p>
                    </div>
                  )}
                </div>
                <div className={`removal-console removal-console--${removal.phase}`}>
                  <div className="removal-console__top">
                    <div className="removal-console__status">
                      <span className="removal-console__icon">
                        {removal.phase === "success" ? <Icon name="check" /> : removal.phase === "error" ? <Icon name="warning" /> : <Icon name="sparkles" />}
                      </span>
                      <div>
                        <strong>{removal.phase === "loading" || removal.phase === "processing" ? "로컬 AI 처리 중" : removal.phase === "success" ? "배경 제거 완료" : removal.phase === "error" ? "처리하지 못했어요" : "배경 제거 준비"}</strong>
                        <small>{removal.detail}</small>
                      </div>
                    </div>
                    <strong>{removal.progress}%</strong>
                  </div>
                  <span className="progress-track"><i style={{ width: `${removal.progress}%` }} /></span>
                  <div className="removal-console__actions">
                    <p><span className="status-dot" /> 첫 실행에는 앱에 포함된 모델을 메모리에 올려 잠시 걸릴 수 있어요.</p>
                    <button className="button button--ghost" disabled={Boolean(busyAction) || !selectedAsset?.backgroundRemoved || removal.phase === "processing"} onClick={restoreBackground} type="button"><Icon name="refresh" /> 원본 복원</button>
                    <button className="button button--primary" data-testid="manual-remove-background" disabled={Boolean(busyAction) || !selectedAsset || removal.phase === "loading" || removal.phase === "processing"} onClick={() => void removeBackground()} type="button"><Icon name="cut" /> {selectedAsset?.backgroundRemoved ? "다시 제거" : "배경 제거"}</button>
                  </div>
                </div>
              </article>
            </div>
            <div className="section-footer">
              <p><Icon name="check" /> 투명화하지 않은 프레임도 미리보기에서 함께 확인할 수 있어요.</p>
              <button className="button button--primary button--large" disabled={Boolean(busyAction) || !importedCount} onClick={() => setStep("preview")} type="button">
                움직임 확인하기 <Icon name="arrow" />
              </button>
            </div>
          </section>
        )}

        {step === "preview" && (
          <section className="studio-section">
            <SectionHeading
              eyebrow="04 · ANIMATION PREVIEW"
              title="이제 살아 움직이는지 확인해 볼까요?"
              description="동작별 루프와 프레임 속도, 실제 데스크톱에서 보일 픽셀 배율을 조정하세요."
              aside={<span className="counter-pill"><strong>{fps}</strong> FPS</span>}
            />
            <MotionTabs active={activeMotion} frames={frames} onChange={setActiveMotion} />
            <div className="preview-layout">
              <article className="preview-stage-panel">
                <div className="preview-stage__toolbar">
                  <span><i className="status-dot" /> LIVE PREVIEW</span>
                  <small>{MOTION_META[activeMotion].shortLabel} · {activePreviewFrames.length} FRAMES</small>
                </div>
                <div className={`preview-stage checkerboard preview-motion--${activeMotion}`} data-testid="animation-preview">
                  {activePreviewFrames.length ? (
                    <img
                      alt={`${MOTION_META[activeMotion].label} 애니메이션 미리보기`}
                      key={activePreviewFrames[previewFrameIndex % activePreviewFrames.length].id}
                      src={activePreviewFrames[previewFrameIndex % activePreviewFrames.length].dataUrl}
                      style={{ width: `${Math.min(320, activePreviewFrames[previewFrameIndex % activePreviewFrames.length].width * scale)}px` }}
                    />
                  ) : (
                    <div className="preview-empty"><Icon name="image" /><strong>이 동작은 아직 비어 있어요</strong><button onClick={() => setStep("frames")} type="button">프레임 채우기</button></div>
                  )}
                  <span className="preview-stage__floor" />
                </div>
                <div className="transport">
                  <button aria-label={playing ? "일시 정지" : "재생"} className="transport__play" disabled={!activePreviewFrames.length} onClick={() => setPlaying((value) => !value)} type="button">
                    <Icon name={playing ? "pause" : "play"} />
                  </button>
                  <div className="transport__timeline">
                    <div>
                      {activePreviewFrames.map((frame, index) => (
                        <button
                          aria-label={`${index + 1}번 프레임으로 이동`}
                          className={previewFrameIndex % activePreviewFrames.length === index ? "is-active" : ""}
                          key={frame.id}
                          onClick={() => {
                            setPreviewFrameIndex(index);
                            setPlaying(false);
                          }}
                          type="button"
                        />
                      ))}
                    </div>
                    <span>{String((previewFrameIndex % Math.max(1, activePreviewFrames.length)) + 1).padStart(2, "0")} / {String(activePreviewFrames.length).padStart(2, "0")}</span>
                  </div>
                </div>
              </article>

              <aside className="panel preview-controls">
                <div className="panel__heading"><div><span className="panel__step">PLAYBACK</span><h2>재생 설정</h2></div></div>
                <label className="range-control">
                  <span><strong>프레임 속도</strong><em>{fps} FPS</em></span>
                  <input aria-label="프레임 속도" max="16" min="2" onChange={(event) => setFps(Number(event.target.value))} step="1" type="range" value={fps} />
                  <small><span>느리게</span><span>빠르게</span></small>
                </label>
                <label className="range-control">
                  <span><strong>화면 배율</strong><em>{scale}×</em></span>
                  <input aria-label="화면 배율" max="6" min="0.25" onChange={(event) => setScale(Number(event.target.value))} step="0.25" type="range" value={scale} />
                  <small><span>작게</span><span>크게</span></small>
                </label>
                <div className="pixel-rule">
                  <span className="pixel-rule__icon"><Icon name="check" /></span>
                  <div><strong>픽셀 퍼펙트 렌더링</strong><small>보간 없이 가장 가까운 픽셀로 확대합니다.</small></div>
                </div>
                <div className="preview-summary">
                  <p><span>캔버스</span><strong>{activePreviewFrames[0] ? `${activePreviewFrames[0].width} × ${activePreviewFrames[0].height}` : "—"}</strong></p>
                  <p><span>투명 프레임</span><strong>{activePreviewFrames.filter((frame) => frame.backgroundRemoved).length} / {activePreviewFrames.length}</strong></p>
                  <p><span>루프 시간</span><strong>{activePreviewFrames.length ? `${(activePreviewFrames.length / fps).toFixed(2)}s` : "—"}</strong></p>
                </div>
              </aside>
            </div>
            <div className="section-footer">
              <p><Icon name="check" /> 설정은 프로젝트와 데스크톱 펫에 그대로 적용됩니다.</p>
              <button className="button button--primary button--large" disabled={!importedCount} onClick={() => setStep("publish")} type="button">
                펫 완성하기 <Icon name="arrow" />
              </button>
            </div>
          </section>
        )}

        {step === "publish" && (
          <section className="studio-section publish-section">
            <SectionHeading
              eyebrow="05 · READY TO PLAY"
              title="픽셀 펫이 완성됐어요"
              description="데스크톱 위에서 바로 실행하거나 프로젝트와 범용 스프라이트 자산으로 안전하게 보관하세요."
              aside={<span className={`run-state run-state--${petState?.status ?? "stopped"}`}><span className="status-dot" /> {petState?.status === "running" ? "RUNNING" : petState?.status === "paused" ? "PAUSED" : "READY"}</span>}
            />
            <div className="publish-hero">
              <div className="publish-hero__glow" />
              <div className="publish-hero__stage checkerboard">
                {activePreviewFrames[previewFrameIndex % Math.max(1, activePreviewFrames.length)] ? (
                  <img alt="완성된 픽셀 펫" src={activePreviewFrames[previewFrameIndex % activePreviewFrames.length].dataUrl} />
                ) : <Icon name="image" />}
              </div>
              <div className="publish-hero__copy">
                <span>YOUR NEW COMPANION</span>
                <h2>{project.name}</h2>
                <p>{importedCount}개 프레임 · {fps} FPS · {scale}× 렌더링</p>
                <div>
                  {petState?.status === "running" ? (
                    <button className="button button--danger button--large" disabled={busyAction === "stop"} onClick={stopPet} type="button"><Icon name="stop" /> 데스크톱 펫 종료</button>
                  ) : (
                    <button className="button button--primary button--large" disabled={!importedCount || busyAction === "pet"} onClick={startPet} type="button"><Icon name="play" /> 데스크톱에서 실행</button>
                  )}
                  <small>Windows · macOS 지원</small>
                </div>
              </div>
            </div>

            <div className="publish-grid">
              <article className="panel publish-card">
                <span className="publish-card__icon"><Icon name="save" /></span>
                <div><span>KEEP EDITING</span><h2>프로젝트 저장</h2><p>모든 원본과 투명 프레임, 재생 설정을 하나의 프로젝트 파일로 보관합니다.</p></div>
                <footer>
                  <button className="button button--soft" disabled={Boolean(busyAction)} onClick={() => saveProject(false)} type="button"><Icon name="save" /> {projectPath ? "변경 내용 저장" : "프로젝트 저장"}</button>
                  {projectPath && <button className="text-button" disabled={Boolean(busyAction)} onClick={() => saveProject(true)} type="button">다른 이름으로</button>}
                </footer>
              </article>
              <article className="panel publish-card">
                <span className="publish-card__icon publish-card__icon--violet"><Icon name="layers" /></span>
                <div><span>USE ANYWHERE</span><h2>스프라이트시트 PNG</h2><p>동작을 행별로 정렬한 투명 PNG를 게임 엔진이나 웹 프로젝트에서 사용하세요.</p></div>
                <footer><button className="button button--soft" data-testid="export-spritesheet" disabled={!importedCount || Boolean(busyAction)} onClick={exportSpriteSheet} type="button"><Icon name="download" /> PNG 내보내기</button></footer>
              </article>
              <article className="panel publish-card">
                <span className="publish-card__icon publish-card__icon--cyan"><Icon name="download" /></span>
                <div><span>PORTABLE DATA</span><h2>프로젝트 JSON</h2><p>프레임 데이터가 포함된 이식 가능한 JSON으로 백업하거나 다른 도구와 연결하세요.</p></div>
                <footer><button className="button button--soft" data-testid="export-project-json" disabled={!importedCount || Boolean(busyAction)} onClick={exportProject} type="button"><Icon name="download" /> JSON 내보내기</button></footer>
              </article>
            </div>

            <div className="readiness-panel">
              <div><span className="readiness-panel__mark"><Icon name="check" /></span><div><strong>펫 자산 검사</strong><small>실행 전에 빠진 동작을 확인해 보세요.</small></div></div>
              <ul>
                {ANIMATION_STATES.map((state) => (
                  <li className={frames[state].some(Boolean) ? "is-ready" : ""} key={state}>
                    <span>{frames[state].some(Boolean) ? <Icon name="check" /> : <Icon name="warning" />}</span>
                    <div><strong>{MOTION_META[state].label}</strong><small>{frames[state].filter(Boolean).length} frames</small></div>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}
      </main>

      {toast && (
        <div aria-live="polite" className={`toast toast--${toast.tone}`} role="status">
          <span>{toast.tone === "success" ? <Icon name="check" /> : toast.tone === "error" ? <Icon name="warning" /> : <Icon name="sparkles" />}</span>
          {toast.message}
          <button aria-label="알림 닫기" onClick={() => setToast(null)} type="button"><Icon name="x" /></button>
        </div>
      )}
    </div>
  );
}
