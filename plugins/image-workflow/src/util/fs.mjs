import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";

export const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

export function ensureDirectory(path) {
  mkdirSync(path, { recursive: true });
  return path;
}

export function writeJsonAtomic(path, value) {
  writeTextAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeTextAtomic(path, content) {
  ensureDirectory(dirname(path));
  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, content, "utf8");
  if (existsSync(path)) unlinkSync(path);
  renameSync(temporaryPath, path);
}

export function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

export function timestamp() {
  const now = new Date();
  const compact = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "");
  return compact;
}

export function sanitizePathSegment(value) {
  const cleaned = String(value || "")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim();
  return cleaned || "item";
}

export function fileStem(path) {
  return basename(path, extname(path));
}

export function compareNaturalNames(left, right) {
  return String(left).localeCompare(String(right), "zh-Hans-CN", { numeric: true, sensitivity: "base" });
}

export function listImageFiles(directory) {
  const absoluteDirectory = resolve(directory);
  if (!existsSync(absoluteDirectory)) throw new Error(`图片目录不存在: ${absoluteDirectory}`);
  return readdirSync(absoluteDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase()))
    .map((entry) => ({ name: entry.name, path: join(absoluteDirectory, entry.name) }))
    .sort((left, right) => compareNaturalNames(left.name, right.name));
}

export function csvCell(value) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
