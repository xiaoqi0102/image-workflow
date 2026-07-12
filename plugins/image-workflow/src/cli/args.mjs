import { ImageWorkflowError } from "../util/errors.mjs";

const VALUE_OPTIONS = new Set([
  "adapter", "api-key", "background", "base-url", "batch", "concurrency", "cooldown-ms",
  "count", "fixed-ref", "id", "image", "input-fidelity", "item-dir", "limit", "mask", "max-retries",
  "model", "moderation", "n", "name", "out", "out-dir", "output-compression", "output-format",
  "profile", "prompt", "prompt-file", "quality", "repair-passes", "size", "template-inline",
  "templates", "text-model", "timeout-ms", "worker", "worker-id", "batch-inline",
]);

const REPEATABLE_OPTIONS = new Set(["image", "fixed-ref", "template-inline"]);
const FLAG_OPTIONS = new Set(["batch-edit", "dry-run", "force", "help", "no-adaptive", "no-repair"]);

export function parseCommandLine(argv) {
  const positionals = [];
  const options = {};
  let stopOptions = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (stopOptions) {
      positionals.push(token);
      continue;
    }
    if (token === "--") {
      stopOptions = true;
      continue;
    }
    if (!token.startsWith("--") || token === "-") {
      positionals.push(token);
      continue;
    }
    const equalAt = token.indexOf("=");
    const key = token.slice(2, equalAt === -1 ? undefined : equalAt);
    if (!key) throw new ImageWorkflowError("选项名不能为空。", "INVALID_ARGUMENT");
    let value;
    if (equalAt !== -1) {
      value = token.slice(equalAt + 1);
    } else if (VALUE_OPTIONS.has(key)) {
      value = argv[index + 1];
      if (value == null || value.startsWith("--")) throw new ImageWorkflowError(`--${key} 需要一个值。`, "MISSING_ARGUMENT");
      index += 1;
    } else if (FLAG_OPTIONS.has(key)) {
      value = true;
    } else {
      throw new ImageWorkflowError(`未知选项: --${key}。`, "INVALID_ARGUMENT");
    }
    if (REPEATABLE_OPTIONS.has(key)) {
      const current = options[key] || [];
      current.push(value);
      options[key] = current;
    } else if (key === "batch-inline") {
      const current = options[key] || [];
      current.push(value);
      while (index + 1 < argv.length && !argv[index + 1].startsWith("--")) {
        current.push(argv[index + 1]);
        index += 1;
      }
      options[key] = current;
    } else {
      options[key] = value;
    }
  }
  return { positionals, options };
}

export function readNumber(value, option, options = {}) {
  if (value == null || value === "") return options.defaultValue;
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number)) throw new ImageWorkflowError(`--${option} 必须是整数。`, "INVALID_ARGUMENT");
  if (options.min != null && number < options.min) throw new ImageWorkflowError(`--${option} 必须不小于 ${options.min}。`, "INVALID_ARGUMENT");
  if (options.max != null && number > options.max) throw new ImageWorkflowError(`--${option} 必须不大于 ${options.max}。`, "INVALID_ARGUMENT");
  return number;
}

export function optionValue(options, name, fallback = undefined) {
  const value = options[name];
  return value == null || value === "" ? fallback : value;
}

export function hasOption(options, name) {
  return Object.prototype.hasOwnProperty.call(options, name);
}
