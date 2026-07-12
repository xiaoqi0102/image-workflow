import assert from "node:assert/strict";
import test from "node:test";
import { configDirectory, configPath } from "../src/config/paths.mjs";
import { normalizeProfile, publicProfile, validateProfile } from "../src/config/profile-store.mjs";
import { compareNaturalNames, csvCell, sanitizePathSegment } from "../src/util/fs.mjs";
import { decodeBase64Image, imageExtensionFromMimeType, normalizeOutputFormat } from "../src/util/images.mjs";
import { outputPath } from "../src/infra/output-store.mjs";

test("图像格式工具规范化输出格式并解码 Base64", () => {
  assert.equal(normalizeOutputFormat("JPG"), "jpeg");
  assert.equal(normalizeOutputFormat("webp"), "webp");
  assert.throws(() => normalizeOutputFormat("avif"), /output-format/);
  assert.deepEqual(decodeBase64Image("data:image/png;base64,aGVsbG8="), Buffer.from("hello"));
  assert.equal(decodeBase64Image(""), null);
  assert.equal(imageExtensionFromMimeType("image/jpeg"), "jpg");
});

test("文件工具保留自然排序、CSV 转义和安全路径片段", () => {
  assert.ok(compareNaturalNames("item2.png", "item10.png") < 0);
  assert.equal(csvCell('a,"b"'), '"a,""b"""');
  assert.equal(sanitizePathSegment(' catalog: 01?.png '), "catalog_ 01_.png");
  assert.equal(sanitizePathSegment("..."), "item");
});

test("Profile 归一化并隐藏 Worker API Key", () => {
  const profile = normalizeProfile({
    id: " relay ",
    adapter: "openai-images",
    baseUrl: "https://relay.example/v1///",
    defaults: { quality: "high" },
    workers: [{ id: "main", name: "主 Worker", apiKey: "secret-key" }],
  });

  validateProfile(profile);
  assert.equal(profile.id, "relay");
  assert.equal(profile.baseUrl, "https://relay.example/v1");
  assert.equal(profile.defaults.model, "gpt-image-2");
  assert.equal(profile.defaults.quality, "high");
  assert.deepEqual(publicProfile(profile).workers, [{ id: "main", name: "主 Worker", enabled: true, hasKey: true }]);
  assert.equal(JSON.stringify(publicProfile(profile)).includes("secret-key"), false);
});

test("Profile 验证拒绝未知适配器和超过上限的 Worker", () => {
  const invalidAdapter = normalizeProfile({ id: "bad", adapter: "unknown", baseUrl: "https://example.com", workers: [] });
  assert.throws(() => validateProfile(invalidAdapter), /adapter/);

  const tooManyWorkers = normalizeProfile({
    id: "too-many",
    adapter: "openai-images",
    baseUrl: "https://example.com",
    workers: Array.from({ length: 11 }, (_, index) => ({ id: `worker-${index}`, apiKey: "key" })),
  });
  assert.throws(() => validateProfile(tooManyWorkers), /最多配置 10 个 Worker/);
});

test("测试环境可通过环境变量隔离配置目录", () => {
  const previous = process.env.IMAGE_WORKFLOW_CONFIG_DIR;
  process.env.IMAGE_WORKFLOW_CONFIG_DIR = "C:/temp/image-workflow-config";
  try {
    assert.match(configDirectory(), /image-workflow-config$/);
    assert.match(configPath(), /image-workflow-config[\\/]config\.json$/);
  } finally {
    if (previous == null) delete process.env.IMAGE_WORKFLOW_CONFIG_DIR;
    else process.env.IMAGE_WORKFLOW_CONFIG_DIR = previous;
  }
});

test("单图 out 自动补齐扩展名并拒绝与 out-dir 混用", () => {
  assert.match(outputPath({ out: "result", format: "png", total: 1, index: 0 }), /result\.png$/);
  assert.match(outputPath({ out: "result.webp", format: "png", total: 1, index: 0 }), /result\.webp$/);
  assert.throws(() => outputPath({ out: "result.png", outDir: "output", format: "png", total: 1, index: 0 }), /不能同时使用/);
});
