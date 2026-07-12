import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { csvCell, fileStem, listImageFiles, sanitizePathSegment, writeJsonAtomic, writeTextAtomic } from "../util/fs.mjs";
import { resolveOutputDirectory } from "../infra/output-store.mjs";
import { normalizeOutputFormat } from "../util/images.mjs";
import { runTasks } from "./job-service.mjs";
import { ImageWorkflowError } from "../util/errors.mjs";

export function readTemplates(filePath, inlineTemplates = []) {
  const entries = [];
  if (filePath) {
    const parsed = JSON.parse(readFileSync(resolve(filePath), "utf8"));
    const rawTemplates = Array.isArray(parsed) ? parsed : parsed?.templates;
    if (!Array.isArray(rawTemplates)) throw new ImageWorkflowError("templates 文件必须是数组或 { templates: [] }。", "INVALID_TEMPLATES");
    entries.push(...rawTemplates);
  }
  entries.push(...inlineTemplates);
  const templates = entries.map((entry, index) => {
    const value = typeof entry === "string" ? { prompt: entry } : entry;
    if (!value?.prompt) throw new ImageWorkflowError(`模板 ${index + 1} 缺少 prompt。`, "INVALID_TEMPLATES");
    const key = sanitizePathSegment(value.key || value.label || `template_${index + 1}`).toLowerCase();
    return { key, label: value.label || key, prompt: String(value.prompt) };
  });
  if (templates.length === 0) throw new ImageWorkflowError("至少提供一个模板。", "MISSING_TEMPLATES");
  return templates;
}

export function buildWorkflowTasks(options) {
  const fixedRefs = (options.fixedRefs || []).map((path) => resolve(path));
  if (fixedRefs.length === 0) throw new ImageWorkflowError("workflow batch-edit 至少需要一个 --fixed-ref。", "MISSING_FIXED_REF");
  for (const fixedRef of fixedRefs) {
    if (!existsSync(fixedRef)) throw new ImageWorkflowError(`固定参考图不存在: ${fixedRef}`, "MISSING_FIXED_REF");
  }
  const templates = readTemplates(options.templates, options.templateInline || []);
  const availableItems = listImageFiles(options.itemDir);
  if (availableItems.length === 0) throw new ImageWorkflowError("变量图片目录中没有可处理的图片。", "MISSING_IMAGE");
  const requestedLimit = options.limit == null ? availableItems.length : Number(options.limit);
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1) throw new ImageWorkflowError("--limit 必须是大于等于 1 的整数。", "INVALID_ARGUMENT");
  const limit = Math.min(requestedLimit, availableItems.length);
  const items = availableItems.slice(0, limit);
  const outputFormat = normalizeOutputFormat(options.outputFormat || "png");
  const outputRoot = resolveOutputDirectory(options.outDir || join(process.cwd(), "output", "image-workflow", "workflow"));
  const tasks = [];
  for (const [itemIndex, item] of items.entries()) {
    const itemDirectory = join(outputRoot, `${String(itemIndex + 1).padStart(3, "0")}_${sanitizePathSegment(fileStem(item.name))}`);
    for (const [templateIndex, template] of templates.entries()) {
      const filename = `${String(templateIndex + 1).padStart(2, "0")}_${template.key}.${outputFormat}`;
      tasks.push({
        itemIndex: itemIndex + 1,
        itemPath: item.path,
        itemName: item.name,
        template,
        groupKey: `${itemIndex + 1}:${item.name}`,
        images: [...fixedRefs, item.path],
        outputPath: join(itemDirectory, filename),
      });
    }
  }
  return { fixedRefs, templates, items, tasks, outputRoot };
}

export async function runWorkflowBatchEdit(profile, options = {}) {
  if (options.mask) throw new ImageWorkflowError("workflow batch-edit 不支持 --mask；请使用单次 edit。", "UNSUPPORTED_CAPABILITY");
  const effectiveOptions = { ...options, outputFormat: options.outputFormat || profile.defaults?.outputFormat || "png" };
  const plan = buildWorkflowTasks(effectiveOptions);
  const dryRun = Boolean(options.dryRun);
  const metadata = { profile: profile.id, adapter: profile.adapter, fixedRefCount: plan.fixedRefs.length, itemCount: plan.items.length, templateCount: plan.templates.length, taskCount: plan.tasks.length, outputRoot: plan.outputRoot };
  if (dryRun) return { dryRun: true, ...metadata, tasks: plan.tasks.map(publicTask) };
  const repairPasses = options.repairPasses == null ? 2 : Math.max(0, Number(options.repairPasses));
  const resultsByIndex = new Array(plan.tasks.length).fill(null);
  const sessions = [];
  let queued = collectMissingTasks(plan.tasks, resultsByIndex, Boolean(effectiveOptions.force));
  let pass = 0;
  while (queued.length > 0 && pass <= repairPasses) {
    const label = pass === 0 ? "main" : `repair-${pass}`;
    const startedAt = new Date().toISOString();
    const report = await runTasks(profile, queued.map((task) => ({
      operation: "edit", prompt: task.template.prompt, images: task.images, groupKey: task.groupKey, model: effectiveOptions.model, size: effectiveOptions.size, quality: effectiveOptions.quality, n: 1, outputFormat: effectiveOptions.outputFormat, moderation: effectiveOptions.moderation, timeoutMs: effectiveOptions.timeoutMs,
    })), {
      concurrency: effectiveOptions.concurrency,
      adaptive: effectiveOptions.adaptive,
      maxRetries: effectiveOptions.maxRetries,
      outDir: plan.outputRoot,
      force: true,
      onTaskComplete: (_input, result, context) => {
        const original = queued[context.index];
        // 调度器回调发生在图片落盘前，只记录即时状态；稳定输出在本轮完成后归位。
        resultsByIndex[original.fullIndex] = result;
        writeArtifacts(plan, resultsByIndex, sessions, metadata, true);
      },
    });
    for (const [index, result] of report.results.entries()) {
      const original = queued[index];
      resultsByIndex[original.fullIndex] = result;
      if (result.ok && result.paths?.[0]) {
        moveOutput(result.paths[0], original.outputPath, Boolean(effectiveOptions.force));
        result.paths = [original.outputPath];
      }
    }
    sessions.push({ label, startedAt, endedAt: new Date().toISOString(), total: report.total, success: report.success, failed: report.failed, retryCount: report.retryCount, workerStats: report.workerStats });
    writeArtifacts(plan, resultsByIndex, sessions, metadata, true);
    queued = collectMissingTasks(plan.tasks, resultsByIndex, false);
    pass += 1;
  }
  const artifacts = writeArtifacts(plan, resultsByIndex, sessions, metadata, false);
  const records = buildRecords(plan.tasks, resultsByIndex);
  return { ...metadata, outputRoot: plan.outputRoot, total: records.length, success: records.filter((record) => record.status === "success").length, failed: records.filter((record) => record.status !== "success").length, records, sessions, artifacts, exitCode: records.some((record) => record.status !== "success") ? 1 : 0 };
}

function collectMissingTasks(tasks, resultsByIndex, force = false) {
  const queued = [];
  for (const [index, task] of tasks.entries()) {
    if (!force && existsSync(task.outputPath)) {
      resultsByIndex[index] ||= { ok: true, paths: [task.outputPath], workerId: "existing", workerName: "existing", attempts: 0, retries: 0 };
      continue;
    }
    queued.push({ ...task, fullIndex: index });
  }
  return queued;
}

function moveOutput(source, destination, force) {
  if (source === destination || !existsSync(source)) return;
  mkdirSync(dirname(destination), { recursive: true });
  if (existsSync(destination)) {
    if (!force) return;
    unlinkSync(destination);
  }
  renameSync(source, destination);
}

function buildRecords(tasks, results) {
  return tasks.map((task, index) => {
    const result = results[index];
    return { task: index + 1, item: task.itemName, template: task.template.key, status: result?.ok || existsSync(task.outputPath) ? "success" : "failed", attempts: result?.attempts ?? 0, retries: result?.retries ?? 0, workerId: result?.workerId || null, workerName: result?.workerName || null, output: task.outputPath, error: result?.ok ? null : result?.error || "未生成输出" };
  });
}

function writeArtifacts(plan, results, sessions, metadata, partial) {
  const records = buildRecords(plan.tasks, results);
  const summary = { ...metadata, partial, total: records.length, success: records.filter((record) => record.status === "success").length, failed: records.filter((record) => record.status === "failed").length };
  const manifestPath = join(plan.outputRoot, "manifest.json");
  const failuresPath = join(plan.outputRoot, "failures.json");
  const sessionsPath = join(plan.outputRoot, "sessions.json");
  const summaryPath = join(plan.outputRoot, "summary.csv");
  writeJsonAtomic(manifestPath, { summary, items: records });
  writeJsonAtomic(failuresPath, records.filter((record) => record.status === "failed"));
  writeJsonAtomic(sessionsPath, sessions);
  writeTextAtomic(summaryPath, ["task,item,template,status,attempts,retries,workerId,workerName,output,error", ...records.map((record) => [record.task, record.item, record.template, record.status, record.attempts, record.retries, record.workerId, record.workerName, record.output, record.error].map(csvCell).join(","))].join("\n") + "\n");
  return { manifestPath, failuresPath, sessionsPath, summaryPath };
}

function publicTask(task) {
  return { item: task.itemName, template: task.template.key, output: task.outputPath, fixedReferenceCount: task.images.length - 1 };
}
