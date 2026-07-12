---
name: "image-workflow"
description: "当用户要通过可配置的 OpenAI 兼容 Images API 或 Responses API 生成、编辑、批量生成、批量编辑或批量图生图时使用。支持多 Profile 和多 Worker 调度。"
---

# Image Workflow

当用户需要真实的位图文件时，使用本插件，不要将请求改写成 HTML 预览或占位图。插件的命令入口相对于本 Skill 文件固定为 `../../scripts/image-workflow.mjs`；在实际执行前先解析 Skill 所在目录得到绝对路径，再调用该脚本。

PowerShell 示例：

```powershell
$skillDir = "<本 SKILL.md 所在目录的绝对路径>"
$script = Resolve-Path (Join-Path $skillDir "..\..\scripts\image-workflow.mjs")
node $script status
```

## 先检查配置

每次触发本 Skill，先执行 `status`。它只显示 Profile、Worker 状态和默认参数，不显示完整 API Key。

- 没有活动 Profile 时，向用户索要 adapter、Base URL 和 API Key，再创建 Profile。
- `openai-images` 用于 OpenAI 兼容 `/images/generations` 与 `/images/edits` 接口。
- `fhl-responses` 用于兼容 `/responses` 的图像生成工具流。
- 一个 Profile 最多有 10 个 Worker；并行任务可分发给同一 Profile 的不同 Worker，绝不跨 Profile 使用 API Key。

```powershell
node $script profile add --id relay --adapter openai-images --base-url "https://example.com/v1" --model "gpt-image-2" --size "auto" --quality "medium" --n 1 --output-format png
node $script worker add --profile relay --worker-id default --name default --api-key "<API_KEY>"
node $script profile use --profile relay
node $script status
```

Profile 与 Worker 管理命令：

```powershell
node $script profile list
node $script profile show --profile relay
node $script profile update --profile relay --model "gpt-image-2" --quality high
node $script worker add --profile relay --worker-id worker-2 --name "备用" --api-key "<API_KEY>"
node $script worker list --profile relay
node $script worker disable --profile relay --worker worker-2
node $script worker set-key --profile relay --worker worker-2 --api-key "<NEW_API_KEY>"
```

## 生成与编辑

常规文生图使用 `generate`。`--count` 创建多条可调度任务；`--n` 是单个 OpenAI Images 请求的图片数，因此 OpenAI Images 的理论输出数是 `count × n`。FHL Responses 每个请求固定生成一张图，扩展数量时使用 `--count`。

```powershell
node $script generate --prompt "简洁的陶瓷咖啡杯产品图，柔和棚拍光线" --count 3 --concurrency 3 --out-dir "output\image-workflow"
node $script generate --prompt-file ".\prompt.txt" --size "1536x1024" --quality high --output-format webp
node $script generate --batch ".\prompts.json" --concurrency 4
node $script generate --batch-inline "一只橙色猫" "一辆复古自行车" --dry-run
```

批量提示词 JSON 支持字符串数组或 `{ "prompts": [...] }`。数组项可以是字符串，也可以是带 `prompt` 字段的对象。

编辑已有图像使用 `edit`。不带 `--batch-edit` 的多个 `--image` 是同一条多参考图编辑请求，必须在一个 Worker 上完成。使用 `--batch-edit` 时，每张源图会拆成独立任务并可并行，但不支持 `--mask`。

```powershell
node $script edit --image ".\input.png" --prompt "将背景替换为干净的浅灰摄影棚，同时保留主体" --out ".\output\edited.png"
node $script edit --image ".\input.png" --mask ".\mask.png" --prompt "只替换遮罩区域为新鲜花朵"
node $script edit --batch-edit --image ".\a.png" --image ".\b.png" --prompt "改为统一的电商白底图" --concurrency 2
```

`--mask` 仅适用于 `openai-images` Profile 的单次 `edit`。`fhl-responses`、`--batch-edit` 和工作流都不支持 mask。

通用可选参数包括 `--profile`、`--model`、`--size`、`--quality`、`--n`、`--output-format`、`--background`、`--moderation`、`--output-compression`、`--input-fidelity`、`--out`、`--out-dir`、`--concurrency`、`--no-adaptive`、`--dry-run` 与 `--force`。`--out` 和 `--out-dir` 互斥，工作流仅使用 `--out-dir`。默认启用自适应调度；命令行参数会覆盖 Profile 默认值。

## 通用批量图生图工作流

`workflow batch-edit` 将固定参考图、变量图片目录和提示词模板组合为可续跑任务。先运行 `--dry-run` 确认任务数量。每个变量图片是一组任务，同组模板优先分配给同一个 Worker；已有输出会跳过，失败项会按 `--repair-passes` 补跑。

```powershell
node $script workflow batch-edit --fixed-ref ".\reference\brand.png" --item-dir ".\items" --templates ".\templates.json" --limit 20 --concurrency 4 --dry-run
node $script workflow batch-edit --fixed-ref ".\reference\brand.png" --item-dir ".\items" --template-inline "将变量图片自然放入干净的产品场景，不假设产品类型。" --concurrency 4 --repair-passes 2 --out-dir ".\output\catalog"
```

模板 JSON 支持字符串数组或 `{ "templates": [...] }`。模板对象包含 `key`、可选 `label` 和必填 `prompt`。工作流目录会写入 `manifest.json`、`summary.csv`、`failures.json`、`sessions.json`，并保持稳定的每项目/模板输出路径。

## 输出与报告

默认输出目录是当前工作区下的 `output/image-workflow/`。不要覆盖已有图片，除非用户明确要求并传入 `--force`。单次或小批量成功后，在 Codex 回复中用成功图片的绝对路径 Markdown 图片标签展示结果，例如：

```markdown
![生成结果](C:\absolute\path\result.png)
```

大型工作流不要把所有图片嵌入回复；报告成功/失败数量、工作流输出目录及少量样例即可。

## 可靠性

- `openai-images` 请求默认超时 300 秒、最多重试 5 次。
- `fhl-responses` 请求默认超时 180 秒、最多重试 3 次。
- 429、5xx、网络和超时错误会触发冷却或重试；认证失败只隔离当前 Worker，其他可用 Worker 继续执行。
- 真实请求可能耗时数分钟。命令超时后先检查目标输出目录，避免重复提交已完成的图像任务。
