import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const source = resolve(root, "reference-kits");
const destination = resolve(root, "public", "reference-kits");

await mkdir(resolve(root, "public"), { recursive: true });
await rm(destination, { recursive: true, force: true });
await cp(source, destination, {
  recursive: true,
  filter: (path) => !path.endsWith(".md")
});

console.log("Reference kits synced to public/reference-kits");
