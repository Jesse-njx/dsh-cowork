/**
 * docx reader — mammoth converts the OOXML to plain text; we surface
 * paragraphs + word count. (Editing docx is deferred to v2: the `docx` npm
 * package is generate-only, and real editing means raw OOXML via zip.)
 */

import mammoth from 'mammoth'
import type { DocReadOptions, WindowCaps } from '../types.ts'
import { DocError } from '../safety.ts'

export interface DocxRead {
  format: 'docx'
  paragraphs: string[]
  wordCount: number
  truncated: boolean
}

const MAX_PARAGRAPHS = 500

/**
 * Extract bounded plain-text paragraphs from a docx buffer.
 */
export async function readDocx(
  data: Uint8Array,
  _options: DocReadOptions,
  _caps: WindowCaps,
): Promise<DocxRead> {
  let result: { value: string }
  try {
    result = await mammoth.extractRawText({ buffer: Buffer.from(data) })
  } catch (e) {
    throw new DocError('PARSE_FAILED', `Could not parse the document: ${e instanceof Error ? e.message : String(e)}`)
  }
  const paragraphs = result.value.split(/\n+/).map((p) => p.trim()).filter((p) => p.length > 0)
  const wordCount = paragraphs.reduce((n, p) => n + p.split(/\s+/).length, 0)
  const truncated = paragraphs.length > MAX_PARAGRAPHS
  return {
    format: 'docx',
    paragraphs: paragraphs.slice(0, MAX_PARAGRAPHS),
    wordCount,
    truncated,
  }
}
