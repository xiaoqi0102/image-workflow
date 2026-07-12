import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runTasks } from "../src/domain/job-service.mjs";
import { buildWorkflowTasks, runWorkflowBatchEdit } from "../src/domain/workflow.mjs";

function createTempDirectory() {
  return mkdtempSync(join(tmpdir(), "image-workflow-test-"));
}

function profile(overrides = {}) {
  return {
    id: "mock",
    adapter: "openai-images",
    baseUrl: "https://mock.example/v1",
    defaults: { model: "gpt-image-2", size: "1024x1024", quality: "medium", n: 1, outputFormat: "png", maxRetries: 0 },
    workers: [{ id: "one", name: "Worker 1", apiKey: "test-key", enabled: true }, { id: "two", name: "Worker 2", apiKey: "test-key-2", enabled: true }],
    ...overrides,
  };
}

function withFetchMock(handler, callback) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;
  return Promise.resolve().then(callback).finally(() => { globalThis.fetch = originalFetch; });
}

test("count 个任务配合 n 会写出 count × n 个唯一文件", { concurrency: false }, async () => {
  const directory = createTempDirectory();
  try {
    await withFetchMock(async () => new Response(JSON.stringify({
      data: [
        { b64_json: Buffer.from("first").toString("base64") },
        { b64_json: Buffer.from("second").toString("base64") },
      ],
    })), async () => {
      const result = await runTasks(profile(), [
        { operation: "generate", prompt: "one", n: 2 },
        { operation: "generate", prompt: "two", n: 2 },
      ], { outDir: directory, concurrency: 2 });
      assert.equal(result.success, 2);
      assert.equal(result.paths.length, 4);
      assert.equal(new Set(result.paths).size, 4);
      assert.deepEqual(result.paths.map((path) => readFileSync(path)), [Buffer.from("first"), Buffer.from("second"), Buffer.from("first"), Buffer.from("second")]);
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("FHL Profile 拒绝 n 大于 1，提示使用 count", () => {
  assert.throws(
    () => runTasks(profile({ adapter: "fhl-responses" }), [{ operation: "generate", prompt: "one", n: 2 }]),
    /count/,
  );
});

test("工作流按自然排序规划任务，并跳过已有稳定输出", { concurrency: false }, async () => {
  const directory = createTempDirectory();
  const items = join(directory, "items");
  const output = join(directory, "output");
  const fixed = join(directory, "fixed.png");
  mkdirSync(items);
  writeFileSync(fixed, "fixed");
  writeFileSync(join(items, "item10.png"), "ten");
  writeFileSync(join(items, "item2.png"), "two");
  let calls = 0;
  try {
    const plan = buildWorkflowTasks({ fixedRefs: [fixed], itemDir: items, templateInline: ["模板"], outDir: output });
    assert.deepEqual(plan.items.map((item) => item.name), ["item2.png", "item10.png"]);
    mkdirSync(join(output, "001_item2"), { recursive: true });
    writeFileSync(join(output, "001_item2", "01_template_1.png"), "existing");
    await withFetchMock(async () => {
      calls += 1;
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("generated").toString("base64") }] }));
    }, async () => {
      const result = await runWorkflowBatchEdit(profile(), {
        fixedRefs: [fixed], itemDir: items, templateInline: ["模板"], outDir: output, repairPasses: 0, concurrency: 2,
      });
      assert.equal(result.success, 2);
      assert.equal(calls, 1);
      assert.deepEqual(readFileSync(join(output, "002_item10", "01_template_1.png")), Buffer.from("generated"));
      const manifest = JSON.parse(readFileSync(join(output, "manifest.json"), "utf8"));
      assert.equal(manifest.summary.success, 2);
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("工作流 force 会重新生成已有图片并覆盖稳定输出", { concurrency: false }, async () => {
  const directory = createTempDirectory();
  const items = join(directory, "items");
  const output = join(directory, "output");
  const fixed = join(directory, "fixed.png");
  mkdirSync(items);
  writeFileSync(fixed, "fixed");
  writeFileSync(join(items, "item.png"), "item");
  mkdirSync(join(output, "001_item"), { recursive: true });
  const outputPath = join(output, "001_item", "01_template_1.png");
  writeFileSync(outputPath, "old");
  try {
    await withFetchMock(async () => new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("new").toString("base64") }] })), async () => {
      await runWorkflowBatchEdit(profile(), {
        fixedRefs: [fixed], itemDir: items, templateInline: ["模板"], outDir: output, repairPasses: 0, force: true,
      });
      assert.deepEqual(readFileSync(outputPath), Buffer.from("new"));
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("工作流未指定 limit 时处理变量目录中的全部图片", () => {
  const directory = createTempDirectory();
  const items = join(directory, "items");
  const fixed = join(directory, "fixed.png");
  mkdirSync(items);
  writeFileSync(fixed, "fixed");
  writeFileSync(join(items, "one.png"), "one");
  writeFileSync(join(items, "two.png"), "two");
  try {
    const plan = buildWorkflowTasks({ fixedRefs: [fixed], itemDir: items, templateInline: ["a", "b"], outDir: join(directory, "output") });
    assert.equal(plan.items.length, 2);
    assert.equal(plan.tasks.length, 4);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
