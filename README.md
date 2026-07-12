# Image Workflow

`image-workflow` 是一个本地 Codex Marketplace 与原生插件。它把可配置的 OpenAI 兼容 Images API 与 Responses API 放在统一的 Profile、Worker 和批处理框架下，用于文生图、图生图、多参考图编辑、mask 编辑和通用批量图生图。

它解决的不是某个固定服务的单次调用，而是需要在多个 API Key、批量任务和可恢复输出之间稳定切换的图像生产流程。

## 能力与边界

- `openai-images` Profile 调用 `/images/generations` 与 `/images/edits`，支持模型、尺寸、质量、`n`、输出格式、背景、审核、压缩度、输入保真度、多参考图和单次编辑的 mask。
- `fhl-responses` Profile 调用 `/responses` 并解析 SSE 图像结果，支持文生图与多参考图编辑。
- 每个 Profile 可配置 1 到 10 个 Worker。任务只会在当前 Profile 的 Worker 间调度；429/5xx、网络异常和超时可重试，认证失败只隔离当前 Worker。
- 支持批量提示词、批量编辑、固定参考图 × 变量图片 × 模板的通用工作流、已有输出跳过和失败补洞。
- 不迁移旧插件配置，不预置任何服务 Profile；工作流与批量编辑不支持 mask。

运行时只依赖 Node.js 内置模块，要求 Node.js 20 或更高版本。

## 安装

此仓库的 Marketplace 位于 [`.agents/plugins/marketplace.json`](.agents/plugins/marketplace.json)。在 Codex 中添加该本地 Marketplace 后，安装 `image-workflow@image-workflow-local`。安装或更新插件后，使用新的 Codex 任务测试 Skill 是否已加载。

开发校验：

```powershell
pnpm --dir .\plugins\image-workflow check
pnpm --dir .\plugins\image-workflow test
python "C:\Users\LYQ\.codex\skills\.system\plugin-creator\scripts\validate_plugin.py" .\plugins\image-workflow
```

## 快速开始

插件配置保存在 `~/.codex/image-workflow/config.json`。它使用明文保存 Profile、默认参数和 Worker API Key；每个 Profile 都有独立的 Worker 池。

```powershell
$script = Resolve-Path ".\plugins\image-workflow\scripts\image-workflow.mjs"

node $script profile add --id relay --adapter openai-images --base-url "https://example.com/v1" --model "gpt-image-2" --size auto --quality medium --n 1 --output-format png
node $script worker add --profile relay --worker-id default --name default --api-key "<API_KEY>"
node $script status
node $script generate --prompt "深色木桌上的陶瓷咖啡杯，真实棚拍光线" --out ".\output\cup.png"
```

命令行参数的优先级高于 Profile 默认值。例如可以临时替换模型、尺寸、质量或输出格式，而不改变保存的 Profile。

## 常用命令

```powershell
# Profile 和 Worker
node $script profile list
node $script profile show --profile relay
node $script profile use --profile relay
node $script worker add --profile relay --worker-id backup --name "备用" --api-key "<API_KEY>"
node $script worker list --profile relay

# 生成与批量提示词
node $script generate --prompt "极简白色耳机产品图" --count 3 --concurrency 3
node $script generate --batch ".\prompts.json" --concurrency 4
node $script generate --batch-inline "一只橙色猫" "一辆城市自行车" --dry-run

# 单次编辑、多参考图与 mask
node $script edit --image ".\input.png" --prompt "替换为浅灰色摄影棚背景"
node $script edit --image ".\person.png" --image ".\product.png" --prompt "将产品自然放入人物手中"
node $script edit --image ".\input.png" --mask ".\mask.png" --prompt "仅修改遮罩区域"

# 每张源图独立的批量编辑
node $script edit --batch-edit --image ".\a.png" --image ".\b.png" --prompt "统一为电商白底图" --concurrency 2
```

## 通用工作流

工作流把一个或多个固定参考图、变量图目录和一组模板组合成任务。模板文件可为字符串数组或以下形式：

```json
{
  "templates": [
    {
      "key": "catalog",
      "label": "目录页",
      "prompt": "将变量图片自然融入干净的产品目录场景，不假设产品类别。"
    },
    {
      "key": "lifestyle",
      "prompt": "依据固定参考图，把变量图片放入适合其特征的生活方式场景。"
    }
  ]
}
```

```powershell
node $script workflow batch-edit --fixed-ref ".\reference\brand.png" --item-dir ".\items" --templates ".\templates.json" --limit 20 --concurrency 4 --dry-run
node $script workflow batch-edit --fixed-ref ".\reference\brand.png" --item-dir ".\items" --templates ".\templates.json" --repair-passes 2 --out-dir ".\output\catalog"
```

工作流会写入 `manifest.json`、`summary.csv`、`failures.json` 与 `sessions.json`。输出已存在时会被识别为完成项；默认会额外执行一轮修复任务，可用 `--no-repair` 或 `--repair-passes` 调整。

## 输出和验证

默认输出路径是当前工作区的 `output/image-workflow/`。使用 `--out` 指定单一图片，或用 `--out-dir` 指定批量输出目录，二者不能同时使用；工作流仅接受 `--out-dir`。不加 `--force` 时不会覆盖已存在的文件。

```powershell
node $script generate --prompt "测试图像" --dry-run
node --check .\plugins\image-workflow\scripts\image-workflow.mjs
pnpm --dir .\plugins\image-workflow check
pnpm --dir .\plugins\image-workflow test
```

详见 [设计文档](DESIGN.md) 和插件内的 [Skill 使用说明](plugins/image-workflow/skills/image-workflow/SKILL.md)。
