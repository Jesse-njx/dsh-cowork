# Shipping DSH Cowork

Everything in this doc is prepared; each step needs your accounts (npm /
GitHub). Do them in order.

## 0. Preflight (verified locally)

- `pnpm -r test` — 63 tests green (core 35, plugin 15, cli 6, mcp 7).
- `pnpm pack` all four packages: manifests rewrite `workspace:^` → `^0.1.0`,
  `cordis.patch.yml` + `lib/` included, `SKILL.md` included.
- Packed tarballs install together in a scratch consumer (npm, with an
  override standing in for the not-yet-published core) and run: the CLI reads
  a real docx; the MCP server completes the stdio handshake and advertises
  `doc_read` / `doc_write`.
- **Published-path simulation**: the packed plugin tarball installs into a DSH
  headless profile and a live agent session completes a guarded
  `doc_read → doc_write → doc_read` round-trip on a real xlsx.
- **Dependency pattern**: `@deepseek-ai/*` packages are declared as
  `peerDependencies` (the ecosystem convention, e.g. dsh-kb-sieve). Declaring
  them as regular deps makes pnpm install duplicate copies into profiles,
  which breaks tool dispatch (symbol-keyed scheduler mismatch → `reading
  'prepare'`). Only `@dsh-cowork/core` is a regular dependency — it is pure TS
  and carries no cordis state.

## 1. Publish to npm

Prerequisites: an npm account with access to the `@dsh-cowork` scope
(`npm login`). If the scope isn't yours yet, create it — npm auto-creates
unclaimed scopes on first publish (`--access public`).

```sh
node scripts/publish.mjs --dry-run   # preview
node scripts/publish.mjs             # core → plugin → mcp → cli
```

Order matters (plugin/mcp/cli depend on core). The script stops on failure;
re-run to continue (npm skips already-published versions).

## 2. Live DSH verification

With a real provider configured (your DSH web profile):

```sh
dsh plugin --profile web add @dsh-cowork/plugin   # or your profile name
```

Then in a session: ask the model to `doc_read` an `.xlsx`, then `doc_write`
a cell edit, then `doc_read` again to verify. Expected: addressed markdown
windows, `> Truncated:` notices on large files, `[sandbox: write denied]` in
read-only mode.

## 3. GitHub repo

```sh
git remote add origin git@github.com:<you>/dsh-cowork.git
git push -u origin main
```

Repo settings:

- **Topics**: `dsh-plugin` (required by deepseek-harness CONTRIBUTING.md)
  plus `deepseek-harness`, `mcp`, `office-documents`, `plugin`.
- **Description**: "READ + WRITE for office documents & notebooks in
  DeepSeek Harness — doc_read/doc_write tools (xlsx, pdf, docx, pptx, ipynb)".

## 4. Awesome list PR

Repo: https://github.com/awesome-dsh-plugin/awesome-dsh-plugin
Add one line under **🛠️ Tools & Capabilities** in both `README.md` and
`README.zh.md`:

English (README.md):

```md
- [dsh-cowork](https://github.com/<you>/dsh-cowork) — doc_read/doc_write: bounded, cell-addressed reading and editing of xlsx / pdf / docx / pptx / ipynb, plus an MCP server and CLI.
```

Chinese (README.zh.md, adjust to the actual zh category heading):

```md
- [dsh-cowork](https://github.com/<you>/dsh-cowork) — doc_read/doc_write：以有界、单元格寻址的方式读取与编辑 xlsx / pdf / docx / pptx / ipynb，附 MCP 服务器与 CLI。
```

## 5. Discussions post

Post on https://github.com/deepseek-ai/deepseek-harness/discussions (the
ecosystem channel CONTRIBUTING.md points at):

```md
# DSH Cowork — native office-document & notebook reading/writing for DSH

`dsh plugin add @dsh-cowork/plugin` gives your agent `doc_read` / `doc_write`:

- **Read**: xlsx (cell-addressed windows), pdf (pages), docx, pptx (shape ids), ipynb (cells + outputs)
- **Write (v1)**: create/edit xlsx by cell ref; create/edit ipynb by cell index
- **Safety**: zip-bomb caps, macro-format rejection, read-only mode gating,
  hash-checked edits, atomic writes, explicit truncation notices

Also ships as an **MCP server** (for Codex / Claude Code) and a **CLI +
SKILL.md** (for pi). Repo tagged `dsh-plugin`. Feedback welcome!
```

## 6. Follow-ups (v2)

- docx/pptx generation, PDF form-fill (pdf-lib), PDF page-render-to-image for
  vision models, docx raw-OOXML edit.
