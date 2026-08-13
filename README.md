# DSH Cowork

**READ + WRITE for office documents and Jupyter notebooks inside
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — and
anywhere else your agent runs.**

DSH Cowork adds first-class document handling to coding agents:

| Format | Read | Write (v1) |
| --- | --- | --- |
| **xlsx** spreadsheets | ✅ bounded, cell-addressed windows | ✅ create + edit by cell ref |
| **ipynb** notebooks | ✅ cells + inline outputs | ✅ create + edit by cell index |
| **pdf** | ✅ text windows (`pages`) | — (v2: form-fill) |
| **docx** | ✅ paragraphs + word count | — (v2: generation) |
| **pptx** | ✅ slides + shape ids | — (v2: generation) |

**中文版见 [README.zh.md](README.zh.md).**

## Why

DeepSeek Harness's built-in `read` is UTF-8 text only — it cannot open a
spreadsheet, a PDF, a slide deck, or a notebook. Claude Code reads PDFs and
notebooks natively; Codex has nothing. DSH Cowork closes that gap as an
out-of-tree plugin (no fork, no PR needed — the ecosystem path
CONTRIBUTING.md recommends).

Two ideas make "Cowork = READ + WRITE" coherent instead of two separate
tools:

1. **Stable addresses.** `doc_read` returns *cell refs* for xlsx (`A1`, `C12`)
   and *shape ids* for pptx — `doc_write` consumes them. Line numbers cannot
   address binary formats; addresses can.
2. **Bounded windows, explicit truncation.** Every read is capped
   (pages / rows / slides / cells / bytes). Silent truncation is the cardinal
   sin: a `> Truncated:` notice always tells you the window was cut short.

## Packages

| Package | What it is |
| --- | --- |
| `packages/core` | Pure TS, zero DSH deps: sniff → extract → build, windowing, safety caps |
| `packages/dsh` | **DSH bundle**: `doc_read` / `doc_write` tools (install with `dsh plugin add`) |
| `packages/mcp` | **MCP server** over stdio — for Codex, Claude Code, any MCP client |
| `packages/cli` | `doc-read` / `doc-write` binaries + `SKILL.md` (the `pi` harness adapter) |
| `packages/chatnode-wechat` | **DSH bundle**: chat with / monitor / approve your DSH agents from WeChat (iLink gateway + conversation node) |

## Install into DeepSeek Harness

```sh
# GitHub delivery (not published to npm)
git clone https://github.com/Jesse-njx/dsh-cowork.git
cd dsh-cowork
pnpm install          # installs deps and builds all packages (prepare)
dsh plugin --profile <your-profile> add ./packages/dsh
```

Then `doc_read` / `doc_write` are available to the model. (A live agent
session also verifies: ask the model to `doc_read` an `.xlsx`.)

Configure (all optional, sensible defaults):

```yaml
# in your profile's cordis.patch.yml, override the cowork-docs row
- id: cowork-docs
  name: '@dsh-cowork/plugin'
  config:
    maxInputBytes: 67108864      # 64 MiB
    maxOutputBytes: 262144       # 256 KiB model-facing window
    maxDecompressedBytes: 536870912  # zip-bomb guard (512 MiB)
    maxZipEntries: 4096
    maxPages: 20
    maxSheetRows: 200
    maxSheets: 1
    maxSlides: 20
    maxCells: 200
```

## Use from any agent (MCP)

```sh
# Codex / Claude Code MCP config
# { "mcpServers": { "cowork": { "command": "node", "args": ["<repo>/packages/mcp/lib/index.js"], "cwd": "<your working dir>" } } }
```

```sh
# or the plain CLI
doc-read report.xlsx --sheets Data --rows 50
doc-write edit report.xlsx --spec edit-spec.json
```

## Safety model

- **Zip bombs**: entry-count + decompressed-size caps on every OOXML archive,
  checked before any codec expands bytes.
- **Macros**: `.xlsm` / `.docm` / `.pptm` (anything with `vbaProject.bin`) are
  rejected outright — Cowork never reads or writes macro formats.
- **Read-only mode**: in `read-only` sandbox mode, `doc_write` is hard-blocked
  while `doc_read` stays available.
- **Edit guards**: `doc_write` edit refuses unless the file was read this
  session (`expected_version`), and optionally fails on content change
  (`expected_sha256`) — a hash-check on every edit.
- **No silent overwrite**: creating over an existing file requires having read
  it (DSH) or `force` (CLI/MCP).
- **Atomic writes**: temp file + rename, never a partial target.
- **Stale formulas**: edited xlsx sheets get cached formula results cleared so
  Excel / LibreOffice recalculate on open (exceljs never recalculates).
- **Untrusted input**: formulas, hidden sheets, and speaker notes are treated
  as data, surfaced with the extraction, never executed.

## Architecture

```
                   ┌──────────────────────────────────────────────┐
                   │                @dsh-cowork/core              │
                   │  sniff → readDocument / writeDocument → caps │
                   └───────┬──────────────┬──────────────┬────────┘
                           │              │              │
                ┌──────────▼───┐  ┌───────▼──────┐  ┌────▼───────┐
                │  packages/dsh│  │ packages/mcp │  │ packages/cli│
                │ DSH bundle   │  │ MCP stdio    │  │ + SKILL.md │
                └──────────────┘  └──────────────┘  └────────────┘
```

The DSH bundle routes reads through `ctx.fs` (bounded `readBytes`,
sandbox-aware resolution, `fs/observed` events) and performs atomic byte
writes itself because the fs service is text-only — re-observing the real
post-write version so the built-in policy machinery stays coherent.

## Development

```sh
pnpm install
pnpm -r build
pnpm -r test      # core 35 + plugin 15 + cli 6 + mcp 7 tests
```

- Fixtures: `node packages/core/scripts/make-fixtures.mjs` (needs macOS
  `cupsfilter` for the PDF; skip otherwise).
- Node 20+; tests run on Node's native TS type-stripping.

## Roadmap

- **v1 (this repo)**: read all five formats; write xlsx + ipynb.
- **v2**: ipynb write polish, docx/pptx *generation*, PDF form-fill
  (pdf-lib), PDF page-render-to-image for vision models, docx raw-OOXML edit.
- **Ship**: `dsh-plugin` GitHub topic, awesome-list entry, Discussions post.

## Contributing

This is a `dsh-plugin`-topic project. Issues, PRs, and Discussions welcome —
and per [deepseek-harness CONTRIBUTING.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/CONTRIBUTING.md),
associate your own plugins with the `dsh-plugin` topic too.
