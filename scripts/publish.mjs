#!/usr/bin/env node
/**
 * Publish DSH Cowork to npm in dependency order.
 *
 * Usage:  node scripts/publish.mjs [--dry-run]
 *
 * Order matters: `@dsh-cowork/plugin`, `@dsh-cowork/mcp`, and
 * `@dsh-cowork/cli` all depend on `@dsh-cowork/core`, so core goes first.
 * `@dsh-cowork/chatnode-wechat` has no workspace deps and publishes anywhere.
 * Requires: logged into npm as the account that owns the @dsh-cowork scope
 * (see docs/shipping.md).
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const dryRun = process.argv.includes('--dry-run')

const order = ['core', 'dsh', 'mcp', 'cli', 'chatnode-wechat']

for (const pkg of order) {
  const dir = join(root, 'packages', pkg)
  const name = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name
  console.log(`\n==> publishing ${name} ${dryRun ? '(dry run)' : ''}`)
  // --no-git-checks: the repo may carry local-only WIP commits (chatnode-wechat)
  // that must not be pushed yet; the packed content is built from the working tree.
  const args = ['publish', '--access', 'public', '--no-git-checks']
  if (dryRun) args.push('--dry-run')
  try {
    const out = execFileSync('pnpm', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    console.log(out.split('\n').filter((l) => /published|tarball|Publishing|npm notice.*(total|size)/i.test(l)).join('\n') || 'ok')
  } catch (error) {
    const e = error
    console.error(String(e.stderr ?? e.stdout ?? error).slice(0, 2000))
    console.error(`publish of ${name} failed — stopping (fix, then re-run; already-published packages are skipped by npm).`)
    process.exit(1)
  }
}

console.log('\nAll packages published. Next steps: see docs/shipping.md (GitHub topic, awesome-list, Discussions).')
