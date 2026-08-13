/**
 * `readDocument` — the one entry point for every Cowork read adapter.
 *
 * Pipeline: input size check → sniff → macro/legacy rejection → codec →
 * windowing + truncation notice. All failures are `DocError` with stable
 * codes.
 */

import type { DocFormat, DocReadOptions, DocReadResult, SafetyCaps, WindowCaps } from '../types.ts'
import { DEFAULT_SAFETY_CAPS, DEFAULT_WINDOW_CAPS, truncationNotice } from '../types.ts'
import { sniff, isReadable, REJECTION_MESSAGES, type RejectedFormat } from '../sniff.ts'
import { checkInputSize, checkZipSafety, DocError } from '../safety.ts'
import JSZip from 'jszip'
import { readIpynb } from './ipynb.ts'
import { readXlsx } from './xlsx.ts'
import { readDocx } from './docx.ts'
import { readPptx } from './pptx.ts'
import { readPdf } from './pdf.ts'

export interface ReadDocumentInput {
  /** Raw document bytes (already bounded by the caller if desired). */
  data: Uint8Array
  /** Display path: used for the extension hint and surfaced in the result. */
  path?: string
  options?: DocReadOptions
  windowCaps?: WindowCaps
  safetyCaps?: SafetyCaps
}

/**
 * Read a document buffer and return a bounded, addressed window.
 */
export async function readDocument(input: ReadDocumentInput): Promise<DocReadResult> {
  const caps = input.windowCaps ?? DEFAULT_WINDOW_CAPS
  const safety = input.safetyCaps ?? DEFAULT_SAFETY_CAPS
  const options = input.options ?? {}
  const path = input.path ?? 'document'

  checkInputSize(input.data, safety)
  const sniffed = await sniff(input.data, path)

  if (!isReadable(sniffed.format)) {
    if (sniffed.format !== 'unknown') {
      throw new DocError('MACRO_FORMAT_REJECTED', REJECTION_MESSAGES[sniffed.format as RejectedFormat])
    }
    throw new DocError('UNSUPPORTED_FORMAT', `Unsupported format: cannot identify "${path}" as xlsx, pdf, docx, pptx, or ipynb.`)
  }

  const format = sniffed.format as DocFormat

  // Zip-bomb gate for every OOXML family before any codec touches the bytes.
  if (format === 'xlsx' || format === 'docx' || format === 'pptx') {
    try {
      const zip = await JSZip.loadAsync(input.data)
      checkZipSafety(zip, safety)
    } catch (e) {
      if (e instanceof DocError) throw e
      // A zip that fails to open here will be reported by the codec below.
    }
  }

  switch (format) {
    case 'ipynb': {
      const r = readIpynb(input.data, options, caps)
      const truncated = r.totalCells > r.cells.length
      return {
        format,
        path,
        offset: options.cell ?? 0,
        windowCaps: caps,
        truncated,
        ...(truncated ? { notice: truncationNotice('cells', r.cells.length, r.totalCells, 'cells') } : {}),
        ipynb: { cells: r.cells },
      }
    }
    case 'xlsx': {
      const r = await readXlsx(input.data, options, caps)
      const truncated = r.rowTruncated || r.sheetTruncated
      const notices: string[] = []
      if (r.rowTruncated) notices.push(truncationNotice('rows', r.sheets.reduce((n, s) => n + s.rows.length, 0), r.sheets.reduce((n, s) => n + s.totalRows, 0), 'rows'))
      if (r.sheetTruncated) notices.push(`More sheets exist (${r.sheetNames.join(', ')}); pass \`sheets\` to read a specific one.`)
      return {
        format,
        path,
        offset: options.rowOffset ?? 1,
        windowCaps: caps,
        truncated,
        ...(notices.length > 0 ? { notice: notices.join(' ') } : {}),
        xlsx: { sheets: r.sheets },
      }
    }
    case 'pptx': {
      const r = await readPptx(input.data, options, caps, safety)
      return {
        format,
        path,
        offset: options.slide ?? 0,
        windowCaps: caps,
        truncated: r.truncated,
        ...(r.truncated ? { notice: truncationNotice('slides', r.slides.length, r.totalSlides, 'slides') } : {}),
        pptx: { slides: r.slides, totalSlides: r.totalSlides },
      }
    }
    case 'pdf': {
      const r = await readPdf(input.data, options, caps)
      return {
        format,
        path,
        offset: options.page ?? 1,
        windowCaps: caps,
        truncated: r.truncated,
        ...(r.truncated ? { notice: truncationNotice('pages', r.pages.length, r.totalPages, 'pages') } : {}),
        pdf: { pages: r.pages },
      }
    }
    case 'docx': {
      const r = await readDocx(input.data, options, caps)
      return {
        format,
        path,
        offset: 0,
        windowCaps: caps,
        truncated: r.truncated,
        ...(r.truncated ? { notice: `Truncated: document has more than ${r.paragraphs.length} paragraphs.` } : {}),
        docx: { paragraphs: r.paragraphs, wordCount: r.wordCount },
      }
    }
  }
}
