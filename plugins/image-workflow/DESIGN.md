# Image Workflow 插件设计

## 目标

在 Codex 中提供一个无需外部运行时依赖的图像工作流插件：同一 CLI 管理 Profile、Worker、OpenAI 兼容 Images API、FHL Responses API、批量任务和稳定输出。

## 设计决策

- 每个 Profile 维护独立的 1-10 个 Worker，避免跨服务端点或账号调度。
- `--count` 拆分为队列任务；OpenAI Images 的 `--n` 保持为单请求参数，FHL 固定单图。
- 调度器处理 Worker 粘性、单 Worker 单任务、429/5xx 冷却、超时重试与认证隔离。
- 工作流使用固定参考图、变量目录和模板构建稳定路径；存在的产物会在续跑时跳过。
- API Key 按用户要求以明文保存于 `~/.codex/image-workflow/config.json`。

## 限制

- 服务端兼容程度决定可用模型和参数组合。
- mask 仅支持 `openai-images` 的单次编辑；批量编辑和工作流不支持 mask。
- 冷却状态仅在当前 CLI 进程中存在。

详细架构和可靠性策略见仓库根目录的 [DESIGN](../../DESIGN.md)。
