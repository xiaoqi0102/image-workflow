# Image Workflow 插件

本目录是 `image-workflow` 的原生 Codex 插件包，提供可配置的 OpenAI 兼容 Images API 与 FHL Responses API 图像生成、编辑和批量工作流。

## 使用方式

从插件根目录执行：

```powershell
node .\scripts\image-workflow.mjs status
node .\scripts\image-workflow.mjs profile add --id relay --adapter openai-images --base-url "https://example.com/v1"
node .\scripts\image-workflow.mjs worker add --profile relay --worker-id default --api-key "<API_KEY>"
node .\scripts\image-workflow.mjs generate --prompt "产品展示图" --out-dir ".\output"
```

完整安装、Profile、Worker、mask、批量和工作流示例见仓库根目录的 [README](../../README.md)。

## 模块

- `src/adapters/`：OpenAI Images 与 FHL Responses 协议实现。
- `src/config/`：明文 Profile 和 Worker 配置存储。
- `src/domain/`：调度、任务输出和可续跑工作流。
- `src/cli/`：命令行参数和命令实现。
- `test/`：本地 mock 测试。

运行 `pnpm check` 和 `pnpm test` 验证插件。
