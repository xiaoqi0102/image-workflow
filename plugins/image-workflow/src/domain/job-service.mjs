import { getAdapter } from "../adapters/registry.mjs";
import { loadImage } from "../util/images.mjs";
import { outputPath, suggestedExtension, writeImage } from "../infra/output-store.mjs";
import { runWorkerQueue } from "./scheduler.mjs";
import { ImageWorkflowError } from "../util/errors.mjs";

export function resolveTask(profile, input) {
  const defaults = profile.defaults || {};
  const outputFormat = input.outputFormat || defaults.outputFormat || "png";
  const n = Number(input.n ?? defaults.n ?? 1);
  if (!Number.isInteger(n) || n < 1) throw new ImageWorkflowError("--n 必须是大于等于 1 的整数。", "INVALID_ARGUMENT");
  return {
    operation: input.operation || "generate",
    prompt: input.prompt,
    model: input.model || defaults.model || "gpt-image-2",
    size: input.size || defaults.size || "auto",
    quality: input.quality || defaults.quality || "medium",
    n,
    outputFormat,
    background: input.background,
    moderation: input.moderation,
    outputCompression: input.outputCompression,
    inputFidelity: input.inputFidelity,
    timeoutMs: input.timeoutMs ?? defaults.timeoutMs ?? null,
    sources: (input.images || []).map(loadImage),
    mask: input.mask ? loadImage(input.mask) : null,
    groupKey: input.groupKey || null,
  };
}

export function runTasks(profile, inputs, options = {}) {
  const adapter = getAdapter(profile.adapter);
  const tasks = inputs.map((input) => resolveTask(profile, input));
  for (const task of tasks) {
    if (!task.prompt) throw new ImageWorkflowError("--prompt 或 --prompt-file 为必填参数。", "MISSING_PROMPT");
    if (task.operation === "edit" && task.sources.length === 0) throw new ImageWorkflowError("edit 至少需要一个 --image。", "MISSING_IMAGE");
    if (task.mask && !adapter.capabilities.mask) throw new ImageWorkflowError(`${profile.adapter} 不支持 mask。`, "UNSUPPORTED_CAPABILITY");
    if (profile.adapter === "fhl-responses" && task.n !== 1) throw new ImageWorkflowError("FHL Responses 固定单图；请使用 --count 扩展任务数量。", "UNSUPPORTED_CAPABILITY");
  }
  return runResolvedTasks(profile, adapter, tasks, options);
}

async function runResolvedTasks(profile, adapter, tasks, options) {
  if (options.dryRun) return { dryRun: true, total: tasks.length, profile: profile.id, adapter: profile.adapter, tasks: tasks.map((task) => ({ operation: task.operation, model: task.model, size: task.size, quality: task.quality, n: task.n, sourceCount: task.sources.length, hasMask: Boolean(task.mask), groupKey: task.groupKey })) };
  const maxRetries = options.maxRetries ?? profile.defaults.maxRetries ?? (profile.adapter === "fhl-responses" ? 3 : 5);
  const defaultConcurrency = profile.workers.filter((worker) => worker.enabled !== false && worker.apiKey).length || 1;
  const report = await runWorkerQueue(profile.workers, tasks, {
    concurrency: options.concurrency ?? defaultConcurrency,
    adaptive: options.adaptive !== false,
    maxRetries,
    cooldownMs: options.cooldownMs,
    onTaskStart: options.onTaskStart,
    // 图片文件须在调度完成后集中命名；外部回调在这里仅用于进度展示，不能假设 paths 已存在。
    onTaskComplete: options.onTaskComplete,
    runTask: async (worker, task) => adapter.execute({ profile, worker, task }),
  });
  const written = [];
  const totalImages = report.results.reduce((total, result) => total + (result.ok ? result.images.length : 0), 0);
  for (const [taskIndex, result] of report.results.entries()) {
    if (!result.ok) continue;
    const task = tasks[taskIndex];
    result.paths = result.images.map((image, imageIndex) => {
      const format = suggestedExtension(image, task.outputFormat);
      const path = outputPath({ out: options.out, outDir: options.outDir, index: written.length + imageIndex, total: totalImages, format, prefix: task.operation });
      return writeImage(path, image, options.force);
    });
    written.push(...result.paths);
  }
  report.paths = written;
  return report;
}
