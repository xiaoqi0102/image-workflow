import { ensureDirectory, readJson, writeJsonAtomic } from "../util/fs.mjs";
import { configDirectory, configPath } from "./paths.mjs";
import { ImageWorkflowError } from "../util/errors.mjs";

const DEFAULTS = { model: "gpt-image-2", textModel: null, size: "auto", quality: "medium", n: 1, outputFormat: "png", timeoutMs: null, maxRetries: null };

export function defaultConfig() {
  return { schemaVersion: 1, activeProfileId: null, profiles: [] };
}

export function normalizeProfile(profile) {
  return {
    id: String(profile.id || "").trim(),
    adapter: profile.adapter,
    baseUrl: String(profile.baseUrl || "").replace(/\/+$/, ""),
    defaults: { ...DEFAULTS, ...(profile.defaults || {}) },
    workers: Array.isArray(profile.workers) ? profile.workers.map((worker) => ({
      id: String(worker.id || "").trim(), name: String(worker.name || worker.id || "").trim(), apiKey: String(worker.apiKey || ""), enabled: worker.enabled !== false,
    })) : [],
  };
}

export function validateProfile(profile) {
  if (!profile.id) throw new ImageWorkflowError("Profile id 不能为空。", "INVALID_PROFILE");
  if (!new Set(["openai-images", "fhl-responses"]).has(profile.adapter)) throw new ImageWorkflowError("adapter 必须是 openai-images 或 fhl-responses。", "INVALID_PROFILE");
  if (!profile.baseUrl) throw new ImageWorkflowError("base-url 不能为空。", "INVALID_PROFILE");
  if (profile.workers.length > 10) throw new ImageWorkflowError("每个 Profile 最多配置 10 个 Worker。", "INVALID_PROFILE");
  const ids = new Set();
  for (const worker of profile.workers) {
    if (!worker.id || !worker.apiKey) throw new ImageWorkflowError("每个 Worker 都需要 id 和 apiKey。", "INVALID_WORKER");
    if (ids.has(worker.id)) throw new ImageWorkflowError(`重复的 Worker id: ${worker.id}`, "INVALID_WORKER");
    ids.add(worker.id);
  }
}

export function loadConfig() {
  const raw = readJson(configPath(), defaultConfig());
  return { ...defaultConfig(), ...raw, profiles: Array.isArray(raw?.profiles) ? raw.profiles.map(normalizeProfile) : [] };
}

export function saveConfig(config) {
  ensureDirectory(configDirectory());
  writeJsonAtomic(configPath(), config);
}

export function requireProfile(config, id = config.activeProfileId) {
  const profile = config.profiles.find((item) => item.id === id);
  if (!profile) throw new ImageWorkflowError(id ? `未找到 Profile: ${id}` : "没有活动 Profile。", "PROFILE_NOT_FOUND");
  return profile;
}

export function addProfile(config, input) {
  const profile = normalizeProfile(input);
  validateProfile(profile);
  if (config.profiles.some((item) => item.id === profile.id)) throw new ImageWorkflowError(`Profile 已存在: ${profile.id}`, "PROFILE_EXISTS");
  config.profiles.push(profile);
  if (!config.activeProfileId) config.activeProfileId = profile.id;
  return profile;
}

export function findWorker(profile, id) {
  const worker = profile.workers.find((item) => item.id === id || item.name === id);
  if (!worker) throw new ImageWorkflowError(`未找到 Worker: ${id}`, "WORKER_NOT_FOUND");
  return worker;
}

export function publicProfile(profile) {
  return { id: profile.id, adapter: profile.adapter, baseUrl: profile.baseUrl, defaults: profile.defaults, workers: profile.workers.map((worker) => ({ id: worker.id, name: worker.name, enabled: worker.enabled, hasKey: Boolean(worker.apiKey) })) };
}
