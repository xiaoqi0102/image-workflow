import { basename } from "node:path";
import { downloadImage, errorFromResponse, request } from "../infra/http-client.mjs";
import { decodeBase64Image, imageMimeType, normalizeOutputFormat } from "../util/images.mjs";
import { ImageWorkflowError } from "../util/errors.mjs";

export const openaiImagesAdapter = {
  id: "openai-images",
  capabilities: { generate: true, edit: true, mask: true, multiReference: true },
  async execute({ profile, worker, task, signal }) {
    const baseUrl = profile.baseUrl.replace(/\/+$/, "");
    const timeoutMs = task.timeoutMs ?? profile.defaults.timeoutMs ?? 300000;
    const endpoint = task.operation === "edit" ? "/images/edits" : "/images/generations";
    const headers = { Authorization: `Bearer ${worker.apiKey}` };
    let body;
    if (task.operation === "edit") {
      body = new FormData();
      for (const [key, value] of Object.entries(buildPayload(task))) {
        if (value != null) body.append(key, String(value));
      }
      for (const source of task.sources) body.append("image[]", new Blob([source.buffer], { type: source.mimeType }), basename(source.path));
      if (task.mask) body.append("mask", new Blob([task.mask.buffer], { type: task.mask.mimeType }), basename(task.mask.path));
    } else {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(buildPayload(task));
    }
    const response = await request(`${baseUrl}${endpoint}`, { method: "POST", headers, body, signal }, timeoutMs);
    if (!response.ok) throw await errorFromResponse(response);
    const payload = await response.json();
    if (!Array.isArray(payload?.data) || payload.data.length === 0) throw new ImageWorkflowError("Images API 响应缺少 data 数组。", "INVALID_RESPONSE");
    const images = [];
    for (const item of payload.data) {
      if (item.b64_json) {
        const buffer = decodeBase64Image(item.b64_json);
        if (buffer) images.push({ buffer, format: task.outputFormat });
        continue;
      }
      if (item.url) {
        const downloaded = await downloadImage(item.url, timeoutMs);
        images.push({ buffer: downloaded.buffer, contentType: downloaded.contentType });
        continue;
      }
      throw new ImageWorkflowError("Images API 响应项目既没有 b64_json 也没有 url。", "INVALID_RESPONSE");
    }
    return { ok: true, images };
  },
};

export function buildPayload(task) {
  const payload = {
    model: task.model,
    prompt: task.prompt,
    n: Number(task.n || 1),
    size: task.size || "auto",
    quality: task.quality || "medium",
    output_format: normalizeOutputFormat(task.outputFormat),
  };
  if (task.background) payload.background = task.background;
  if (task.moderation) payload.moderation = task.moderation;
  if (task.outputCompression != null) payload.output_compression = Number(task.outputCompression);
  if (task.operation === "edit" && task.inputFidelity) payload.input_fidelity = task.inputFidelity;
  return payload;
}
