import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createCoworkServer } from '../src/index.ts'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'test', 'fixtures')

let dir: string
let client: Client

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'cowork-mcp-'))
  const server = createCoworkServer()
  const [ct, st] = InMemoryTransport.createLinkedPair()
  await server.connect(st)
  client = new Client({ name: 'cowork-test', version: '0.0.0' })
  await client.connect(ct)
})

afterEach(async () => {
  await client.close()
  rmSync(dir, { recursive: true, force: true })
})

async function callTool(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  const r = await client.callTool({ name, arguments: args })
  const content = r.content as Array<{ type: string; text?: string }>
  const text = content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('')
  return { text, isError: r.isError === true }
}

test('lists doc_read and doc_write tools', async () => {
  const tools = await client.listTools()
  const names = tools.tools.map((t) => t.name)
  assert.ok(names.includes('doc_read'))
  assert.ok(names.includes('doc_write'))
})

test('doc_read xlsx through MCP', async () => {
  copyFileSync(join(fixtures, 'sample.xlsx'), join(dir, 'sample.xlsx'))
  const { text, isError } = await callTool('doc_read', { file_path: join(dir, 'sample.xlsx') })
  assert.equal(isError, false)
  assert.ok(text.includes('| A2 | Widget |'))
})

test('doc_read pdf through MCP', async () => {
  copyFileSync(join(fixtures, 'sample.pdf'), join(dir, 'sample.pdf'))
  const { text, isError } = await callTool('doc_read', { file_path: join(dir, 'sample.pdf') })
  assert.equal(isError, false)
  assert.ok(text.includes('Hello from DSH Cowork pdf fixture'))
})

test('doc_read missing file returns an error', async () => {
  const { isError, text } = await callTool('doc_read', { file_path: join(dir, 'nope.xlsx') })
  assert.equal(isError, true)
  assert.ok(text.includes('cannot read'))
})

test('doc_write create + read back over MCP', async () => {
  const target = join(dir, 'out.xlsx')
  const w = await callTool('doc_write', {
    file_path: target,
    format: 'xlsx',
    operation: 'create',
    sheets: [{ name: 'S1', cells: [{ ref: 'A1', value: 'mcp' }, { ref: 'B1', value: 3 }] }],
  })
  assert.equal(w.isError, false, w.text)
  const r = await callTool('doc_read', { file_path: target })
  assert.ok(r.text.includes('| A1 | mcp |'))
  assert.ok(r.text.includes('| B1 | 3 |'))
})

test('doc_write create refuses overwrite without force', async () => {
  copyFileSync(join(fixtures, 'sample.xlsx'), join(dir, 'exists.xlsx'))
  const w = await callTool('doc_write', {
    file_path: join(dir, 'exists.xlsx'),
    format: 'xlsx',
    operation: 'create',
    sheets: [{ name: 'S', cells: [] }],
  })
  assert.equal(w.isError, true)
  assert.ok(w.text.includes('force=true'))
})

test('doc_write edit with sha256 guard', async () => {
  copyFileSync(join(fixtures, 'sample.xlsx'), join(dir, 'edit.xlsx'))
  const read = await callTool('doc_read', { file_path: join(dir, 'edit.xlsx') })
  const m = /sha256=([0-9a-f]{64})/.exec(read.text)
  assert.ok(m, 'footer hash expected in doc_read output')
  const hash = m![1]!

  const edit = await callTool('doc_write', {
    file_path: join(dir, 'edit.xlsx'),
    format: 'xlsx',
    operation: 'edit',
    edits: [{ sheet: 'Data', ref: 'A2', value: 'MCP-edited' }],
    expected_sha256: hash,
  })
  assert.equal(edit.isError, false, edit.text)

  const bad = await callTool('doc_write', {
    file_path: join(dir, 'edit.xlsx'),
    format: 'xlsx',
    operation: 'edit',
    edits: [{ sheet: 'Data', ref: 'A2', value: 'Nope' }],
    expected_sha256: '0'.repeat(64),
  })
  assert.equal(bad.isError, true)
  assert.ok(bad.text.includes('sha256 mismatch'))

  const reread = await callTool('doc_read', { file_path: join(dir, 'edit.xlsx') })
  assert.ok(reread.text.includes('MCP-edited'))
})
