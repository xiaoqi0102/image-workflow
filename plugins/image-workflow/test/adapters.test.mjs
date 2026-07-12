import assert from "node:assert/strict";
import test from "node:test";
import { fhlResponsesAdapter, buildResponsesBody, extractImages } from "../src/adapters/fhl-responses.mjs";
import { buildPayload, openaiImagesAdapter } from "../src/adapters/openai-images.mjs";

function withFetchMock(handler, callback) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;
  return Promise.resolve()
    .then(callback)
    .finally(() => {
      globalThis.fetch = originalFetch;
    });
}

function imageTask(overrides = {}) {
  return {
    operation: "generate",
    prompt: "测试图像",
    model: "gpt-image-2",
    n: 1,
    size: "1024x1024",
    quality: "medium",
    outputFormat: "png",
    ...overrides,
  };
}

const profile = { id: "relay", adapter: "openai-images", baseUrl: "https://relay.example/v1", defaults: {} };
const worker = { id: "main", name: "主 Worker", apiKey: "test-key" };

test("OpenAI Images 请求体映射标准生成参数", () => {
  assert.deepEqual(buildPayload(imageTask({ background: "transparent", moderation: "low", outputCompression: 90 })), {
    model: "gpt-image-2",
    prompt: "测试图像",
    n: 1,
    size: "1024x1024",
    quality: "medium",
    output_format: "png",
    background: "transparent",
    moderation: "low",
    output_compression: 90,
  });
});

test("OpenAI Images 适配器发送 JSON 并保存 Base64 响应", { concurrency: false }, async () => {
  await withFetchMock(async (url, init) => {
    assert.equal(url, "https://relay.example/v1/images/generations");
    assert.equal(init.headers.Authorization, "Bearer test-key");
    assert.equal(init.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(init.body), buildPayload(imageTask()));
    return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("image-bytes").toString("base64") }] }), {
      headers: { "content-type": "application/json" },
    });
  }, async () => {
    const result = await openaiImagesAdapter.execute({ profile, worker, task: imageTask() });
    assert.equal(result.ok, true);
    assert.deepEqual(result.images[0].buffer, Buffer.from("image-bytes"));
    assert.equal(result.images[0].format, "png");
  });
});

test("OpenAI Images 编辑使用 multipart、多参考图和 mask", { concurrency: false }, async () => {
  await withFetchMock(async (url, init) => {
    assert.equal(url, "https://relay.example/v1/images/edits");
    assert.equal(init.headers.Authorization, "Bearer test-key");
    assert.equal(Object.hasOwn(init.headers, "Content-Type"), false);
    assert.ok(init.body instanceof FormData);
    assert.equal(init.body.getAll("image[]").length, 2);
    assert.equal(init.body.get("mask").name, "mask.png");
    assert.equal(init.body.get("input_fidelity"), "high");
    return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("edited").toString("base64") }] }), {
      headers: { "content-type": "application/json" },
    });
  }, async () => {
    const task = imageTask({
      operation: "edit",
      inputFidelity: "high",
      sources: [
        { path: "/tmp/first.png", buffer: Buffer.from("first"), mimeType: "image/png" },
        { path: "/tmp/second.jpg", buffer: Buffer.from("second"), mimeType: "image/jpeg" },
      ],
      mask: { path: "/tmp/mask.png", buffer: Buffer.from("mask"), mimeType: "image/png" },
    });
    const result = await openaiImagesAdapter.execute({ profile, worker, task });
    assert.deepEqual(result.images[0].buffer, Buffer.from("edited"));
  });
});

test("OpenAI Images 适配器下载 URL 响应", { concurrency: false }, async () => {
  const calls = [];
  await withFetchMock(async (url) => {
    calls.push(url);
    if (url === "https://relay.example/v1/images/generations") {
      return new Response(JSON.stringify({ data: [{ url: "https://cdn.example/result.webp" }] }), {
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(Buffer.from("url-image"), { headers: { "content-type": "image/webp" } });
  }, async () => {
    const result = await openaiImagesAdapter.execute({ profile, worker, task: imageTask() });
    assert.deepEqual(calls, ["https://relay.example/v1/images/generations", "https://cdn.example/result.webp"]);
    assert.deepEqual(result.images[0], { buffer: Buffer.from("url-image"), contentType: "image/webp" });
  });
});

test("Responses 请求体保留输入图顺序并解析 SSE 结果", () => {
  const task = imageTask({
    operation: "edit",
    sources: [
      { dataUrl: "data:image/png;base64,Zmlyc3Q=" },
      { dataUrl: "data:image/png;base64,c2Vjb25k" },
    ],
  });
  const body = buildResponsesBody({ defaults: { textModel: "gpt-5.5" } }, task);
  assert.equal(body.model, "gpt-5.5");
  assert.equal(body.tools[0].action, "edit");
  assert.equal(body.tools[0].model, "gpt-image-2");
  assert.deepEqual(body.input[0].content.map((item) => item.type), ["input_text", "input_image", "input_image"]);
  assert.deepEqual(extractImages('data: {"type":"response.output_item.done","item":{"type":"image_generation_call","result":"aGVsbG8="}}\n\ndata: [DONE]'), ["aGVsbG8="]);
  assert.deepEqual(extractImages(JSON.stringify({ output: [{ type: "image_generation_call", result: "d29ybGQ=" }] })), ["d29ybGQ="]);
});

test("FHL 兼容 Profile 始终把图像模型写入工具字段", () => {
  const body = buildResponsesBody({ defaults: { textModel: "relay-main", useToolModel: true } }, imageTask({ model: "relay-image" }));
  assert.equal(body.model, "relay-main");
  assert.equal(body.tools[0].model, "relay-image");
});

test("Responses 适配器发送流式请求并从 SSE 返回图片", { concurrency: false }, async () => {
  await withFetchMock(async (url, init) => {
    assert.equal(url, "https://fhl.example/v1/responses");
    assert.equal(init.headers.Accept, "text/event-stream, application/json");
    assert.equal(JSON.parse(init.body).stream, true);
    return new Response('data: {"type":"image_generation.completed","b64_json":"c3RyZWFtLWltYWdl"}\n\n', {
      headers: { "content-type": "text/event-stream" },
    });
  }, async () => {
    const result = await fhlResponsesAdapter.execute({
      profile: { id: "fhl", adapter: "fhl-responses", baseUrl: "https://fhl.example/v1", defaults: {} },
      worker,
      task: imageTask(),
    });
    assert.deepEqual(result.images[0].buffer, Buffer.from("stream-image"));
  });
});
