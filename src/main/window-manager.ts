import { app, BrowserWindow, screen, type Rectangle } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";

import type {
  PetDirection,
  PetMotion,
  PetRenderCommand,
  PetWindowState,
  Point,
  StartPetRequest,
  UpdatePetRequest,
} from "../shared/ipc.js";
import { IPC_CHANNELS } from "../shared/ipc.js";
import {
  PET_ANIMATION_NAMES,
  type PetAnimationName,
  type PixelPetFrameAsset,
  type PixelPetProject,
} from "../shared/project.js";
import { assertPixelPetProject } from "./project-files.js";
import { rendererEntryUrl } from "./app-protocol.js";

const MIN_PET_SIZE = 32;
const MAX_PET_SIZE = 1024;
const MAX_ABSOLUTE_VELOCITY = 1_000;
const MOTION_INTERVAL_MS = 16;
const STATE_BROADCAST_INTERVAL_MS = 100;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function isFinitePoint(value: unknown): value is Point {
  if (typeof value !== "object" || value === null) return false;
  const point = value as Point;
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function isAnimationName(value: unknown): value is PetAnimationName {
  return PET_ANIMATION_NAMES.some((name) => name === value);
}

function firstFrame(project: PixelPetProject, preferred: PetAnimationName): PixelPetFrameAsset | null {
  for (const frame of project.frames[preferred]) {
    if (frame) return frame;
  }
  for (const animation of PET_ANIMATION_NAMES) {
    for (const frame of project.frames[animation]) {
      if (frame) return frame;
    }
  }
  return null;
}

function initialAnimation(
  project: PixelPetProject,
  preferred: PetAnimationName,
): PetAnimationName {
  if (project.frames[preferred].some(Boolean)) return preferred;
  return PET_ANIMATION_NAMES.find((name) => project.frames[name].some(Boolean)) ?? preferred;
}

function petContentSize(project: PixelPetProject, animation: PetAnimationName): {
  width: number;
  height: number;
} {
  const frame = firstFrame(project, animation);
  const rawWidth = frame?.width ?? 96;
  const rawHeight = frame?.height ?? 96;
  return {
    width: clamp(Math.round(rawWidth * project.scale), MIN_PET_SIZE, MAX_PET_SIZE),
    height: clamp(Math.round(rawHeight * project.scale), MIN_PET_SIZE, MAX_PET_SIZE),
  };
}

function boundedPosition(position: Point, size: { width: number; height: number }): Point {
  const display = screen.getDisplayNearestPoint({
    x: Math.round(position.x),
    y: Math.round(position.y),
  });
  const area = display.workArea;
  return {
    x: clamp(Math.round(position.x), area.x, area.x + Math.max(0, area.width - size.width)),
    y: clamp(Math.round(position.y), area.y, area.y + Math.max(0, area.height - size.height)),
  };
}

function defaultPetPosition(size: { width: number; height: number }): Point {
  const area = screen.getPrimaryDisplay().workArea;
  return {
    x: area.x + Math.max(0, area.width - size.width - 32),
    y: area.y + Math.max(0, area.height - size.height - 16),
  };
}

function normalizedMotion(motion?: Partial<PetMotion>, previous?: PetMotion): PetMotion {
  const velocityX = motion?.velocityX ?? previous?.velocityX ?? 36;
  const velocityY = motion?.velocityY ?? previous?.velocityY ?? 0;
  if (!Number.isFinite(velocityX) || !Number.isFinite(velocityY)) {
    throw new TypeError("Pet velocity must be finite.");
  }
  if (motion?.bounce !== undefined && typeof motion.bounce !== "boolean") {
    throw new TypeError("Pet bounce must be a boolean.");
  }
  return {
    velocityX: clamp(velocityX, -MAX_ABSOLUTE_VELOCITY, MAX_ABSOLUTE_VELOCITY),
    velocityY: clamp(velocityY, -MAX_ABSOLUTE_VELOCITY, MAX_ABSOLUTE_VELOCITY),
    bounce: motion?.bounce ?? previous?.bounce ?? true,
  };
}

function resolvePreloadPath(): string {
  const candidates = [
    path.resolve(__dirname, "../preload/index.cjs"),
    path.resolve(__dirname, "../preload/index.js"),
    path.resolve(app.getAppPath(), "dist", "preload", "index.cjs"),
    path.resolve(app.getAppPath(), "dist", "preload", "index.js"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function rendererDevUrl(mode: "studio" | "pet"): string | null {
  const rawUrl = process.env.VITE_DEV_SERVER_URL;
  if (!rawUrl) return null;
  const url = new URL(rawUrl);
  url.searchParams.set("mode", mode);
  return url.toString();
}

function secureWebContents(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, targetUrl) => {
    const currentUrl = window.webContents.getURL();
    if (!currentUrl) return;
    try {
      const current = new URL(currentUrl);
      const target = new URL(targetUrl);
      const allowed =
        current.protocol === "app:"
          ? target.protocol === "app:" && target.hostname === current.hostname
          : target.origin === current.origin;
      if (!allowed) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });
}

export class WindowManager {
  #studioWindow: BrowserWindow | null = null;
  #petWindow: BrowserWindow | null = null;
  #project: PixelPetProject | null = null;
  #animation: PetAnimationName = "idle";
  #direction: PetDirection = "right";
  #motion: PetMotion = { velocityX: 0, velocityY: 0, bounce: true };
  #paused = false;
  #motionTimer: ReturnType<typeof setInterval> | null = null;
  #lastMotionTime = 0;
  #lastStateBroadcast = 0;
  #precisePosition: Point | null = null;

  get studioWindow(): BrowserWindow | null {
    return this.#studioWindow && !this.#studioWindow.isDestroyed()
      ? this.#studioWindow
      : null;
  }

  isTrustedSender(webContentsId: number): boolean {
    return [this.studioWindow, this.#petWindow].some(
      (window) => window && !window.isDestroyed() && window.webContents.id === webContentsId,
    );
  }

  isStudioSender(webContentsId: number): boolean {
    const window = this.studioWindow;
    return Boolean(window && window.webContents.id === webContentsId);
  }

  async createStudioWindow(): Promise<BrowserWindow> {
    if (this.studioWindow) {
      this.studioWindow.show();
      this.studioWindow.focus();
      return this.studioWindow;
    }

    const window = new BrowserWindow({
      width: 1240,
      height: 820,
      minWidth: 960,
      minHeight: 640,
      show: false,
      backgroundColor: "#11131a",
      title: "PixelPet Studio",
      webPreferences: {
        preload: resolvePreloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        devTools: !app.isPackaged,
      },
    });
    this.#studioWindow = window;
    secureWebContents(window);
    window.once("ready-to-show", () => window.show());
    window.on("closed", () => {
      if (this.#studioWindow === window) this.#studioWindow = null;
    });

    try {
      await window.loadURL(rendererDevUrl("studio") ?? rendererEntryUrl("studio"));
    } catch (error) {
      if (!window.isDestroyed()) window.destroy();
      throw error;
    }
    return window;
  }

  async startPet(request: StartPetRequest): Promise<PetWindowState> {
    assertPixelPetProject(request.project);
    if (request.animation !== undefined && !isAnimationName(request.animation)) {
      throw new TypeError("Unknown pet animation.");
    }
    if (request.position !== undefined && !isFinitePoint(request.position)) {
      throw new TypeError("Pet position must contain finite x/y values.");
    }

    this.stopPet();
    this.#project = request.project;
    this.#animation = initialAnimation(request.project, request.animation ?? "idle");
    this.#motion = normalizedMotion(request.motion);
    this.#direction = this.#motion.velocityX < 0 ? "left" : "right";
    this.#paused = false;

    const size = petContentSize(request.project, this.#animation);
    const position = boundedPosition(request.position ?? defaultPetPosition(size), size);
    this.#precisePosition = position;

    const window = new BrowserWindow({
      x: position.x,
      y: position.y,
      width: size.width,
      height: size.height,
      minWidth: MIN_PET_SIZE,
      minHeight: MIN_PET_SIZE,
      maxWidth: MAX_PET_SIZE,
      maxHeight: MAX_PET_SIZE,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      alwaysOnTop: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      acceptFirstMouse: true,
      show: false,
      webPreferences: {
        preload: resolvePreloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        devTools: !app.isPackaged,
        backgroundThrottling: false,
      },
    });
    this.#petWindow = window;
    secureWebContents(window);
    window.setAlwaysOnTop(true, "floating");
    if (process.platform === "darwin") {
      window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
    window.on("closed", () => {
      if (this.#petWindow !== window) return;
      this.#petWindow = null;
      this.#project = null;
      this.#precisePosition = null;
      this.#stopMotionTimer();
      this.#broadcastState(true);
    });

    try {
      await window.loadURL(rendererDevUrl("pet") ?? rendererEntryUrl("pet"));
    } catch (error) {
      this.stopPet();
      throw error;
    }
    if (window.isDestroyed()) return this.getPetState();
    window.showInactive();
    this.#sendPetCommand({
      type: "hydrate",
      project: request.project,
      animation: this.#animation,
      direction: this.#direction,
      paused: false,
    });
    this.#startMotionTimer();
    this.#broadcastState(true);
    return this.getPetState();
  }

  updatePet(request: UpdatePetRequest): PetWindowState {
    const window = this.#petWindow;
    if (!window || window.isDestroyed() || !this.#project) {
      throw new Error("No desktop pet is running.");
    }
    if (request.position !== undefined && request.delta !== undefined) {
      throw new TypeError("Use either an absolute position or a delta, not both.");
    }
    if (request.paused !== undefined && typeof request.paused !== "boolean") {
      throw new TypeError("Pet paused state must be a boolean.");
    }

    if (request.project !== undefined) {
      assertPixelPetProject(request.project);
      this.#project = request.project;
      this.#sendPetCommand({ type: "project", project: request.project });
      const size = petContentSize(request.project, request.animation ?? this.#animation);
      window.setSize(size.width, size.height, false);
      const current = this.#precisePosition ?? { x: window.getPosition()[0], y: window.getPosition()[1] };
      const bounded = boundedPosition(current, size);
      this.#precisePosition = bounded;
      window.setPosition(bounded.x, bounded.y, false);
    }

    if (request.animation !== undefined) {
      if (!isAnimationName(request.animation)) throw new TypeError("Unknown pet animation.");
      this.#animation = request.animation;
      this.#sendPetCommand({ type: "animation", animation: request.animation });
      const size = petContentSize(this.#project, request.animation);
      window.setSize(size.width, size.height, false);
      const current = this.#precisePosition ?? {
        x: window.getPosition()[0],
        y: window.getPosition()[1],
      };
      this.#setPetPosition(current);
    }

    if (request.motion !== undefined) {
      const oldDirection = this.#direction;
      this.#motion = normalizedMotion(request.motion, this.#motion);
      if (this.#motion.velocityX !== 0) {
        this.#direction = this.#motion.velocityX < 0 ? "left" : "right";
      }
      if (oldDirection !== this.#direction) {
        this.#sendPetCommand({ type: "direction", direction: this.#direction });
      }
    }

    if (request.position !== undefined) {
      if (!isFinitePoint(request.position)) throw new TypeError("Invalid pet position.");
      this.#setPetPosition(request.position);
    } else if (request.delta !== undefined) {
      if (!isFinitePoint(request.delta)) throw new TypeError("Invalid pet movement delta.");
      const [x, y] = window.getPosition();
      this.#setPetPosition({ x: x + request.delta.x, y: y + request.delta.y });
    }

    if (request.paused !== undefined && request.paused !== this.#paused) {
      this.#paused = request.paused;
      this.#sendPetCommand({ type: "pause", paused: this.#paused });
      this.#lastMotionTime = performance.now();
    }

    this.#broadcastState(true);
    return this.getPetState();
  }

  stopPet(): PetWindowState {
    this.#stopMotionTimer();
    const window = this.#petWindow;
    this.#petWindow = null;
    this.#project = null;
    this.#precisePosition = null;
    this.#paused = false;
    this.#motion = { velocityX: 0, velocityY: 0, bounce: true };
    if (window && !window.isDestroyed()) window.destroy();
    const state = this.getPetState();
    this.#broadcastState(true);
    return state;
  }

  getPetState(): PetWindowState {
    const window = this.#petWindow;
    if (!window || window.isDestroyed()) {
      return {
        status: "stopped",
        animation: this.#animation,
        direction: this.#direction,
        position: null,
        size: null,
        motion: { ...this.#motion },
      };
    }
    const [x, y] = window.getPosition();
    const [width, height] = window.getSize();
    return {
      status: this.#paused ? "paused" : "running",
      animation: this.#animation,
      direction: this.#direction,
      position: { x, y },
      size: { width, height },
      motion: { ...this.#motion },
    };
  }

  dispose(): void {
    this.stopPet();
    const studio = this.studioWindow;
    this.#studioWindow = null;
    if (studio && !studio.isDestroyed()) studio.destroy();
  }

  #setPetPosition(position: Point): void {
    const window = this.#petWindow;
    if (!window || window.isDestroyed()) return;
    const [width, height] = window.getSize();
    const bounded = boundedPosition(position, { width, height });
    this.#precisePosition = bounded;
    window.setPosition(bounded.x, bounded.y, false);
  }

  #startMotionTimer(): void {
    this.#stopMotionTimer();
    this.#lastMotionTime = performance.now();
    this.#motionTimer = setInterval(() => this.#motionTick(), MOTION_INTERVAL_MS);
  }

  #stopMotionTimer(): void {
    if (this.#motionTimer) clearInterval(this.#motionTimer);
    this.#motionTimer = null;
  }

  #motionTick(): void {
    const window = this.#petWindow;
    if (!window || window.isDestroyed()) {
      this.#stopMotionTimer();
      return;
    }
    const now = performance.now();
    const deltaSeconds = Math.min((now - this.#lastMotionTime) / 1_000, 0.1);
    this.#lastMotionTime = now;
    if (this.#paused || (this.#motion.velocityX === 0 && this.#motion.velocityY === 0)) return;

    const [currentX, currentY] = window.getPosition();
    const [width, height] = window.getSize();
    const precise = this.#precisePosition ?? { x: currentX, y: currentY };
    let x = precise.x + this.#motion.velocityX * deltaSeconds;
    let y = precise.y + this.#motion.velocityY * deltaSeconds;
    const display = screen.getDisplayMatching({ x: currentX, y: currentY, width, height });
    const area: Rectangle = display.workArea;
    const minX = area.x;
    const maxX = area.x + Math.max(0, area.width - width);
    const minY = area.y;
    const maxY = area.y + Math.max(0, area.height - height);
    let directionChanged = false;

    if (this.#motion.bounce && (x < minX || x > maxX)) {
      x = clamp(x, minX, maxX);
      this.#motion.velocityX *= -1;
      const nextDirection: PetDirection = this.#motion.velocityX < 0 ? "left" : "right";
      directionChanged = nextDirection !== this.#direction;
      this.#direction = nextDirection;
    } else {
      x = clamp(x, minX, maxX);
    }
    if (this.#motion.bounce && (y < minY || y > maxY)) {
      y = clamp(y, minY, maxY);
      this.#motion.velocityY *= -1;
    } else {
      y = clamp(y, minY, maxY);
    }

    this.#precisePosition = { x, y };
    window.setPosition(Math.round(x), Math.round(y), false);
    if (directionChanged) {
      this.#sendPetCommand({ type: "direction", direction: this.#direction });
    }
    this.#broadcastState(false);
  }

  #sendPetCommand(command: PetRenderCommand): void {
    const window = this.#petWindow;
    if (window && !window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.petRenderCommand, command);
    }
  }

  #broadcastState(force: boolean): void {
    const now = performance.now();
    if (!force && now - this.#lastStateBroadcast < STATE_BROADCAST_INTERVAL_MS) return;
    this.#lastStateBroadcast = now;
    const state = this.getPetState();
    for (const window of [this.studioWindow, this.#petWindow]) {
      if (window && !window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.petStateChanged, state);
      }
    }
  }
}
