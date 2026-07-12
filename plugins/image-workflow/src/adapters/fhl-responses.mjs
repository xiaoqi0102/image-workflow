import { errorFromResponse, request } from "../infra/http-client.mjs";
import { decodeBase64Image, normalizeOutputFormat } from "../util/images.mjs";
import { ImageWorkflowError } from "../util/errors.mjs";

export const fhlResponsesAdapter = {
  id: "fhl-responses",
  capabilities: { generate: true, edit: true, mask: false, multiReference: true },
  async execute({ profile, worker, task, signal }) {
    if (task.mask) throw new ImageWorkflowError("FHL Responses Profile 不支持 mask 编辑。", "UNSUPPORTED_CAPABILITY");
    const timeoutMs = task.timeoutMs ?? profile.defaults.timeoutMs ?? 180000;
    const response = await request(`${profile.baseUrl.replace(/\/+$/, "")}/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream, application/json", Authorization: `Bearer ${worker.apiKey}` },
      body: JSON.stringify(buildResponsesBody(profile, task)),
      signal,
    }, timeoutMs);
    if (!response.ok) throw await errorFromResponse(response);
    const images = extractImages(await response.text()).map((base64) => ({ buffer: decodeBase64Image(base64), format: task.outputFormat }));
    if (images.length === 0 || images.some((image) => !image.buffer)) throw new ImageWorkflowError("Responses 流中未找到图片结果。", "INVALID_RESPONSE");
    return { ok: true, images };
  },
};

export function buildResponsesBody(profile, task) {
  const sources = task.operation === "edit" ? task.sources : [];
  const content = [{ type: "input_text", text: task.prompt }];
  for (const source of sources) content.push({ type: "input_image", image_url: source.dataUrl });
  const tool = {
    type: "image_generation",
    model: task.model,
    action: task.operation === "edit" ? "edit" : "generate",
    size: task.size,
    quality: task.quality || "auto",
    output_format: normalizeOutputFormat(task.outputFormat),
    moderation: task.moderation || "low",
    partial_images: 0,
  };
  return {
    model: profile.defaults.textModel || profile.defaults.model || "gpt-5.5",
    input: [{ role: "user", content }],
    tools: [tool],
    tool_choice: { type: "image_generation" },
    reasoning: { effort: "xhigh" },
    store: false,
    stream: true,
  };
}

export function extractImages(raw) {
  const images = [];
  for (const line of String(raw || "").split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    try {
      const event = JSON.parse(line.slice(5).trim());
      if (event?.type === "response.output_item.done" && event?.item?.type === "image_generation_call" && event.item.result) images.push(event.item.result);
      else if (event?.type === "image_generation.completed" && event.b64_json) images.push(event.b64_json);
      else if (event?.result && typeof event.result === "string") images.push(event.result);
    } catch {
      // 忽略非 JSON SSE 行，例如 [DONE]。
    }
  }
  if (images.length > 0) return images;
  try {
    const parsed = JSON.parse(raw);
    const candidate = parsed?.output?.find?.((item) => item?.type === "image_generation_call")?.result || parsed?.result;
    return candidate ? [candidate] : [];
  } catch {
    return [];
  }
}
