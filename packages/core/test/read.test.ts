import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readDocument } from '../src/read/index.ts'
import { DEFAULT_WINDOW_CAPS } from '../src/types.ts'
import { DocError } from '../src/safety.ts'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'test', 'fixtures')
const load = (n: string) => new Uint8Array(readFileSync(join(fixtures, n)))

test('reads xlsx with stable cell addresses and values', async () => {
  const r = await readDocument({ data: load('sample.xlsx'), path: 'sample.xlsx' })
  assert.equal(r.format, 'xlsx')
  const sheet = r.xlsx!.sheets[0]!
  assert.equal(sheet.sheet, 'Data')
  assert.equal(sheet.rows.length, 5)
  const row2 = sheet.rows[1]!
  assert.deepEqual(row2.cells.map((c) => c.ref), ['A2', 'B2', 'C2'])
  assert.deepEqual(row2.cells.map((c) => c.value), ['Widget', 3, 1.25])
})

test('xlsx surfaces dates as ISO strings, not serial numbers', async () => {
  const r = await readDocument({ data: load('sample.xlsx'), path: 'sample.xlsx' })
  const a4 = r.xlsx!.sheets[0]!.rows[3]!.cells[0]!
  assert.equal(a4.ref, 'A4')
  assert.equal(typeof a4.value, 'object')
  assert.ok((a4.value as { date: string }).date.startsWith('2024-05-01'))
})

test('xlsx surfaces formulas with cached-value caveat', async () => {
  const r = await readDocument({ data: load('sample.xlsx'), path: 'sample.xlsx' })
  const c5 = r.xlsx!.sheets[0]!.rows[4]!.cells.find((c) => c.ref === 'C5')!
  assert.ok(c5)
  assert.equal(c5.formula, 'SUM(C2:C4)')
})

test('xlsx windowing: rowOffset + rows cap with truncation notice', async () => {
  const { writeXlsx } = await import('../src/write/xlsx.ts')
  const big = await writeXlsx({
    kind: 'create',
    sheets: [{ name: 'Big', cells: Array.from({ length: 30 }, (_, i) => ({ ref: `A${i + 1}`, value: i })) }],
  })
  const r = await readDocument({
    data: big,
    path: 'big.xlsx',
    options: { rowOffset: 4, rows: 10 },
  })
  assert.equal(r.xlsx!.sheets[0]!.rows[0]!.row, 4)
  assert.equal(r.xlsx!.sheets[0]!.rows.length, 10)
  assert.equal(r.truncated, true)
  assert.ok(r.notice!.includes('Truncated'))
  assert.ok(r.notice!.includes('rows'))
})

test('xlsx sheet selection by name', async () => {
  const r = await readDocument({
    data: load('sample.xlsx'),
    path: 'sample.xlsx',
    options: { sheets: ['Notes'] },
  })
  assert.equal(r.xlsx!.sheets[0]!.sheet, 'Notes')
  assert.equal(r.xlsx!.sheets[0]!.rows[0]!.cells[0]!.value, 'Hidden notes sheet')
})

test('pdf text extraction', async () => {
  const r = await readDocument({ data: load('sample.pdf'), path: 'sample.pdf' })
  assert.equal(r.format, 'pdf')
  assert.ok(r.pdf!.pages.length >= 1)
  const text = r.pdf!.pages[0]!.text
  assert.ok(text.includes('Hello from DSH Cowork pdf fixture'), `page text was: ${text}`)
})

test('pdf page windowing with truncation', async () => {
  const r = await readDocument({ data: load('sample.pdf'), path: 'sample.pdf', options: { page: 1, pages: 5 } })
  assert.equal(r.pdf!.pages[0]!.page, 1)
  assert.ok(r.pdf!.pages[0]!.totalPages >= 1)
})

test('docx paragraph extraction + word count', async () => {
  const r = await readDocument({ data: load('sample.docx'), path: 'sample.docx' })
  assert.equal(r.format, 'docx')
  assert.ok(r.docx!.paragraphs[0]!.includes('Hello from DSH Cowork docx fixture'))
  assert.ok(r.docx!.paragraphs[1]!.includes('中文'))
  assert.ok(r.docx!.wordCount > 0)
})

test('pptx slide + shape id extraction', async () => {
  const r = await readDocument({ data: load('sample.pptx'), path: 'sample.pptx' })
  assert.equal(r.format, 'pptx')
  assert.equal(r.pptx!.totalSlides, 2)
  assert.equal(r.pptx!.slides.length, 2)
  const s1 = r.pptx!.slides[0]!
  assert.equal(s1.slide, 0)
  assert.ok(s1.shapes.some((sh) => sh.shapeId === '2' && sh.text.includes('Slide One Title')))
  assert.ok(s1.shapes.some((sh) => sh.shapeId === '3' && sh.text.includes('First slide body text')))
})

test('ipynb cells with inline outputs', async () => {
  const r = await readDocument({ data: load('sample.ipynb'), path: 'sample.ipynb' })
  assert.equal(r.format, 'ipynb')
  assert.equal(r.ipynb!.cells.length, 3)
  assert.equal(r.ipynb!.cells[0]!.type, 'markdown')
  assert.ok(r.ipynb!.cells[1]!.source.includes('x = 6 * 7'))
  assert.ok(r.ipynb!.cells[1]!.outputs.some((o) => o.text?.includes('42')))
})

test('unknown format raises UNSUPPORTED_FORMAT', async () => {
  await assert.rejects(
    readDocument({ data: new TextEncoder().encode('nothing here'), path: 'x.bin' }),
    (e: unknown) => e instanceof DocError && e.code === 'UNSUPPORTED_FORMAT',
  )
})

test('macro rejection surfaces a clear error', async () => {
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.ms-excel.sheet.macroEnabled.main+xml"/></Types>')
  zip.file('xl/vbaProject.bin', new Uint8Array([1]))
  zip.file('xl/workbook.xml', '<workbook/>')
  const buf = await zip.generateAsync({ type: 'uint8array' })
  await assert.rejects(
    readDocument({ data: buf, path: 'evil.xlsm' }),
    (e: unknown) => e instanceof DocError && e.code === 'MACRO_FORMAT_REJECTED',
  )
})

test('zip bomb is rejected before expansion', async () => {
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  // An xlsx-shaped archive whose sheet entry decompresses to 4 MB of zeros
  // (deflated to a few KB); cap decompressed at 1 MB.
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>')
  zip.file('xl/workbook.xml', '<workbook/>')
  zip.file('xl/worksheets/sheet1.xml', new Uint8Array(4 * 1024 * 1024))
  const buf = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
  await assert.rejects(
    readDocument({
      data: buf,
      path: 'bomb.xlsx',
      safetyCaps: { maxInputBytes: 64 * 1024 * 1024, maxDecompressedBytes: 1024 * 1024, maxZipEntries: 4096 },
    }),
    (e: unknown) => e instanceof DocError && e.code === 'ZIP_BOMB',
  )
})

test('input byte cap is enforced', async () => {
  const data = new TextEncoder().encode('{}')
  await assert.rejects(
    readDocument({
      data,
      path: 'x.ipynb',
      safetyCaps: { maxInputBytes: 1, maxDecompressedBytes: 1024 * 1024, maxZipEntries: 100 },
    }),
    (e: unknown) => e instanceof DocError && e.code === 'INPUT_TOO_LARGE',
  )
})

test('default window caps bound the output', async () => {
  const r = await readDocument({ data: load('sample.xlsx'), path: 'sample.xlsx' })
  assert.ok(r.windowCaps.maxSheetRows === DEFAULT_WINDOW_CAPS.maxSheetRows)
})
