# Image Workflow 设计文档

## 设计概述

### 目标

为 Codex 提供一个可独立配置、可在多个 API Key Worker 之间调度、可恢复批量任务的本地图像插件。它统一两类常见契约：OpenAI 兼容 Images API 的 JSON/multipart 调用，以及 Responses API 的 SSE 图像结果。

### 非目标

- 不迁移 `api2img-skill` 或 FHL 插件的历史配置。
- 不绑定或预置任何 API 服务商、URL、模型或 API Key。
- 不提供美甲等垂直业务预设，不在工作流和批量编辑中支持 mask。
- 不跨 Profile 调度 Worker，也不将一张图拆分到多个 Worker。

## 架构

```text
Codex Skill
    |
CLI: Profile / Worker / generate / edit / workflow
    |
    +-----------------------------+
    | 配置存储与参数解析           |
    +-----------------------------+
                 |
          Job Service
                 |
          Scheduler
        /           \\
OpenAI Images     FHL Responses
 JSON/multipart      JSON/SSE
        \           /
           Output Store
                 |
   图片文件与工作流报告文件
```

核心模块职责：

- `src/config/`：维护 `~/.codex/image-workflow/config.json` 中的 Profile、默认参数和 Worker。
- `src/adapters/`：封装协议差异。OpenAI Images 发送 JSON 或 multipart；FHL Responses 发送图像工具请求并从 SSE 取回 Base64 图片。
- `src/domain/scheduler.mjs`：以单 Worker 单任务方式调度队列，处理冷却、重试、认证隔离和任务组粘性。
- `src/domain/job-service.mjs`：把 CLI 输入与 Profile 默认值合并为任务，并将图像写入输出路径。
- `src/domain/workflow.mjs`：规划固定参考图 × 变量图 × 模板任务，跳过已有输出，写入进度和最终报告。

## 关键决策

| 决策 | 理由 | 影响 |
| --- | --- | --- |
| 双适配器而非单一服务实现 | Images API 与 Responses API 的请求及响应格式不同 | 新服务只需新增 adapter，不影响调度器 |
| Profile 内独立 Worker 池 | 每个 Key 通常属于不同账户、配额或服务端 | 防止错误地跨端点或跨账户重试 |
| `--count` 与 `--n` 分离 | `count` 是可调度任务数量，`n` 是 Images API 单次响应数量 | 支持并行和服务端多图，但可预测输出数量 |
| 任务组粘性 | 同一变量图的多个模板常共享上下文与服务端状态 | 在健康 Worker 可用时减少组内分散 |
| 工作流输出可续跑 | 大规模任务容易被中断或部分失败 | 已有图片自动跳过，失败可补洞 |
| 不保存原始 SSE | 原始响应可能非常大且包含冗余图片数据 | 保留可审计的汇总报告，同时控制磁盘占用 |

## 可靠性策略

- `openai-images` 默认超时 300 秒，默认最多重试 5 次；`fhl-responses` 默认超时 180 秒，默认最多重试 3 次。
- 408、409、425、429、500、502、503、504、524、网络错误和超时是可重试错误。自适应模式会让发生限流或服务异常的 Worker 冷却。
- 401、403 或明确认证错误只使当前 Worker 在本轮运行中失效，其余 Worker 会继续领取任务。
- 输出写入前检查同名文件，默认拒绝覆盖；工作流用稳定命名和报告文件保存状态。

## 已知限制

- 兼容接口的实际参数支持度由服务端决定；插件会传递标准字段，但服务端可能拒绝某些模型、尺寸或质量值。
- FHL Responses 适配器不支持 mask；OpenAI Images 的 URL 响应需要可访问的下载地址。
- Worker 冷却和重试是进程内状态，进程退出后不会保留。
- 当前实现使用 Node.js 内置 `fetch`、`FormData` 与文件系统 API，因此要求 Node.js 20 或更新版本。

## 变更历史

| 日期 | 版本 | 变更 |
| --- | --- | --- |
| 2026-07-12 | 0.1.0 | 创建双适配器、多 Profile、多 Worker 的 Codex 图像工作流插件。 |
