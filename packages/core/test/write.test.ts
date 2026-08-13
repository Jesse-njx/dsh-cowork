import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeXlsx } from '../src/write/xlsx.ts'
import { writeIpynb, readIpynbSources } from '../src/write/ipynb.ts'
import { readDocument } from '../src/read/index.ts'
import { readXlsx } from '../src/read/xlsx.ts'
import { DEFAULT_WINDOW_CAPS, DEFAULT_SAFETY_CAPS } from '../src/types.ts'
import { DocError } from '../src/safety.ts'

test('creates an xlsx from a cell spec and reads it back', async () => {
  const bytes = await writeXlsx({
    kind: 'create',
    sheets: [{ name: 'S1', cells: [{ ref: 'A1', value: 'name' }, { ref: 'B1', value: 42 }, { ref: 'A2', value: 'hello' }] }],
  })
  const r = await readXlsx(bytes, {}, DEFAULT_WINDOW_CAPS)
  const s = r.sheets[0]!
  assert.equal(s.sheet, 'S1')
  assert.deepEqual(s.rows[0]!.cells.map((c) => c.value), ['name', 42])
  assert.equal(s.rows[1]!.cells[0]!.value, 'hello')
})

test('edits an existing xlsx by stable address', async () => {
  const original = await writeXlsx({
    kind: 'create',
    sheets: [{ name: 'S1', cells: [{ ref: 'A1', value: 'before' }, { ref: 'B1', value: 1 }] }],
  })
  const edited = await writeXlsx({
    kind: 'edit',
    original,
    edits: [{ sheet: 'S1', ref: 'A1', value: 'after' }, { sheet: 'S1', ref: 'B1', value: 99 }],
  })
  const r = await readXlsx(edited, {}, DEFAULT_WINDOW_CAPS)
  const cells = r.sheets[0]!.rows[0]!.cells
  assert.equal(cells.find((c) => c.ref === 'A1')!.value, 'after')
  assert.equal(cells.find((c) => c.ref === 'B1')!.value, 99)
})

test('edit rejects unknown sheets', async () => {
  const original = await writeXlsx({ kind: 'create', sheets: [{ name: 'S1', cells: [] }] })
  await assert.rejects(
    writeXlsx({ kind: 'edit', original, edits: [{ sheet: 'Nope', ref: 'A1', value: 1 }] }),
    (e: unknown) => e instanceof DocError && e.code === 'PARSE_FAILED',
  )
})

test('edit rejects macro-enabled workbooks', async () => {
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.ms-excel.sheet.macroEnabled.main+xml"/></Types>')
  zip.file('xl/vbaProject.bin', new Uint8Array([1]))
  const buf = await zip.generateAsync({ type: 'uint8array' })
  await assert.rejects(
    writeXlsx({ kind: 'edit', original: buf, edits: [] }),
    (e: unknown) => e instanceof DocError && e.code === 'MACRO_FORMAT_REJECTED',
  )
})

test('formula cells are written without cached results', async () => {
  const bytes = await writeXlsx({
    kind: 'create',
    sheets: [{ name: 'S1', cells: [{ ref: 'A1', value: 2 }, { ref: 'A2', value: 3 }, { ref: 'A3', value: { formula: 'SUM(A1:A2)' } }] }],
  })
  const r = await readXlsx(bytes, {}, DEFAULT_WINDOW_CAPS)
  const a3 = r.sheets[0]!.rows[2]!.cells.find((c) => c.ref === 'A3')!
  assert.equal(a3.formula, 'SUM(A1:A2)')
})

test('create + edit round-trip through readDocument', async () => {
  const original = await writeXlsx({ kind: 'create', sheets: [{ name: 'S1', cells: [{ ref: 'A1', value: 'x' }] }] })
  const edited = await writeXlsx({ kind: 'edit', original, edits: [{ sheet: 'S1', ref: 'A1', value: 'y' }] })
  const r = await readDocument({ data: edited, path: 'edited.xlsx' })
  assert.equal(r.xlsx!.sheets[0]!.rows[0]!.cells[0]!.value, 'y')
})

test('creates an ipynb and reads sources back', async () => {
  const bytes = writeIpynb({
    kind: 'create',
    cells: [
      { type: 'markdown', source: '# Title' },
      { type: 'code', source: 'print(1)' },
    ],
  })
  const sources = readIpynbSources(bytes)
  assert.deepEqual(sources, ['# Title', 'print(1)'])
})

test('ipynb edit: replace, insert, delete by index', async () => {
  const original = writeIpynb({
    kind: 'create',
    cells: [{ type: 'markdown', source: 'one' }, { type: 'code', source: 'two' }, { type: 'code', source: 'three' }],
  })
  const edited = writeIpynb({
    kind: 'edit',
    original,
    edits: [
      { op: 'replace', cell: 1, source: 'two edited' },
      { op: 'insert', at: 0, cells: [{ type: 'markdown', source: 'zero' }] },
      { op: 'delete', cell: 3 },
    ],
  })
  const sources = readIpynbSources(edited)
  assert.deepEqual(sources, ['zero', 'one', 'two edited'])
})

test('ipynb edit validates out-of-range indices', async () => {
  const original = writeIpynb({ kind: 'create', cells: [{ type: 'markdown', source: 'a' }] })
  assert.throws(
    () => writeIpynb({ kind: 'edit', original, edits: [{ op: 'delete', cell: 5 }] }),
    (e: unknown) => e instanceof DocError,
  )
})

test('written xlsx passes default safety caps on read', async () => {
  const bytes = await writeXlsx({ kind: 'create', sheets: [{ name: 'S1', cells: [{ ref: 'A1', value: 'ok' }] }] })
  await readDocument({ data: bytes, path: 'fresh.xlsx', safetyCaps: DEFAULT_SAFETY_CAPS })
})
