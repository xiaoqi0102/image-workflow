import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  addProfile,
  findWorker,
  loadConfig,
  publicProfile,
  requireProfile,
  saveConfig,
  validateProfile,
} from "../config/profile-store.mjs";
import { configPath } from "../config/paths.mjs";
import { runTasks } from "../domain/job-service.mjs";
import { runWorkflowBatchEdit } from "../domain/workflow.mjs";
import { ImageWorkflowError, asImageWorkflowError } from "../util/errors.mjs";
import { hasOption, optionValue, readNumber } from "./args.mjs";

export async function executeCommand(positionals, options, output = console) {
  const [command, subcommand] = positionals;
  if (!command || command === "help" || options.help) return { kind: "help", text: usage() };

  switch (command) {
    case "profile": return runProfileCommand(subcommand, options, output);
    case "worker": return runWorkerCommand(subcommand, options, output);
    case "status": return runStatusCommand(options, output);
    case "generate": return runGenerateCommand(options, output);
    case "edit": return runEditCommand(options, output);
    case "workflow": return runWorkflowCommand(subcommand, options, output);
    default: throw new ImageWorkflowError(`未知命令: ${command}。使用 help 查看帮助。`, "UNKNOWN_COMMAND");
  }
}

function runProfileCommand(action, options, output) {
  const config = loadConfig();
  switch (action) {
    case "add": {
      const id = requiredOption(options, "id");
      const profileInput = {
        id,
        adapter: requiredOption(options, "adapter"),
        baseUrl: requiredOption(options, "base-url"),
        defaults: profileDefaults(options),
        workers: [],
      };
      if (profileInput.adapter === "fhl-responses" && Number(profileInput.defaults.n ?? 1) !== 1) {
        throw new ImageWorkflowError("fhl-responses Profile 的默认 n 必须为 1；请使用 --count 控制任务数量。", "INVALID_PROFILE");
      }
      const profile = addProfile(config, profileInput);
      saveConfig(config);
      return report({ action: "profile-added", profile: publicProfile(profile) }, output);
    }
    case "list":
      return report({ activeProfileId: config.activeProfileId, profiles: config.profiles.map(publicProfile), configPath: configPath() }, output);
    case "show": {
      const profile = requireProfile(config, optionValue(options, "profile", optionValue(options, "id")));
      return report({ active: config.activeProfileId === profile.id, configPath: configPath(), profile: publicProfile(profile) }, output);
    }
    case "use": {
      const id = requiredOption(options, "profile", "id");
      const profile = requireProfile(config, id);
      config.activeProfileId = profile.id;
      saveConfig(config);
      return report({ action: "profile-used", activeProfileId: profile.id }, output);
    }
    case "update": {
      const profile = requireProfile(config, requiredOption(options, "profile", "id"));
      updateProfile(profile, options);
      validateProfile(profile);
      saveConfig(config);
      return report({ action: "profile-updated", profile: publicProfile(profile) }, output);
    }
    case "remove": {
      const id = requiredOption(options, "profile", "id");
      const index = config.profiles.findIndex((profile) => profile.id === id);
      if (index === -1) throw new ImageWorkflowError(`未找到 Profile: ${id}`, "PROFILE_NOT_FOUND");
      const [removed] = config.profiles.splice(index, 1);
      if (config.activeProfileId === id) config.activeProfileId = config.profiles[0]?.id || null;
      saveConfig(config);
      return report({ action: "profile-removed", profileId: removed.id, activeProfileId: config.activeProfileId }, output);
    }
    default: throw new ImageWorkflowError("profile 命令支持 add、list、show、use、update、remove。", "UNKNOWN_COMMAND");
  }
}

function runWorkerCommand(action, options, output) {
  const config = loadConfig();
  const profile = requireProfile(config, optionValue(options, "profile"));
  switch (action) {
    case "add": {
      if (profile.workers.length >= 10) throw new ImageWorkflowError("每个 Profile 最多配置 10 个 Worker。", "INVALID_WORKER");
      const id = requiredOption(options, "worker-id", "id");
      if (profile.workers.some((worker) => worker.id === id)) throw new ImageWorkflowError(`Worker 已存在: ${id}`, "WORKER_EXISTS");
      const worker = { id, name: optionValue(options, "name", id), apiKey: requiredOption(options, "api-key"), enabled: true };
      profile.workers.push(worker);
      saveConfig(config);
      return report({ action: "worker-added", profileId: profile.id, worker: publicWorker(worker) }, output);
    }
    case "list":
      return report({ profileId: profile.id, workers: profile.workers.map(publicWorker) }, output);
    case "set-key": {
      const worker = findWorker(profile, requiredOption(options, "worker", "worker-id", "id"));
      worker.apiKey = requiredOption(options, "api-key");
      saveConfig(config);
      return report({ action: "worker-key-updated", profileId: profile.id, worker: publicWorker(worker) }, output);
    }
    case "enable":
    case "disable": {
      const worker = findWorker(profile, requiredOption(options, "worker", "worker-id", "id"));
      worker.enabled = action === "enable";
      saveConfig(config);
      return report({ action: `worker-${action}d`, profileId: profile.id, worker: publicWorker(worker) }, output);
    }
    case "remove": {
      const reference = requiredOption(options, "worker", "worker-id", "id");
      const worker = findWorker(profile, reference);
      profile.workers = profile.workers.filter((item) => item !== worker);
      saveConfig(config);
      return report({ action: "worker-removed", profileId: profile.id, workerId: worker.id }, output);
    }
    default: throw new ImageWorkflowError("worker 命令支持 add、list、set-key、enable、disable、remove。", "UNKNOWN_COMMAND");
  }
}

function runStatusCommand(options, output) {
  const config = loadConfig();
  const profileId = optionValue(options, "profile", config.activeProfileId);
  const profile = profileId ? requireProfile(config, profileId) : null;
  return report({
      configPath: configPath(),
      activeProfileId: config.activeProfileId,
      profile: profile ? publicProfile(profile) : null,
      configured: Boolean(profile?.baseUrl && profile.workers.some((worker) => worker.enabled && worker.apiKey)),
    }, output);
}

async function runGenerateCommand(options, output) {
  assertAllowedOptions(options, IMAGE_COMMAND_OPTIONS, "generate");
  const profile = selectedProfile(options);
  validateImageCount(profile, options);
  const prompts = readPrompts(options);
  const count = readNumber(optionValue(options, "count", 1), "count", { min: 1, max: 1000, defaultValue: 1 });
  const inputs = prompts.flatMap((prompt) => Array.from({ length: count }, () => buildImageInput("generate", prompt, options)));
  const result = await runTasks(profile, inputs, runOptions(options, output));
  return report(result, output);
}

async function runEditCommand(options, output) {
  assertAllowedOptions(options, EDIT_COMMAND_OPTIONS, "edit");
  const profile = selectedProfile(options);
  validateImageCount(profile, options);
  const images = options.image || [];
  if (images.length === 0) throw new ImageWorkflowError("edit 至少需要一个 --image。", "MISSING_IMAGE");
  const mask = optionValue(options, "mask");
  if (hasOption(options, "batch-edit")) {
    if (mask) throw new ImageWorkflowError("batch-edit 不支持 --mask。", "UNSUPPORTED_CAPABILITY");
    const prompts = readPrompts(options);
    const count = readNumber(optionValue(options, "count", 1), "count", { min: 1, max: 1000, defaultValue: 1 });
    const inputs = [];
    for (const image of images) for (const prompt of prompts) for (let index = 0; index < count; index += 1) inputs.push(buildImageInput("edit", prompt, options, { images: [image] }));
    const result = await runTasks(profile, inputs, runOptions(options, output));
    return report(result, output);
  }
  const prompts = readPrompts(options);
  if (prompts.length !== 1) throw new ImageWorkflowError("单次 edit 只接受一个提示词；使用 --batch 或 --batch-inline 执行批处理。", "INVALID_ARGUMENT");
  const count = readNumber(optionValue(options, "count", 1), "count", { min: 1, max: 1000, defaultValue: 1 });
  const inputs = Array.from({ length: count }, () => buildImageInput("edit", prompts[0], options, { images, mask }));
  const result = await runTasks(profile, inputs, runOptions(options, output));
  return report(result, output);
}

async function runWorkflowCommand(action, options, output) {
  if (action !== "batch-edit") throw new ImageWorkflowError("workflow 命令目前只支持 batch-edit。", "UNKNOWN_COMMAND");
  assertAllowedOptions(options, new Set(["profile", "fixed-ref", "item-dir", "templates", "template-inline", "limit", "concurrency", "no-adaptive", "repair-passes", "no-repair", "dry-run", "force", "out-dir", "max-retries", "model", "size", "quality", "output-format", "moderation", "timeout-ms"]), "workflow batch-edit");
  if (hasOption(options, "mask")) throw new ImageWorkflowError("workflow batch-edit 不支持 --mask。", "UNSUPPORTED_CAPABILITY");
  const profile = selectedProfile(options);
  const result = await runWorkflowBatchEdit(profile, {
    fixedRefs: options["fixed-ref"] || [],
    itemDir: requiredOption(options, "item-dir"),
    templates: optionValue(options, "templates"),
    templateInline: options["template-inline"] || [],
    limit: hasOption(options, "limit") ? readNumber(options.limit, "limit", { min: 1, max: 1000 }) : undefined,
    concurrency: hasOption(options, "concurrency") ? readNumber(options.concurrency, "concurrency", { min: 1, max: 10 }) : undefined,
    adaptive: options["no-adaptive"] !== true,
    repairPasses: options["no-repair"] ? 0 : readNumber(optionValue(options, "repair-passes", 1), "repair-passes", { min: 0, max: 5, defaultValue: 1 }),
    dryRun: options["dry-run"] === true,
    force: options.force === true,
    outDir: optionValue(options, "out-dir"),
    maxRetries: hasOption(options, "max-retries") ? readNumber(options["max-retries"], "max-retries", { min: 0, max: 10 }) : undefined,
    ...workflowImageOverrides(options),
  });
  return report(result, output);
}

function selectedProfile(options) {
  return requireProfile(loadConfig(), optionValue(options, "profile"));
}

function assertAllowedOptions(options, allowed, command) {
  for (const option of Object.keys(options)) {
    if (!allowed.has(option)) throw new ImageWorkflowError(`${command} 不支持 --${option}。`, "INVALID_ARGUMENT");
  }
}

const IMAGE_COMMAND_OPTIONS = new Set([
  "profile", "prompt", "prompt-file", "batch", "batch-inline", "count", "model", "size", "quality", "n",
  "output-format", "background", "moderation", "output-compression", "out", "out-dir", "concurrency",
  "no-adaptive", "dry-run", "force", "max-retries", "cooldown-ms", "timeout-ms",
]);

const EDIT_COMMAND_OPTIONS = new Set([
  ...IMAGE_COMMAND_OPTIONS,
  "image", "mask", "batch-edit", "input-fidelity",
]);

function profileDefaults(options) {
  const defaults = {};
  const map = { model: "model", size: "size", quality: "quality", n: "n", "output-format": "outputFormat", "timeout-ms": "timeoutMs", "max-retries": "maxRetries", "text-model": "textModel" };
  for (const [option, property] of Object.entries(map)) {
    if (!hasOption(options, option)) continue;
    defaults[property] = ["n", "timeoutMs", "maxRetries"].includes(property) ? readNumber(options[option], option, { min: property === "n" ? 1 : 0 }) : options[option];
  }
  return defaults;
}

function updateProfile(profile, options) {
  if (hasOption(options, "adapter")) profile.adapter = options.adapter;
  if (hasOption(options, "base-url")) profile.baseUrl = String(options["base-url"]).replace(/\/+$/, "");
  const defaults = profileDefaults(options);
  profile.defaults = { ...profile.defaults, ...defaults };
  if (profile.adapter === "fhl-responses" && Number(profile.defaults.n) !== 1) {
    throw new ImageWorkflowError("fhl-responses Profile 的默认 n 必须为 1；请使用 --count 控制任务数量。", "INVALID_PROFILE");
  }
}

function publicWorker(worker) {
  return { id: worker.id, name: worker.name, enabled: worker.enabled !== false, hasKey: Boolean(worker.apiKey) };
}

function report(value, output) {
  return { kind: "json", value, output };
}

function requiredOption(options, ...names) {
  for (const name of names) {
    const value = optionValue(options, name);
    if (value != null) return String(value).trim();
  }
  throw new ImageWorkflowError(`缺少必填参数 --${names[0]}。`, "MISSING_ARGUMENT");
}

function readPrompts(options) {
  const prompts = [];
  if (hasOption(options, "prompt")) prompts.push(String(options.prompt).trim());
  if (hasOption(options, "prompt-file")) prompts.push(readTextFile(options["prompt-file"], "prompt-file").trim());
  for (const prompt of options["batch-inline"] || []) prompts.push(String(prompt).trim());
  if (hasOption(options, "batch")) {
    let parsed;
    try {
      parsed = JSON.parse(readTextFile(options.batch, "batch"));
    } catch (error) {
      throw new ImageWorkflowError(`无法解析 --batch JSON: ${error.message}`, "INVALID_BATCH", { cause: error });
    }
    const values = Array.isArray(parsed) ? parsed : parsed?.prompts;
    if (!Array.isArray(values)) throw new ImageWorkflowError("--batch 文件必须是字符串数组或 { prompts: [] }。", "INVALID_BATCH");
    for (const item of values) prompts.push(typeof item === "string" ? item.trim() : String(item?.prompt || "").trim());
  }
  const normalized = prompts.filter(Boolean);
  if (normalized.length === 0) throw new ImageWorkflowError("必须提供 --prompt、--prompt-file、--batch 或 --batch-inline。", "MISSING_PROMPT");
  return normalized;
}

function readTextFile(path, option) {
  const absolute = resolve(path);
  if (!existsSync(absolute)) throw new ImageWorkflowError(`--${option} 文件不存在: ${absolute}`, "FILE_NOT_FOUND");
  return readFileSync(absolute, "utf8").replace(/^\uFEFF/, "");
}

function buildImageInput(operation, prompt, options, extra = {}) {
  return { operation, prompt, images: extra.images || [], mask: extra.mask || null, ...imageOptionOverrides(options) };
}

function validateImageCount(profile, options) {
  if (profile.adapter !== "fhl-responses") return;
  if (hasOption(options, "n") && readNumber(options.n, "n", { min: 1 }) !== 1) {
    throw new ImageWorkflowError("fhl-responses 固定每次请求生成一张图片；请使用 --count 增加任务数。", "INVALID_ARGUMENT");
  }
}

function imageOptionOverrides(options) {
  const values = {
    model: optionValue(options, "model"),
    size: optionValue(options, "size"),
    quality: optionValue(options, "quality"),
    n: hasOption(options, "n") ? readNumber(options.n, "n", { min: 1 }) : undefined,
    outputFormat: optionValue(options, "output-format"),
    background: optionValue(options, "background"),
    moderation: optionValue(options, "moderation"),
    outputCompression: hasOption(options, "output-compression") ? readNumber(options["output-compression"], "output-compression", { min: 0, max: 100 }) : undefined,
    inputFidelity: optionValue(options, "input-fidelity"),
    timeoutMs: hasOption(options, "timeout-ms") ? readNumber(options["timeout-ms"], "timeout-ms", { min: 1 }) : undefined,
  };
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value != null));
}

function workflowImageOverrides(options) {
  const imageOptions = imageOptionOverrides(options);
  const allowed = ["model", "size", "quality", "outputFormat", "moderation", "timeoutMs"];
  return Object.fromEntries(allowed.filter((key) => imageOptions[key] != null).map((key) => [key, imageOptions[key]]));
}

function runOptions(options, output) {
  if (hasOption(options, "out") && hasOption(options, "out-dir")) {
    throw new ImageWorkflowError("--out 与 --out-dir 不能同时使用。", "INVALID_ARGUMENT");
  }
  return {
    out: optionValue(options, "out"),
    outDir: optionValue(options, "out-dir"),
    force: options.force === true,
    dryRun: options["dry-run"] === true,
    concurrency: hasOption(options, "concurrency") ? readNumber(options.concurrency, "concurrency", { min: 1, max: 10 }) : undefined,
    adaptive: options["no-adaptive"] !== true,
    maxRetries: hasOption(options, "max-retries") ? readNumber(options["max-retries"], "max-retries", { min: 0, max: 10 }) : undefined,
    cooldownMs: hasOption(options, "cooldown-ms") ? readNumber(options["cooldown-ms"], "cooldown-ms", { min: 0 }) : undefined,
    onTaskStart: (task, context) => output.error?.(`[${context.index + 1}/${context.total}] ${task.operation} via ${context.worker.name || context.worker.id}`),
  };
}

function usage() {
  return `image-workflow

Profile:
  profile add --id <id> --adapter <openai-images|fhl-responses> --base-url <url>
  profile list | show [--profile <id>] | use --profile <id>
  profile update --profile <id> [--base-url <url>] [--model <model>] [--size <size>] [--quality <quality>] [--n <n>] [--output-format <format>] [--text-model <model>]
  profile remove --profile <id>

Worker:
  worker add --profile <id> --worker-id <id> --api-key <key> [--name <name>]
  worker list [--profile <id>]
  worker set-key --profile <id> --worker <id> --api-key <key>
  worker enable|disable|remove --profile <id> --worker <id>

Images:
  generate --prompt <text> [--count <tasks>] [--n <images/request>] [--out <file>|--out-dir <dir>]
  generate --batch <prompts.json> | --batch-inline <prompt> [--batch-inline <prompt> ...]
  edit --image <file> [--image <file> ...] --prompt <text> [--mask <file>]
  edit --batch-edit --image <file> [--image <file> ...] --prompt <text>
  workflow batch-edit --fixed-ref <file> [--fixed-ref <file> ...] --item-dir <dir> (--templates <templates.json>|--template-inline <text>) [--out-dir <dir>]

Use --dry-run to inspect a request without calling an API.`;
}

export function printResult(result, output = console) {
  const destination = result.output || output;
  if (result.kind === "help") destination.log(result.text);
  else destination.log(JSON.stringify(result.value, null, 2));
}

export function printError(error, output = console) {
  const normalized = asImageWorkflowError(error);
  output.error(`错误 [${normalized.code}]: ${normalized.message}`);
}
