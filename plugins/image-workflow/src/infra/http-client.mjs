import { ImageWorkflowError } from "../util/errors.mjs";

export async function request(url, init = {}, timeoutMs = 300000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") throw new ImageWorkflowError(`请求超时 (${Math.round(timeoutMs / 1000)} 秒)。`, "TIMEOUT");
    throw new ImageWorkflowError(error?.message || "网络请求失败。", "NETWORK_ERROR", { cause: error });
  } finally {
    clearTimeout(timer);
  }
}

export async function errorFromResponse(response) {
  const text = await response.text().catch(() => "");
  const retryAfterSeconds = Number(response.headers.get("retry-after"));
  const retryAfterMs = Number.isFinite(retryAfterSeconds) ? retryAfterSeconds * 1000 : null;
  return new ImageWorkflowError(`HTTP ${response.status}: ${text || response.statusText}`, `HTTP_${response.status}`, { status: response.status, retryAfterMs });
}

export async function downloadImage(url, timeoutMs) {
  const response = await request(url, { redirect: "follow" }, timeoutMs);
  if (!response.ok) throw await errorFromResponse(response);
  const contentType = response.headers.get("content-type") || "image/png";
  return { buffer: Buffer.from(await response.arrayBuffer()), contentType };
}
