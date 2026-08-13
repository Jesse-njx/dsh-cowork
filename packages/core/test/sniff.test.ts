import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sniff } from '../src/sniff.ts'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'test', 'fixtures')

function load(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(fixtures, name)))
}

test('sniffs each fixture format by content', async () => {
  const cases: Array<[string, string]> = [
    ['sample.xlsx', 'xlsx'],
    ['sample.docx', 'docx'],
    ['sample.pptx', 'pptx'],
    ['sample.ipynb', 'ipynb'],
  ]
  for (const [file, expected] of cases) {
    const r = await sniff(load(file), file)
    assert.equal(r.format, expected, `${file} should sniff as ${expected}`)
  }
})

test('sniffs pdf by magic bytes', async () => {
  const data = load('sample.pdf')
  const r = await sniff(data, 'sample.pdf')
  assert.equal(r.format, 'pdf')
})

test('sniffs ipynb even without the extension hint', async () => {
  const r = await sniff(load('sample.ipynb'), 'no-extension')
  assert.equal(r.format, 'ipynb')
})

test('rejects legacy OLE2 binaries', async () => {
  // OLE2 compound-file magic: D0 CF 11 E0 A1 B1 1A E1
  const data = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0])
  const r = await sniff(data, 'old.xls')
  assert.equal(r.format, 'ole2')
})

test('returns unknown for garbage', async () => {
  const r = await sniff(new TextEncoder().encode('definitely not a document'), 'garbage.bin')
  assert.equal(r.format, 'unknown')
})

test('rejects macro-enabled xlsx (xlsm)', async () => {
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.ms-excel.sheet.macroEnabled.main+xml"/></Types>')
  zip.file('xl/vbaProject.bin', new Uint8Array([1, 2, 3]))
  const buf = await zip.generateAsync({ type: 'uint8array' })
  const r = await sniff(buf, 'macros.xlsm')
  assert.equal(r.format, 'xlsm')
})
