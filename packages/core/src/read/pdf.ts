/**
 * pdf reader — pdfjs-dist (the legacy build runs worker-free on Node's main
 * thread). v1 extracts text only; page-render-to-image comes later.
 */

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { DocReadOptions, PageWindow, WindowCaps } from '../types.ts'
import { DocError } from '../safety.ts'

export interface PdfRead {
  format: 'pdf'
  pages: PageWindow[]
  totalPages: number
  truncated: boolean
}

/** Collapse pdfjs text items into one line of text per page. */
function pageText(items: Array<{ str?: string; hasEOL?: boolean }>): string {
  let out = ''
  for (const item of items) {
    out += item.str ?? ''
    if (item.hasEOL) out += '\n'
  }
  // The layout of getTextContent is positional, not grammatical; joining with
  // spaces preserves word boundaries better than raw concatenation.
  return out.replace(/[ \t]+\n/g, '\n').trim()
}

/**
 * Extract a bounded window of pages (text only) from a pdf buffer.
 */
export async function readPdf(
  data: Uint8Array,
  options: DocReadOptions,
  caps: WindowCaps,
): Promise<PdfRead> {
  let doc: Awaited<ReturnType<typeof getDocument>['promise']>
  let task: ReturnType<typeof getDocument>
  try {
    task = getDocument({ data: data.slice().buffer as ArrayBuffer })
    doc = await task.promise
  } catch (e) {
    throw new DocError('PARSE_FAILED', `Could not parse the PDF: ${e instanceof Error ? e.message : String(e)}`)
  }
  try {
    const totalPages = doc.numPages
    const start = Math.max(1, options.page ?? 1)
    const limit = Math.min(Math.max(1, options.pages ?? caps.maxPages), caps.maxPages)
    const pages: PageWindow[] = []
    const end = Math.min(totalPages, start + limit - 1)
    for (let p = start; p <= end; p++) {
      const page = await doc.getPage(p)
      const content = await page.getTextContent()
      const text = pageText(content.items as Array<{ str?: string; hasEOL?: boolean }>)
      pages.push({ page: p, totalPages, text })
      page.cleanup()
    }
    return {
      format: 'pdf',
      pages,
      totalPages,
      truncated: totalPages > end,
    }
  } finally {
    await task.destroy()
  }
}
