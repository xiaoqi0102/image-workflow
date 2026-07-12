import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";

export function imageMimeType(path) {
  switch (extname(path).toLowerCase()) {
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    case ".gif": return "image/gif";
    default: return "image/png";
  }
}

export function imageExtensionFromMimeType(mimeType) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  return "png";
}

export function loadImage(path) {
  const buffer = readFileSync(path);
  const mimeType = imageMimeType(path);
  return { path, name: basename(path), buffer, mimeType, dataUrl: `data:${mimeType};base64,${buffer.toString("base64")}` };
}

export function decodeBase64Image(value) {
  const normalized = String(value || "").replace(/^data:image\/[^;]+;base64,/i, "").replace(/\s/g, "");
  if (!normalized) return null;
  return Buffer.from(normalized, "base64");
}

export function normalizeOutputFormat(value) {
  const format = String(value || "png").toLowerCase();
  if (!new Set(["png", "jpeg", "jpg", "webp"]).has(format)) throw new Error("output-format 必须是 png、jpeg、jpg 或 webp。");
  return format === "jpg" ? "jpeg" : format;
}
