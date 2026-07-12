import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function configDirectory() {
  if (process.env.IMAGE_WORKFLOW_CONFIG_DIR) return resolve(process.env.IMAGE_WORKFLOW_CONFIG_DIR);
  return join(homedir(), ".codex", "image-workflow");
}

export function configPath() {
  return join(configDirectory(), "config.json");
}
