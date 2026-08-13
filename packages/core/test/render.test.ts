import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readDocument } from '../src/read/index.ts'
import { renderMarkdown } from '../src/render/markdown.ts'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'test', 'fixtures')
const load = (n: string) => new Uint8Array(readFileSync(join(fixtures, n)))

test('renders xlsx as a markdown table with refs', async () => {
  const r = await readDocument({ data: load('sample.xlsx'), path: 'sample.xlsx' })
  const md = renderMarkdown(r, 256 * 1024)
  assert.ok(md.includes('| ref | value |'))
  assert.ok(md.includes('| A2 | Widget |'))
  assert.ok(md.includes('## Sheet: Data'))
})

test('renders pptx with shape ids', async () => {
  const r = await readDocument({ data: load('sample.pptx'), path: 'sample.pptx' })
  const md = renderMarkdown(r, 256 * 1024)
  assert.ok(md.includes('- [2] Slide One Title'))
})

test('renders ipynb with cell markers', async () => {
  const r = await readDocument({ data: load('sample.ipynb'), path: 'sample.ipynb' })
  const md = renderMarkdown(r, 256 * 1024)
  assert.ok(md.includes('## Cell 0 (markdown)'))
  assert.ok(md.includes('*output (stream):*'))
})

test('render enforces the maxBytes budget', async () => {
  const r = await readDocument({ data: load('sample.xlsx'), path: 'sample.xlsx' })
  const md = renderMarkdown(r, 120)
  assert.ok(md.length <= 120, `rendered ${md.length} bytes, budget 120`)
})
