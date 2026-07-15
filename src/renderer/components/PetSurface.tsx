import { useEffect, useMemo, useState } from "react";
import type { PetAnimationName, PixelPetProject } from "../../shared/project";
import type { PetDirection, PetRenderCommand } from "../../shared/ipc";

export function PetSurface() {
  const [project, setProject] = useState<PixelPetProject | null>(null);
  const [animation, setAnimation] = useState<PetAnimationName>("idle");
  const [direction, setDirection] = useState<PetDirection>("right");
  const [paused, setPaused] = useState(false);
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    document.documentElement.classList.add("pet-window");
    document.body.classList.add("pet-window");

    const handleCommand = (command: PetRenderCommand) => {
      if (command.type === "hydrate") {
        setProject(command.project);
        setAnimation(command.animation);
        setDirection(command.direction);
        setPaused(command.paused);
      } else if (command.type === "project") {
        setProject(command.project);
      } else if (command.type === "animation") {
        setAnimation(command.animation);
      } else if (command.type === "direction") {
        setDirection(command.direction);
      } else if (command.type === "pause") {
        setPaused(command.paused);
      }
    };

    const unsubscribe = window.pixelPet?.onPetCommand(handleCommand);
    return () => {
      unsubscribe?.();
      document.documentElement.classList.remove("pet-window");
      document.body.classList.remove("pet-window");
    };
  }, []);

  const activeFrames = useMemo(
    () => project?.frames[animation].filter((frame) => frame !== null) ?? [],
    [animation, project],
  );

  useEffect(() => {
    setFrameIndex(0);
  }, [animation, project]);

  useEffect(() => {
    if (paused || activeFrames.length <= 1 || !project) return undefined;
    const timer = window.setInterval(
      () => setFrameIndex((current) => (current + 1) % activeFrames.length),
      Math.max(50, 1000 / project.fps),
    );
    return () => window.clearInterval(timer);
  }, [activeFrames.length, paused, project]);

  useEffect(() => {
    if (
      paused ||
      !project ||
      (animation !== "jump" && animation !== "reaction") ||
      !project.frames.idle.some(Boolean)
    ) {
      return undefined;
    }
    const returnDelay = Math.max(180, (activeFrames.length / project.fps) * 1000);
    const timer = window.setTimeout(() => {
      void window.pixelPet?.updatePet({ animation: "idle" });
    }, returnDelay);
    return () => window.clearTimeout(timer);
  }, [activeFrames.length, animation, paused, project]);

  const frame = activeFrames[frameIndex % Math.max(1, activeFrames.length)];
  const reactToClick = () => {
    if (!project?.frames.reaction.some(Boolean)) return;
    void window.pixelPet?.updatePet({ animation: "reaction" });
  };

  if (!project || !frame) {
    return (
      <main className="pet-surface pet-surface--loading" aria-label="픽셀 펫을 준비하는 중">
        <span />
        <span />
        <span />
      </main>
    );
  }

  return (
    <main
      className={`pet-surface pet-motion--${animation}`}
      aria-label={`${project.name} 데스크톱 펫`}
      onDoubleClick={reactToClick}
    >
      <img
        alt=""
        draggable={false}
        src={frame.dataUrl}
        style={{
          width: `${frame.width * project.scale}px`,
          transform: direction === "left" ? "scaleX(-1)" : undefined,
        }}
      />
    </main>
  );
}
