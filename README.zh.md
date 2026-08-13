# DSH Cowork

**在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 中读写 Office 文档与 Jupyter Notebook——以及其他任何你的 Agent 运行的地方。**

DSH Cowork 为编码 Agent 提供了一流的文档处理能力：

| 格式 | 读取（Read） | 写入（Write, v1） |
| --- | --- | --- |
| **xlsx** 电子表格 | ✅ 有界、按单元格寻址的窗口 | ✅ 按单元格引用新建 / 编辑 |
| **ipynb** 笔记本 | ✅ 单元格 + 内联输出 | ✅ 按单元格下标新建 / 编辑 |
| **pdf** | ✅ 文本窗口（`pages`） | —（v2：表单填写） |
| **docx** | ✅ 段落 + 字数统计 | —（v2：生成） |
| **pptx** | ✅ 幻灯片 + 形状 id | —（v2：生成） |

English version: [README.md](README.md).

## 为什么做这个

DeepSeek Harness 内置的 `read` 只支持 UTF-8 文本——它打不开电子表格、PDF、
幻灯片或笔记本。Claude Code 原生支持 PDF 和笔记本；Codex 则什么都没有。
DSH Cowork 以**仓库外插件**的方式补齐了这个缺口（无需 fork、无需 PR——
这正是 CONTRIBUTING.md 推荐的生态路径）。

"Cowork = READ + WRITE" 之所以是一个整体而非两个孤立工具，靠两个设计：

1. **稳定地址（stable addresses）。** `doc_read` 返回 xlsx 的**单元格引用**
   （`A1`、`C12`）和 pptx 的**形状 id**，`doc_write` 直接消费这些地址。
   行号无法寻址二进制格式，地址可以。
2. **有界窗口 + 显式截断。** 每次读取都有上限（页 / 行 / 幻灯片 / 单元格 /
   字节）。静默截断是最大的罪过：窗口被截断时一定会出现 `> Truncated:` 提示。

## 包结构

| 包 | 作用 |
| --- | --- |
| `packages/core` | 纯 TS、零 DSH 依赖：嗅探 → 抽取 → 构建、窗口化、安全上限 |
| `packages/dsh` | **DSH 插件包**：`doc_read` / `doc_write` 工具（`dsh plugin add` 安装） |
| `packages/mcp` | **MCP 服务器**（stdio）——供 Codex、Claude Code 及任意 MCP 客户端使用 |
| `packages/cli` | `doc-read` / `doc-write` 命令行 + `SKILL.md`（`pi` harness 适配） |

## 安装到 DeepSeek Harness

```sh
# 从仓库克隆后安装（当前分发方式：GitHub，不发布到 npm）
git clone https://github.com/Jesse-njx/dsh-cowork.git
cd dsh-cowork
pnpm install          # installs deps and builds all packages (prepare)
dsh plugin --profile <你的profile> add ./packages/dsh
```

之后模型即可使用 `doc_read` / `doc_write`（可用一个真实会话验证：让模型
`doc_read` 一个 `.xlsx` 文件）。

可选配置（均有合理默认值）：

```yaml
# 在 profile 的 cordis.patch.yml 中覆盖 cowork-docs 行
- id: cowork-docs
  name: '@dsh-cowork/plugin'
  config:
    maxInputBytes: 67108864
    maxOutputBytes: 262144
    maxDecompressedBytes: 536870912   # zip 炸弹防护
    maxZipEntries: 4096
    maxPages: 20
    maxSheetRows: 200
    maxSheets: 1
    maxSlides: 20
    maxCells: 200
```

## 供任意 Agent 使用（MCP / CLI）

```sh
# Codex / Claude Code 的 MCP 配置示例
# { "mcpServers": { "cowork": { "command": "node", "args": ["<repo>/packages/mcp/lib/index.js"], "cwd": "<工作目录>" } } }
```

```sh
doc-read report.xlsx --sheets Data --rows 50
doc-write edit report.xlsx --spec edit-spec.json
```

## 安全模型

- **Zip 炸弹**：所有 OOXML 归档在解压前先检查条目数与解压后大小上限。
- **宏文件**：`.xlsm` / `.docm` / `.pptm`（含 `vbaProject.bin` 者）一律拒绝
  ——Cowork 从不读写宏格式。
- **只读模式**：沙箱处于 `read-only` 时，`doc_write` 被硬性禁止，
  `doc_read` 照常可用。
- **编辑防护**：`doc_write` 编辑前必须已在本会话读取过该文件
  （`expected_version`），并可选用内容哈希校验（`expected_sha256`）——每次
  编辑都是一次哈希检查。
- **禁止静默覆盖**：覆盖已存在文件需要先读取过（DSH）或显式 `force`
  （CLI / MCP）。
- **原子写入**：临时文件 + 重命名，绝不留下半成品目标文件。
- **过期公式**：被编辑的 xlsx 工作表会清除缓存的公式结果，让
  Excel / LibreOffice 打开时重新计算（exceljs 本身不重算）。
- **不可信输入**：公式、隐藏工作表、演讲者备注一律视为数据，随抽取结果
  呈现，绝不执行。

## 架构

```
                   ┌──────────────────────────────────────────────┐
                   │                @dsh-cowork/core              │
                   │  sniff → readDocument / writeDocument → caps │
                   └───────┬──────────────┬──────────────┬────────┘
                           │              │              │
                ┌──────────▼───┐  ┌───────▼──────┐  ┌────▼───────┐
                │  packages/dsh│  │ packages/mcp │  │ packages/cli│
                │ DSH 插件包   │  │ MCP stdio    │  │ + SKILL.md │
                └──────────────┘  └──────────────┘  └────────────┘
```

DSH 插件包的读取走 `ctx.fs`（有界 `readBytes`、沙箱感知的路径解析、
`fs/observed` 事件）；由于 fs 服务只支持文本写入，字节写入由插件自行完成
（临时文件 + 原子重命名），并在写入后重新观察真实版本号，使内置策略机制
保持一致。

## 开发

```sh
pnpm install
pnpm -r build
pnpm -r test      # core 35 + plugin 15 + cli 6 + mcp 7
```

- 测试夹具：`node packages/core/scripts/make-fixtures.mjs`（PDF 需要 macOS
  `cupsfilter`，否则跳过）。
- Node 20+；测试使用 Node 原生 TS type-stripping。

## 路线图

- **v1（本仓库）**：读取全部五种格式；写入 xlsx + ipynb。
- **v2**：ipynb 写入打磨、docx/pptx *生成*、PDF 表单填写（pdf-lib）、
  面向视觉模型的 PDF 页面渲染为图片、docx 原生 OOXML 编辑。
- **发布**：`dsh-plugin` GitHub 主题、awesome-list 条目、Discussions 帖子。

## 贡献

本项目使用 `dsh-plugin` 主题。欢迎提交 Issue、PR 与 Discussion——同时，
按照 [deepseek-harness CONTRIBUTING.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/CONTRIBUTING.md)，
你自己的插件也请打上 `dsh-plugin` 主题。
