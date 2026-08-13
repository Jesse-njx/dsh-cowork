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
- ✅ `packages/chatnode-wechat` (WeChat conversation node): 35 tests green
  against a fake iLink server (gateway + full inbound→session→outbound loop),
  typecheck + build clean, `pnpm publish --dry-run` clean, tagged `v0.1.0`.
  Publish to npm with `node scripts/publish.mjs` (order now includes
  `chatnode-wechat`).

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

## Publish to npm

The `scripts/publish.mjs` script is ready (core → plugin → mcp → cli →
chatnode-wechat, `--no-git-checks`). It currently requires an account whose
publish 2FA is satisfiable (`npm publish --otp <code>`, a bypass-2FA granular
token, or auth-only 2FA). The GitHub-delivery model for the office-document
packages does not need it; `@dsh-cowork/chatnode-wechat` is npm-publishable
as-is (see Status).

## Follow-ups (v2)

- docx/pptx generation, PDF form-fill (pdf-lib), PDF page-render-to-image for
  vision models, docx raw-OOXML edit.
- chatnode-wechat v0.2: images/files both directions, outbound voice replies;
  v0.3: group chats, multi-account, shared-poller coexistence proxy.
