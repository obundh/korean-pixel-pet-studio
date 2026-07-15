import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(
  await readFile(resolve(root, "reference-kits", "assets.pose-references.json"), "utf8")
);

const C = {
  fill: "#D6DCE4",
  shade: "#A9B3C0",
  outline: "#4C5667",
  joint: "#667184",
  accent: "#FF806F",
  guide: "#4EC9C1"
};

const wrap = (body) => `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <g stroke="${C.outline}" stroke-width="8" stroke-linejoin="round" stroke-linecap="round">
    ${body}
  </g>
</svg>`;

const joint = (x, y, active = false) =>
  `<circle cx="${x}" cy="${y}" r="9" fill="${active ? C.accent : C.joint}" stroke="none"/>`;

function idle(frame) {
  const lifts = [0, -8, -16, -8];
  const widths = [124, 128, 132, 127];
  const lift = lifts[frame];
  const width = widths[frame];
  const x = 256 - width / 2;
  return wrap(`
    <ellipse cx="256" cy="${135 + lift}" rx="52" ry="50" fill="${C.fill}"/>
    <rect x="${x}" y="${188 + lift}" width="${width}" height="176" rx="58" fill="${C.fill}"/>
    <path d="M ${x + 8} ${225 + lift} Q ${x - 38} ${275 + lift} ${x - 12} ${330 + lift}" fill="none" stroke="${C.shade}" stroke-width="34"/>
    <path d="M ${x + width - 8} ${225 + lift} Q ${x + width + 38} ${275 + lift} ${x + width + 12} ${330 + lift}" fill="none" stroke="${C.shade}" stroke-width="34"/>
    <rect x="196" y="350" width="50" height="96" rx="20" fill="${C.shade}"/>
    <rect x="266" y="350" width="50" height="96" rx="20" fill="${C.shade}"/>
    ${joint(x + 8, 225 + lift)}${joint(x + width - 8, 225 + lift)}
    ${joint(221, 350)}${joint(291, 350)}
  `);
}

function biped(frame, jump = false) {
  if (jump) return jumping(frame);
  const a = (frame / 8) * Math.PI * 2;
  const lift = frame === 3 || frame === 7 ? -8 : frame === 1 || frame === 5 ? 6 : 0;
  const leftSwing = Math.sin(a);
  const rightSwing = -leftSwing;
  const foot = (side, swing) => {
    const hipX = side === "left" ? 228 : 278;
    const footX = hipX + swing * 54;
    const footY = 438 - Math.max(0, -swing) * 28;
    const kneeX = hipX + swing * 26 + (side === "left" ? -8 : 8);
    const kneeY = 372 + Math.abs(swing) * 8 + lift;
    return `
      <path d="M ${hipX} ${318 + lift} L ${kneeX} ${kneeY} L ${footX} ${footY}" fill="none" stroke="${C.shade}" stroke-width="30"/>
      <path d="M ${footX - 12} ${footY} L ${footX + 22} ${footY}" fill="none" stroke="${C.fill}" stroke-width="22"/>
      ${joint(hipX, 318 + lift)}${joint(kneeX, kneeY, Math.abs(swing) > 0.65)}
    `;
  };
  const leftHandX = 196 - leftSwing * 40;
  const rightHandX = 316 - rightSwing * 40;
  return wrap(`
    <ellipse cx="256" cy="${120 + lift}" rx="48" ry="46" fill="${C.fill}"/>
    <rect x="198" y="${170 + lift}" width="116" height="154" rx="48" fill="${C.fill}"/>
    <path d="M 210 ${205 + lift} L ${leftHandX} ${290 + lift}" fill="none" stroke="${C.shade}" stroke-width="28"/>
    <path d="M 302 ${205 + lift} L ${rightHandX} ${290 + lift}" fill="none" stroke="${C.shade}" stroke-width="28"/>
    ${joint(210, 205 + lift)}${joint(302, 205 + lift)}
    ${foot("left", leftSwing)}${foot("right", rightSwing)}
  `);
}

function jumping(frame) {
  const lift = [0, -18, -88, -112, -56, 0][frame];
  const crouch = frame === 0 || frame === 5;
  const tucked = frame === 3;
  const stretch = frame === 1 || frame === 2;
  const torsoY = 178 + lift + (crouch ? 18 : 0);
  const torsoH = crouch ? 126 : stretch ? 166 : 148;
  const hipY = torsoY + torsoH - 8;
  const footY = frame === 0 || frame === 5 ? 442 : hipY + (tucked ? 76 : stretch ? 122 : 110);
  const kneeY = hipY + (tucked ? 38 : crouch ? 54 : 62);
  const spread = tucked ? 48 : crouch ? 58 : 28;
  const armLift = frame >= 1 && frame <= 4 ? -55 : 0;
  return wrap(`
    <ellipse cx="256" cy="${126 + lift}" rx="48" ry="46" fill="${C.fill}"/>
    <rect x="198" y="${torsoY}" width="116" height="${torsoH}" rx="48" fill="${C.fill}"/>
    <path d="M 210 ${torsoY + 36} Q 166 ${torsoY + 74 + armLift} 174 ${torsoY + 122 + armLift}" fill="none" stroke="${C.shade}" stroke-width="28"/>
    <path d="M 302 ${torsoY + 36} Q 346 ${torsoY + 74 + armLift} 338 ${torsoY + 122 + armLift}" fill="none" stroke="${C.shade}" stroke-width="28"/>
    <path d="M 226 ${hipY} L ${256 - spread} ${kneeY} L ${tucked ? 218 : 220} ${footY}" fill="none" stroke="${C.shade}" stroke-width="30"/>
    <path d="M 286 ${hipY} L ${256 + spread} ${kneeY} L ${tucked ? 294 : 292} ${footY}" fill="none" stroke="${C.shade}" stroke-width="30"/>
    <path d="M ${tucked ? 204 : 208} ${footY} L ${tucked ? 232 : 240} ${footY}" fill="none" stroke="${C.fill}" stroke-width="22"/>
    <path d="M ${tucked ? 280 : 278} ${footY} L ${tucked ? 308 : 310} ${footY}" fill="none" stroke="${C.fill}" stroke-width="22"/>
    ${joint(210, torsoY + 36)}${joint(302, torsoY + 36)}${joint(226, hipY)}${joint(286, hipY)}
    ${joint(256 - spread, kneeY, crouch || tucked)}${joint(256 + spread, kneeY, crouch || tucked)}
  `);
}

function sleeping(frame) {
  const inhale = frame === 2;
  const settle = frame === 0;
  const y = inhale ? -7 : frame === 3 ? 3 : 0;
  const headY = settle ? 330 : 356;
  return wrap(`
    <rect x="170" y="${304 + y}" width="226" height="116" rx="56" fill="${C.fill}"/>
    <ellipse cx="150" cy="${headY + y}" rx="68" ry="54" fill="${C.fill}" transform="rotate(-8 150 ${headY + y})"/>
    <path d="M 178 ${376 + y} Q 138 ${402 + y} 104 ${420 + y}" fill="none" stroke="${C.shade}" stroke-width="30"/>
    <path d="M 226 ${388 + y} L 216 ${432 + y}" stroke="${C.shade}" stroke-width="34"/>
    <path d="M 286 ${392 + y} L 282 ${432 + y}" stroke="${C.shade}" stroke-width="34"/>
    <path d="M 344 ${382 + y} L 356 ${430 + y}" stroke="${C.shade}" stroke-width="34"/>
    <path d="M 392 ${350 + y} Q 452 ${328 + y} 430 ${394 + y}" fill="none" stroke="${C.guide}" stroke-width="25"/>
    ${joint(206, 382 + y)}${joint(286, 388 + y)}${joint(352, 378 + y)}
  `);
}

function happy(frame) {
  const lift = [0, -8, 0, -40, -16, 0][frame];
  const scaleY = [1, 1, 0.88, 1.14, 1.05, 0.96][frame];
  const scaleX = [1, 1, 1.08, 0.94, 0.98, 1.03][frame];
  const bodyW = 244 * scaleX;
  const bodyH = 132 * scaleY;
  const bodyX = 256 - bodyW / 2;
  const bodyY = 288 + lift + (132 - bodyH);
  const airborne = frame === 3 || frame === 4;
  const legTop = bodyY + bodyH - 12;
  const footY = airborne ? legTop + 58 : 442;
  const paddleWide = frame === 3 ? 70 : frame === 1 ? 52 : 34;
  return wrap(`
    <ellipse cx="256" cy="${bodyY + bodyH / 2}" rx="${bodyW / 2}" ry="${bodyH / 2}" fill="${C.fill}"/>
    <path d="M ${bodyX + 28} ${bodyY + 48} Q ${bodyX - paddleWide} ${bodyY + 20} ${bodyX - 18} ${bodyY + 94}" fill="none" stroke="${C.shade}" stroke-width="30"/>
    <path d="M ${bodyX + bodyW - 28} ${bodyY + 48} Q ${bodyX + bodyW + paddleWide} ${bodyY + 20} ${bodyX + bodyW + 18} ${bodyY + 94}" fill="none" stroke="${C.shade}" stroke-width="30"/>
    ${[195, 235, 277, 317].map((x, i) => `<path d="M ${x} ${legTop} L ${x + (i < 2 ? -5 : 5)} ${footY}" stroke="${C.shade}" stroke-width="28"/>`).join("")}
    ${joint(bodyX + 28, bodyY + 48, frame === 1 || frame === 3)}
    ${joint(bodyX + bodyW - 28, bodyY + 48, frame === 1 || frame === 3)}
  `);
}

function render(animationId, frame) {
  if (animationId === "idle-breathe-4") return idle(frame);
  if (animationId === "walk-cycle-8") return biped(frame);
  if (animationId === "jump-arc-6") return biped(frame, true);
  if (animationId === "sleep-loop-4") return sleeping(frame);
  if (animationId === "happy-reaction-6") return happy(frame);
  throw new Error(`Unknown animation ${animationId}`);
}

for (const asset of manifest.assets) {
  const target = resolve(root, "reference-kits", asset.filename);
  await mkdir(dirname(target), { recursive: true });
  await sharp(Buffer.from(render(asset.animationId, asset.frameIndex)))
    .png()
    .toFile(target);
}

console.log(`Generated ${manifest.assets.length} deterministic pose-reference PNGs.`);
