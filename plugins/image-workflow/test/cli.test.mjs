import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { executeCommand } from "../src/cli/commands.mjs";
import { parseCommandLine } from "../src/cli/args.mjs";

function quietOutput() {
  return { log() {}, error() {} };
}

test("CLI generate dry-run 返回 JSON 报告而不是调用名冲突", async () => {
  const configDirectory = mkdtempSync(join(tmpdir(), "image-workflow-cli-test-"));
  const previous = process.env.IMAGE_WORKFLOW_CONFIG_DIR;
  process.env.IMAGE_WORKFLOW_CONFIG_DIR = configDirectory;
  try {
    await executeCommand(["profile", "add"], {
      id: "mock", adapter: "openai-images", "base-url": "https://mock.example/v1",
    }, quietOutput());
    await executeCommand(["worker", "add"], {
      profile: "mock", "worker-id": "main", "api-key": "test-key",
    }, quietOutput());
    const result = await executeCommand(["generate"], {
      profile: "mock", prompt: "测试", count: "2", n: "3", "dry-run": true,
    }, quietOutput());
    assert.equal(result.kind, "json");
    assert.equal(result.value.dryRun, true);
    assert.equal(result.value.total, 2);
    assert.ok(result.value.tasks.every((task) => task.n === 3));
  } finally {
    if (previous == null) delete process.env.IMAGE_WORKFLOW_CONFIG_DIR;
    else process.env.IMAGE_WORKFLOW_CONFIG_DIR = previous;
    rmSync(configDirectory, { recursive: true, force: true });
  }
});

test("CLI 拒绝未知选项和工作流不支持的参数", async () => {
  assert.throws(() => parseCommandLine(["generate", "--unexpected"]), /未知选项/);
  const configDirectory = mkdtempSync(join(tmpdir(), "image-workflow-cli-test-"));
  const previous = process.env.IMAGE_WORKFLOW_CONFIG_DIR;
  process.env.IMAGE_WORKFLOW_CONFIG_DIR = configDirectory;
  try {
    await executeCommand(["profile", "add"], {
      id: "mock", adapter: "openai-images", "base-url": "https://mock.example/v1",
    }, quietOutput());
    await assert.rejects(
      executeCommand(["workflow", "batch-edit"], { count: "2" }, quietOutput()),
      /不支持 --count/,
    );
  } finally {
    if (previous == null) delete process.env.IMAGE_WORKFLOW_CONFIG_DIR;
    else process.env.IMAGE_WORKFLOW_CONFIG_DIR = previous;
    rmSync(configDirectory, { recursive: true, force: true });
  }
});

test("CLI 在 dry-run 时也拒绝 --out 与 --out-dir 冲突", async () => {
  const configDirectory = mkdtempSync(join(tmpdir(), "image-workflow-cli-test-"));
  const previous = process.env.IMAGE_WORKFLOW_CONFIG_DIR;
  process.env.IMAGE_WORKFLOW_CONFIG_DIR = configDirectory;
  try {
    await executeCommand(["profile", "add"], {
      id: "mock", adapter: "openai-images", "base-url": "https://mock.example/v1",
    }, quietOutput());
    await executeCommand(["worker", "add"], {
      profile: "mock", "worker-id": "main", "api-key": "test-key",
    }, quietOutput());
    await assert.rejects(
      executeCommand(["generate"], {
        profile: "mock", prompt: "测试", out: "result.png", "out-dir": "output", "dry-run": true,
      }, quietOutput()),
      /不能同时使用/,
    );
  } finally {
    if (previous == null) delete process.env.IMAGE_WORKFLOW_CONFIG_DIR;
    else process.env.IMAGE_WORKFLOW_CONFIG_DIR = previous;
    rmSync(configDirectory, { recursive: true, force: true });
  }
});
