/**
 * End-to-end plugin tests: real Cordis + SystemPrompt + ToolRuntime + the real
 * LocalFileSystem backend, with @dsh-cowork/plugin mounted. Exercises the full
 * doc_read / doc_write pipeline through `ctx.tools.execute`.
 */

import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolResult } from '@deepseek-ai/dsh-tools'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import { CallId } from '@deepseek-ai/dsh-llm'
import { mkdtempSync, rmSync, copyFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as Cowork from '../src/index.ts'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'test', 'fixtures')
const signal = new AbortController().signal

let dir: string
let ctx: Context

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-cowork-test-'))
  ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LocalFileSystem, { cwd: dir })
  await ctx.plugin(Cowork)
})

afterEach(async () => {
  rmSync(dir, { recursive: true, force: true })
})

let callCounter = 0
function call(name: string, args: unknown, agent?: object) {
  return ctx.tools.execute({
    signal,
    callId: CallId(`call-${++callCounter}`),
    name,
    arguments: args,
    ...(agent !== undefined ? { agent: agent as never } : {}),
  })
}

function text(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
}

function withCwd(): object {
  // `events` is read by the sandbox-policy service (session-mode fold); empty
  // = no override, so the deployment default applies.
  return { session: { id: 's-test', header: { cwd: dir }, events: [] } }
}

function copyFixture(name: string): void {
  copyFileSync(join(fixtures, name), join(dir, name))
}

function footerOf(textContent: string): { sha256: string; version: string } {
  const m = /sha256=([0-9a-f]+) version=([^\s]+)/.exec(textContent)
  assert.ok(m, `footer missing in: ${textContent.slice(-200)}`)
  return { sha256: m[1]!, version: m[2]! }
}

test('registers doc_read and doc_write', async () => {
  const names = ctx.tools.schemas().map((s) => s.name).sort()
  assert.ok(names.includes('doc_read'))
  assert.ok(names.includes('doc_write'))
})

test('doc_read: xlsx with addresses and footer guards', async () => {
  copyFixture('sample.xlsx')
  const result = await call('doc_read', { file_path: 'sample.xlsx' }, withCwd())
  assert.equal(result.isError, false, text(result))
  const t = text(result)
  assert.ok(t.includes('| A2 | Widget |'), t.slice(0, 400))
  assert.ok(t.includes('## Sheet: Data'))
  const footer = footerOf(t)
  assert.match(footer.sha256, /^[0-9a-f]{64}$/)
  assert.ok(footer.version.length > 0)
})

test('doc_read: all five formats', async () => {
  const cases: Array<[string, string]> = [
    ['sample.xlsx', 'Widget'],
    ['sample.pdf', 'Hello from DSH Cowork pdf fixture'],
    ['sample.docx', 'Hello from DSH Cowork docx fixture'],
    ['sample.pptx', 'Slide One Title'],
    ['sample.ipynb', 'x = 6 * 7'],
  ]
  for (const [file, expect] of cases) {
    copyFixture(file)
    const result = await call('doc_read', { file_path: file }, withCwd())
    assert.equal(result.isError, false, `${file}: ${text(result)}`)
    assert.ok(text(result).includes(expect), `${file} should contain ${JSON.stringify(expect)}`)
  }
})

test('doc_read: missing file reports not-found', async () => {
  const result = await call('doc_read', { file_path: 'nope.xlsx' }, withCwd())
  assert.equal(result.isError, true)
  assert.ok(text(result).includes('not found'))
})

test('doc_read: macro formats are rejected', async () => {
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.ms-excel.sheet.macroEnabled.main+xml"/></Types>')
  zip.file('xl/vbaProject.bin', new Uint8Array([1, 2, 3]))
  const buf = await zip.generateAsync({ type: 'nodebuffer' })
  const target = join(dir, 'evil.xlsm')
  const { writeFileSync } = await import('node:fs')
  writeFileSync(target, buf)
  const result = await call('doc_read', { file_path: 'evil.xlsm' }, withCwd())
  assert.equal(result.isError, true)
  assert.ok(text(result).toLowerCase().includes('macro'))
})

test('doc_write: create xlsx and read it back', async () => {
  const result = await call('doc_write', {
    file_path: 'fresh.xlsx',
    format: 'xlsx',
    operation: 'create',
    sheets: [{ name: 'S1', cells: [{ ref: 'A1', value: 'hello' }, { ref: 'B1', value: 42 }] }],
  }, withCwd())
  assert.equal(result.isError, false, text(result))
  assert.ok(existsSync(join(dir, 'fresh.xlsx')))

  const read = await call('doc_read', { file_path: 'fresh.xlsx' }, withCwd())
  const t = text(read)
  assert.ok(t.includes('| A1 | hello |'))
  assert.ok(t.includes('| B1 | 42 |'))
})

test('doc_write: create ipynb and read it back', async () => {
  const result = await call('doc_write', {
    file_path: 'nb.ipynb',
    format: 'ipynb',
    operation: 'create',
    cells: [{ type: 'markdown', source: '# Hi' }, { type: 'code', source: 'print(2)' }],
  }, withCwd())
  assert.equal(result.isError, false, text(result))
  const read = await call('doc_read', { file_path: 'nb.ipynb' }, withCwd())
  const t = text(read)
  assert.ok(t.includes('# Hi'))
  assert.ok(t.includes('print(2)'))
})

test('doc_write: edit with guards from the read footer', async () => {
  copyFixture('sample.xlsx')
  const read = await call('doc_read', { file_path: 'sample.xlsx' }, withCwd())
  const { sha256, version } = footerOf(text(read))

  const edit = await call('doc_write', {
    file_path: 'sample.xlsx',
    format: 'xlsx',
    operation: 'edit',
    edits: [{ sheet: 'Data', ref: 'A2', value: 'Widget X' }],
    expected_version: version,
    expected_sha256: sha256,
  }, withCwd())
  assert.equal(edit.isError, false, text(edit))

  const reread = await call('doc_read', { file_path: 'sample.xlsx' }, withCwd())
  assert.ok(text(reread).includes('Widget X'))
})

test('doc_write: stale edit fails closed', async () => {
  copyFixture('sample.xlsx')
  const read = await call('doc_read', { file_path: 'sample.xlsx' }, withCwd())
  const { sha256 } = footerOf(text(read))

  const edit = await call('doc_write', {
    file_path: 'sample.xlsx',
    format: 'xlsx',
    operation: 'edit',
    edits: [{ sheet: 'Data', ref: 'A2', value: 'Nope' }],
    expected_version: 'wrong-version',
    expected_sha256: sha256,
  }, withCwd())
  assert.equal(edit.isError, true)
  assert.ok(text(edit).includes('changed since it was read'))
})

test('doc_write: content hash mismatch fails closed', async () => {
  copyFixture('sample.xlsx')
  const read = await call('doc_read', { file_path: 'sample.xlsx' }, withCwd())
  const { version } = footerOf(text(read))

  const edit = await call('doc_write', {
    file_path: 'sample.xlsx',
    format: 'xlsx',
    operation: 'edit',
    edits: [{ sheet: 'Data', ref: 'A2', value: 'Nope' }],
    expected_version: version,
    expected_sha256: '0'.repeat(64),
  }, withCwd())
  assert.equal(edit.isError, true)
  assert.ok(text(edit).includes('sha256 mismatch'))
})

test('doc_write: create refuses to overwrite an unread file', async () => {
  copyFixture('sample.xlsx')
  const result = await call('doc_write', {
    file_path: 'sample.xlsx',
    format: 'xlsx',
    operation: 'create',
    sheets: [{ name: 'S1', cells: [{ ref: 'A1', value: 'clobber' }] }],
  }, withCwd())
  assert.equal(result.isError, true)
  assert.ok(text(result).includes('refusing to overwrite'))
})

test('doc_write: edit of a missing file reports not-found', async () => {
  const result = await call('doc_write', {
    file_path: 'ghost.xlsx',
    format: 'xlsx',
    operation: 'edit',
    edits: [],
  }, withCwd())
  assert.equal(result.isError, true)
  assert.ok(text(result).includes('not found'))
})

test('doc_write: macro-enabled edit is rejected', async () => {
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.ms-excel.sheet.macroEnabled.main+xml"/></Types>')
  zip.file('xl/vbaProject.bin', new Uint8Array([1]))
  const { writeFileSync } = await import('node:fs')
  writeFileSync(join(dir, 'evil.xlsm'), await zip.generateAsync({ type: 'nodebuffer' }))
  const result = await call('doc_write', {
    file_path: 'evil.xlsm',
    format: 'xlsx',
    operation: 'edit',
    edits: [],
  }, withCwd())
  assert.equal(result.isError, true)
  assert.ok(text(result).toLowerCase().includes('macro'))
})

test('doc_read: writes leave a valid file on disk', async () => {
  const w = await call('doc_write', {
    file_path: 't.xlsx',
    format: 'xlsx',
    operation: 'create',
    sheets: [{ name: 'S', cells: [{ ref: 'A1', value: 1 }] }],
  }, withCwd())
  assert.equal(w.isError, false)
  // Parse the bytes on disk with the core directly.
  const { readDocument } = await import('@dsh-cowork/core')
  const bytes = new Uint8Array(readFileSync(join(dir, 't.xlsx')))
  const r = await readDocument({ data: bytes, path: 't.xlsx' })
  assert.equal(r.format, 'xlsx')
  assert.equal(r.xlsx!.sheets[0]!.rows[0]!.cells[0]!.value, 1)
})

test('read-only sandbox mode: doc_write blocked, doc_read allowed', async () => {
  // Fresh context with a read-only sandbox policy mounted.
  const { SandboxPolicyService } = await import('@deepseek-ai/dsh-sandbox-policy')
  const ro = new Context()
  await ro.plugin(SystemPrompt)
  await ro.plugin(ToolRuntime)
  await ro.plugin(LocalFileSystem, { cwd: dir })
  await ro.plugin(SandboxPolicyService, { mode: 'read-only' })
  await ro.plugin(Cowork)

  const write = await ro.tools.execute({
    signal,
    callId: CallId('call-ro-1'),
    name: 'doc_write',
    arguments: {
      file_path: 'blocked.xlsx',
      format: 'xlsx',
      operation: 'create',
      sheets: [{ name: 'S', cells: [{ ref: 'A1', value: 1 }] }],
    },
    agent: { session: { id: 's-ro', header: { cwd: dir }, events: [] } } as never,
  })
  assert.equal(write.isError, true)
  assert.ok(text(write).includes('[sandbox: write denied]'), text(write))

  copyFixture('sample.ipynb')
  const read = await ro.tools.execute({
    signal,
    callId: CallId('call-ro-2'),
    name: 'doc_read',
    arguments: { file_path: 'sample.ipynb' },
    agent: { session: { id: 's-ro', header: { cwd: dir }, events: [] } } as never,
  })
  assert.equal(read.isError, false, text(read))
  assert.ok(text(read).includes('x = 6 * 7'))
})
