# Shipping DSH Cowork

Delivery channel: **GitHub** (https://github.com/Jesse-njx/dsh-cowork, public,
`dsh-plugin` topic). npm publishing is **not** currently planned — users
install from a clone of this repo.

## Status

- ✅ Codebase: 63 tests green (core 35, plugin 15, mcp 7, cli 6); builds clean.
- ✅ Live verification: `doc_read` / guarded `doc_write` round-trip in a real
  DSH headless agent session, including via packed-tarball install.
- ✅ GitHub repo live under Jesse-njx, topics `dsh-plugin` / `deepseek-harness`
  / `mcp` / `office-documents`.
- ✅ Awesome-list PR: https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/3
- ✅ Discussions post: https://github.com/deepseek-ai/deepseek-harness/discussions/350
- ✅ CI: `.github/workflows/ci.yml` (build + tests on push/PR).

## Install (users)

```sh
git clone https://github.com/Jesse-njx/dsh-cowork.git
cd dsh-cowork
dsh plugin --profile <your-profile> add ./packages/dsh
```

Or use the MCP server / CLI for non-DSH harnesses:

```sh
# MCP (Codex / Claude Code): point the server at
# <clone>/packages/mcp/lib/index.js (cwd = your working dir)
# CLI
doc-read report.xlsx --sheets Data --rows 50
```

## Publish to npm (only if ever wanted)

The `scripts/publish.mjs` script is ready (core → plugin → mcp → cli,
`--no-git-checks`). It currently requires an account whose publish 2FA is
satisfiable (`npm publish --otp <code>`, a bypass-2FA granular token, or
auth-only 2FA). Not required for the GitHub-delivery model.

## Follow-ups (v2)

- docx/pptx generation, PDF form-fill (pdf-lib), PDF page-render-to-image for
  vision models, docx raw-OOXML edit.
- `packages/chatnode-wechat` is owned by a separate session; leave untracked.
