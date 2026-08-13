# Shipping DSH Cowork

Status: GitHub repo live ([Jesse-njx/dsh-cowork](https://github.com/Jesse-njx/dsh-cowork),
`dsh-plugin` topic set), awesome-list [PR #3](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/3)
open, Discussions [post #350](https://github.com/deepseek-ai/deepseek-harness/discussions/350) live.
**npm publish is BLOCKED on the account's 2FA** (403: publish requires a
one-time password or a bypass-2FA token).

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

## 1. Publish to npm — BLOCKED on 2FA

`npm whoami` → `jessenjx` (logged in), but publishing returns
`403 Forbidden … Two-factor authentication … is required`. The `@dsh-cowork`
scope is unclaimed; the first publish will claim it.

Unblock ONE of these (user action):
- `npm publish --otp <code>` per package (OTP from your authenticator), or
- npm web → Access Tokens → generate a **granular token with bypass 2FA**
  enabled and put it in `~/.npmrc`, or
- temporarily switch the account's 2FA to **auth-only** in npm settings.

Then publish:

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

## 3. GitHub repo — DONE

https://github.com/Jesse-njx/dsh-cowork (public, main pushed).
Topics set: `dsh-plugin`, `deepseek-harness`, `mcp`, `office-documents`.
Local WIP (`chatnode-wechat`, the WeChat bridge) is preserved on the local
branch `wip/chatnode-wechat` — finish it, then push it when ready.

## 4. Awesome list PR — DONE

https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/3 (adds the entry
under 🛠️ Tools & Capabilities in both README.md and README.zh.md).

## 5. Discussions post — DONE

https://github.com/deepseek-ai/deepseek-harness/discussions/350 (Show and tell).

## 6. chatnode-wechat (user WIP, NOT shipped)

Preserved on disk + local branch `wip/chatnode-wechat`. Status (round 3):
typecheck **passes**, build **passes**, gateway tests **18/18 pass** (iLink
polling, dedup, retry, circuit breaker, QR login, CDN media decryption,
SSRF guard). Conversation-node tests: **4 failing + the `node --test` process
hangs on exit** (cordis contexts never disposed in afterEach). Node-layer
features mid-flight: outbound digest, chunking, /sessions /use, /new,
approval round trip, heartbeat. Finish those, then commit + push + publish as
the 5th package.

## 7. Follow-ups (v2)

- docx/pptx generation, PDF form-fill (pdf-lib), PDF page-render-to-image for
  vision models, docx raw-OOXML edit.
