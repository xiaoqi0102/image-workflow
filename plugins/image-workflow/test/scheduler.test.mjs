import assert from "node:assert/strict";
import test from "node:test";
import { runWorkerQueue } from "../src/domain/scheduler.mjs";
import { ImageWorkflowError } from "../src/util/errors.mjs";

const workers = [
  { id: "primary", name: "主 Worker", apiKey: "key-1", enabled: true },
  { id: "backup", name: "备用 Worker", apiKey: "key-2", enabled: true },
];

test("调度器对限流任务重试并保持部分成功报告", async () => {
  let attempts = 0;
  const report = await runWorkerQueue(workers, [{ id: "rate-limited" }, { id: "normal" }], {
    concurrency: 2,
    cooldownMs: 1,
    maxRetries: 2,
    runTask: async (_worker, task) => {
      if (task.id === "rate-limited" && attempts++ === 0) {
        throw new ImageWorkflowError("限流", "HTTP_429", { status: 429, retryAfterMs: 1 });
      }
      return { ok: true, value: task.id };
    },
  });

  assert.equal(report.total, 2);
  assert.equal(report.success, 2);
  assert.equal(report.failed, 0);
  assert.equal(report.retryCount, 1);
  assert.equal(report.results.find((result) => result.value === "rate-limited").retries, 1);
  assert.ok(report.workerStats.some((item) => item.cooldowns === 1));
});

test("认证错误只隔离当前 Worker，任务会转交其他 Worker", async () => {
  const seenWorkers = [];
  const report = await runWorkerQueue(workers, [{ id: "auth" }], {
    concurrency: 1,
    maxRetries: 2,
    runTask: async (worker) => {
      seenWorkers.push(worker.id);
      if (worker.id === "primary") throw new ImageWorkflowError("无效 API Key", "HTTP_401", { status: 401 });
      return { ok: true };
    },
  });

  assert.deepEqual(seenWorkers, ["primary", "backup"]);
  assert.equal(report.success, 1);
  assert.equal(report.workerStats.find((item) => item.id === "primary").fatalErrors, 1);
  assert.equal(report.results[0].workerId, "backup");
});

test("同一任务组串行执行并优先保持在同一 Worker", async () => {
  const assignments = [];
  let active = 0;
  let peakForGroup = 0;
  const report = await runWorkerQueue(workers, [{ id: 1, groupKey: "item-1" }, { id: 2, groupKey: "item-1" }], {
    concurrency: 2,
    runTask: async (worker, task) => {
      assignments.push({ workerId: worker.id, taskId: task.id });
      active += 1;
      peakForGroup = Math.max(peakForGroup, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { ok: true };
    },
  });

  assert.equal(report.success, 2);
  assert.equal(peakForGroup, 1);
  assert.deepEqual(assignments.map((item) => item.workerId), ["primary", "primary"]);
});

test("不可重试错误保留部分成功，并给出非零退出码", async () => {
  const report = await runWorkerQueue(workers, [{ id: "good" }, { id: "bad" }], {
    concurrency: 2,
    runTask: async (_worker, task) => {
      if (task.id === "bad") throw new ImageWorkflowError("请求参数无效", "HTTP_400", { status: 400 });
      return { ok: true };
    },
  });

  assert.equal(report.success, 1);
  assert.equal(report.failed, 1);
  assert.equal(report.exitCode, 1);
  assert.equal(report.results.find((result) => !result.ok).status, 400);
});

test("没有可用 Worker 时不启动任务", async () => {
  const report = await runWorkerQueue([], [{ id: "pending" }], { runTask: async () => ({ ok: true }) });
  assert.equal(report.success, 0);
  assert.equal(report.failed, 1);
  assert.equal(report.results[0].skipped, true);
  assert.match(report.exhaustedReason, /没有可用 Worker/);
});
