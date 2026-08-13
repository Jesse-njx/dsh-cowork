#!/usr/bin/env node
/**
 * Generate the committed test fixtures (xlsx / pdf / docx / pptx / ipynb).
 * Run from the repo root:  node test/scripts/make-fixtures.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = join(here, '..', '..', '..', 'test', 'fixtures')
mkdirSync(fixtures, { recursive: true })

// ---- xlsx ---------------------------------------------------------------
{
  const wb = new ExcelJS.Workbook()
  const s1 = wb.addWorksheet('Data')
  s1.getCell('A1').value = 'Item'
  s1.getCell('B1').value = 'Qty'
  s1.getCell('C1').value = 'Price'
  s1.getCell('A2').value = 'Widget'
  s1.getCell('B2').value = 3
  s1.getCell('C2').value = 1.25
  s1.getCell('A3').value = 'Gadget'
  s1.getCell('B3').value = 7
  s1.getCell('C3').value = 9.99
  s1.getCell('A4').value = new Date('2024-05-01T12:00:00Z')
  s1.getCell('C5').value = { formula: 'SUM(C2:C4)' }
  const s2 = wb.addWorksheet('Notes')
  s2.getCell('A1').value = 'Hidden notes sheet'
  s2.state = 'hidden'
  const buf = await wb.xlsx.writeBuffer()
  writeFileSync(join(fixtures, 'sample.xlsx'), Buffer.from(buf))
}

// ---- ipynb --------------------------------------------------------------
{
  const nb = {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: { kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' } },
    cells: [
      { cell_type: 'markdown', metadata: {}, source: ['# Fixture notebook\n', 'A notebook for DSH Cowork tests.'] },
      { cell_type: 'code', metadata: {}, execution_count: 1, source: ['x = 6 * 7\n', 'print(x)'], outputs: [{ output_type: 'stream', name: 'stdout', text: ['42\n'] }] },
      { cell_type: 'code', metadata: {}, execution_count: 2, source: ['print("done")'], outputs: [{ output_type: 'execute_result', execution_count: 2, data: { 'text/plain': ['done'] }, metadata: {} }] },
    ],
  }
  writeFileSync(join(fixtures, 'sample.ipynb'), JSON.stringify(nb, null, 1))
}

// ---- docx ---------------------------------------------------------------
{
  const zip = new JSZip()
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`)
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`)
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>Hello from DSH Cowork docx fixture.</w:t></w:r></w:p>
<w:p><w:r><w:t>Second paragraph with 中文 and numbers 42.</w:t></w:r></w:p>
<w:p><w:r><w:t>Third paragraph, the final one.</w:t></w:r></w:p>
</w:body></w:document>`)
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  writeFileSync(join(fixtures, 'sample.docx'), buf)
}

// ---- pptx ---------------------------------------------------------------
function slideXml(title, body) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<p:cSld><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr/>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="Body 1"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${body}</a:t></a:r></a:p></p:txBody></p:sp>
</p:spTree></p:cSld></p:sld>`
}
{
  const zip = new JSZip()
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>`)
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`)
  zip.file('ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst>
<p:sldSz cx="9144000" cy="6858000"/></p:presentation>`)
  zip.file('ppt/_rels/presentation.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/></Relationships>`)
  zip.file('ppt/slides/slide1.xml', slideXml('Slide One Title', 'First slide body text'))
  zip.file('ppt/slides/slide2.xml', slideXml('Slide Two Title', 'Second slide body with 中文'))
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  writeFileSync(join(fixtures, 'sample.pptx'), buf)
}

// ---- pdf (via macOS cupsfilter; fallback: skip with a warning) ----------
{
  const txt = join(fixtures, '_pdf-source.txt')
  writeFileSync(txt, 'Hello from DSH Cowork pdf fixture.\nSecond line with 中文.\nThird line, the final one.\n')
  try {
    const out = execFileSync('cupsfilter', ['-m', 'application/pdf', txt], { encoding: null, timeout: 60000 })
    writeFileSync(join(fixtures, 'sample.pdf'), out)
    console.log('pdf fixture: generated via cupsfilter')
  } catch {
    console.warn('pdf fixture: cupsfilter unavailable — skipping sample.pdf')
  }
}

console.log('fixtures written to', fixtures)
