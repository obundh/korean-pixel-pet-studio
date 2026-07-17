import { mkdir } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const outputDir = path.join(root, "reference-kits", "images", "styles");

const styles = [
  {
    id: "soft-cluster-16",
    size: 64,
    colors: ["#663f55", "#e8796f", "#ffd6a5", "#5aa6a6"],
    outline: 2,
    accent: "#ffd6a5",
    dither: false,
  },
  {
    id: "bold-outline-32",
    size: 64,
    colors: ["#241638", "#69418c", "#a46fd1", "#f2bf5b"],
    outline: 4,
    accent: "#f2bf5b",
    dither: false,
  },
  {
    id: "pastel-dither-48",
    size: 96,
    colors: ["#76556f", "#f09a9a", "#c9f2df", "#fff0bd"],
    outline: 2,
    accent: "#c9f2df",
    dither: true,
  },
  {
    id: "neon-night-32",
    size: 64,
    colors: ["#111a4d", "#27327e", "#20d7dc", "#ffe75c"],
    outline: 2,
    accent: "#20d7dc",
    dither: false,
  },
  {
    id: "paper-cut-48",
    size: 96,
    colors: ["#527a42", "#f1b82d", "#ffea5c", "#f47d42"],
    outline: 0,
    accent: "#f47d42",
    dither: false,
  },
];

await mkdir(outputDir, { recursive: true });

for (const style of styles) {
  const scale = style.size / 64;
  const n = (value) => Math.round(value * scale);
  const [dark, mid, light, accent] = style.colors;
  const outline = n(style.outline);
  const outlineRect = (x, y, width, height, fill) =>
    outline
      ? `<rect x="${n(x) - outline}" y="${n(y) - outline}" width="${n(width) + outline * 2}" height="${n(height) + outline * 2}" fill="${dark}"/><rect x="${n(x)}" y="${n(y)}" width="${n(width)}" height="${n(height)}" fill="${fill}"/>`
      : `<rect x="${n(x)}" y="${n(y)}" width="${n(width)}" height="${n(height)}" fill="${fill}"/>`;
  const dither = style.dither
    ? Array.from({ length: 12 }, (_, index) => {
        const x = 10 + (index % 6) * 3;
        const y = 43 + Math.floor(index / 6) * 3;
        return `<rect x="${n(x)}" y="${n(y)}" width="${n(1)}" height="${n(1)}" fill="${index % 2 ? light : dark}"/>`;
      }).join("")
    : "";
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${style.size}" height="${style.size}" viewBox="0 0 ${style.size} ${style.size}" shape-rendering="crispEdges">
      <g>
        ${outlineRect(8, 8, 8, 8, mid)}
        ${outlineRect(22, 8, 8, 8, light)}
        ${outlineRect(36, 8, 8, 8, accent)}
        ${outlineRect(50, 8, 6, 8, dark)}

        <path d="M${n(8)} ${n(24)}H${n(24)}V${n(28)}H${n(28)}V${n(32)}H${n(24)}V${n(36)}H${n(8)}Z" fill="${dark}"/>
        <path d="M${n(10)} ${n(26)}H${n(22)}V${n(30)}H${n(25)}V${n(32)}H${n(22)}V${n(34)}H${n(10)}Z" fill="${mid}"/>
        <rect x="${n(12)}" y="${n(27)}" width="${n(8)}" height="${n(3)}" fill="${light}"/>

        <rect x="${n(34)}" y="${n(23)}" width="${n(22)}" height="${n(4)}" fill="${dark}"/>
        <rect x="${n(34)}" y="${n(30)}" width="${n(18)}" height="${n(4)}" fill="${mid}"/>
        <rect x="${n(34)}" y="${n(37)}" width="${n(14)}" height="${n(4)}" fill="${light}"/>

        <path d="M${n(8)} ${n(54)}H${n(14)}V${n(50)}H${n(20)}V${n(46)}H${n(26)}V${n(42)}H${n(30)}V${n(56)}H${n(8)}Z" fill="${accent}"/>
        ${dither}
        <rect x="${n(36)}" y="${n(48)}" width="${n(20)}" height="${n(8)}" fill="${style.accent}"/>
        <rect x="${n(40)}" y="${n(50)}" width="${n(12)}" height="${n(2)}" fill="${light}"/>
      </g>
    </svg>`;

  await sharp(Buffer.from(svg))
    .png()
    .toFile(path.join(outputDir, `${style.id}-reference.png`));
  console.log(`Style board ready: ${style.id} (${style.size}x${style.size})`);
}
