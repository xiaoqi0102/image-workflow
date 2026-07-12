import { existsSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { ensureDirectory, timestamp } from "../util/fs.mjs";
import { imageExtensionFromMimeType } from "../util/images.mjs";
import { ImageWorkflowError } from "../util/errors.mjs";

export function resolveOutputDirectory(directory) {
  return ensureDirectory(resolve(directory || join(process.cwd(), "output", "image-workflow")));
}

export function buildRunDirectory(baseDirectory, prefix = "run") {
  return resolveOutputDirectory(join(baseDirectory, `${prefix}_${timestamp()}`));
}

export function outputPath({ out, outDir, index, total, format, prefix = "image" }) {
  if (out && outDir) throw new ImageWorkflowError("--out 与 --out-dir 不能同时使用。", "INVALID_ARGUMENT");
  if (out && total === 1) {
    const path = resolve(out);
    return extname(path) ? path : `${path}.${format}`;
  }
  const directory = resolveOutputDirectory(outDir || (out ? dirname(resolve(out)) : join(process.cwd(), "output", "image-workflow")));
  const base = out ? resolve(out) : join(directory, `${prefix}.${format}`);
  if (total === 1) return extname(base) ? base : `${base}.${format}`;
  const extension = extname(base) || `.${format}`;
  const stem = extname(base) ? base.slice(0, -extension.length) : base;
  return `${stem}-${index + 1}${extension}`;
}

export function writeImage(path, image, force = false) {
  if (existsSync(path) && !force) throw new ImageWorkflowError(`输出文件已存在: ${path}；使用 --force 覆盖。`, "OUTPUT_EXISTS");
  ensureDirectory(dirname(path));
  writeFileSync(path, image.buffer);
  return path;
}

export function suggestedExtension(image, fallback = "png") {
  if (image.format) return image.format === "jpg" ? "jpeg" : image.format;
  return imageExtensionFromMimeType(image.contentType?.split(";")[0] || "") || fallback;
}
