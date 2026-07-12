import assert from "node:assert/strict";
import test from "node:test";
import { errorFromResponse, request } from "../src/infra/http-client.mjs";

function withFetchMock(handler, callback) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;
  return Promise.resolve()
    .then(callback)
    .finally(() => {
      globalThis.fetch = originalFetch;
    });
}

test("HTTP 错误保留状态码和 Retry-After 冷却时间", async () => {
  const error = await errorFromResponse(new Response("rate limited", {
    status: 429,
    statusText: "Too Many Requests",
    headers: { "retry-after": "2" },
  }));

  assert.equal(error.code, "HTTP_429");
  assert.equal(error.status, 429);
  assert.equal(error.retryAfterMs, 2000);
  assert.match(error.message, /rate limited/);
});

test("请求超时会映射为 TIMEOUT 错误", { concurrency: false }, async () => {
  await withFetchMock((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    });
  }), async () => {
    await assert.rejects(
      () => request("https://relay.example/slow", {}, 1),
      (error) => error.code === "TIMEOUT" && /请求超时/.test(error.message),
    );
  });
});

test("网络异常会映射为 NETWORK_ERROR", { concurrency: false }, async () => {
  await withFetchMock(async () => {
    throw new Error("socket closed");
  }, async () => {
    await assert.rejects(
      () => request("https://relay.example/down", {}, 100),
      (error) => error.code === "NETWORK_ERROR" && /socket closed/.test(error.message),
    );
  });
});
