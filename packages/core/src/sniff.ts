/**
 * Format sniffing by magic bytes, with a content peek for the OOXML zip
 * family (xlsx vs docx vs pptx) and explicit rejection of macro and legacy
 * binary formats.
 */

import JSZip from 'jszip'
import type { DocFormat, SniffedFormat } from './types.ts'

/** Sniff outcome for formats we deliberately refuse to touch. */
export type RejectedFormat = 'xlsm' | 'docm' | 'pptm' | 'ole2'

export interface SniffResult {
  format: DocFormat | RejectedFormat | 'unknown'
  /** True when the zip family was disambiguated by content, not extension. */
  byContent?: boolean
}

const OLE2_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]

function hasBytes(data: Uint8Array, bytes: number[], offset = 0): boolean {
  if (data.length < offset + bytes.length) return false
  for (let i = 0; i < bytes.length; i++) {
    if (data[i + offset] !== bytes[i]) return false
  }
  return true
}

function isAscii(data: Uint8Array, start: number, len: number): boolean {
  if (data.length < start + len) return false
  for (let i = 0; i < len; i++) {
    const b = data[start + i]
    if (b === undefined || b < 0x20 || b > 0x7e) return false
  }
  return true
}

/** Cheap textual sniff for ipynb (JSON with `"nbformat"` near the start). */
function sniffIpynbText(data: Uint8Array): boolean {
  const head = new TextDecoder('utf-8', { fatal: false }).decode(data.subarray(0, 4096))
  return head.includes('"nbformat"') && head.includes('"cells"')
}

/**
 * Identify the OOXML family from the zip's `[Content_Types].xml` / entry
 * names. Also detects macro variants (vbaProject) and rejects them.
 */
async function sniffOoxmlFamily(zip: JSZip): Promise<DocFormat | RejectedFormat | 'unknown'> {
  const names = Object.keys(zip.files)
  const hasVba = names.some((n) => n.toLowerCase().endsWith('vbaproject.bin'))
  if (hasVba) {
    if (names.some((n) => n.startsWith('xl/'))) return 'xlsm'
    if (names.some((n) => n.startsWith('word/'))) return 'docm'
    if (names.some((n) => n.startsWith('ppt/'))) return 'pptm'
  }
  // Prefer the content-types override, fall back to top-level dirs.
  const ct = zip.file('[Content_Types].xml')
  if (ct) {
    const text = await ct.async('string')
    if (text.includes('xl/')) return 'xlsx'
    if (text.includes('word/')) return 'docx'
    if (text.includes('ppt/')) return 'pptx'
  }
  if (names.some((n) => n.startsWith('xl/'))) return 'xlsx'
  if (names.some((n) => n.startsWith('word/'))) return 'docx'
  if (names.some((n) => n.startsWith('ppt/'))) return 'pptx'
  return 'unknown'
}

/**
 * Sniff the format of a document buffer. Async because the OOXML family is
 * disambiguated by reading the zip central directory. A `hint` extension is
 * used only as a tiebreaker for ipynb and for formats whose magic is not
 * self-evident.
 */
export async function sniff(data: Uint8Array, hint?: string): Promise<SniffResult> {
  // PDF
  if (isAscii(data, 0, 5) && new TextDecoder().decode(data.subarray(0, 5)) === '%PDF-') {
    return { format: 'pdf' }
  }
  // Legacy OLE2 compound files (xls / doc / ppt).
  if (hasBytes(data, OLE2_MAGIC)) {
    return { format: 'ole2' }
  }
  // OOXML zip family.
  if (hasBytes(data, [0x50, 0x4b, 0x03, 0x04]) || hasBytes(data, [0x50, 0x4b, 0x05, 0x06]) || hasBytes(data, [0x50, 0x4b, 0x07, 0x08])) {
    let zip: JSZip
    try {
      zip = await JSZip.loadAsync(data)
    } catch {
      return { format: 'unknown' }
    }
    const family = await sniffOoxmlFamily(zip)
    if (family !== 'unknown') return { format: family, byContent: true }
    // A zip that is none of the OOXML families is not a Cowork document.
    return { format: 'unknown' }
  }
  // ipynb: JSON by content or by extension hint.
  if (sniffIpynbText(data)) return { format: 'ipynb' }
  if (hint?.toLowerCase().endsWith('.ipynb')) return { format: 'ipynb' }
  return { format: 'unknown' }
}

/** Human-readable labels for rejected formats. */
export const REJECTION_MESSAGES: Record<RejectedFormat, string> = {
  xlsm: 'macro-enabled spreadsheets (.xlsm) are rejected: DSH Cowork never reads or writes macro formats',
  docm: 'macro-enabled documents (.docm) are rejected: DSH Cowork never reads or writes macro formats',
  pptm: 'macro-enabled presentations (.pptm) are rejected: DSH Cowork never reads or writes macro formats',
  ole2: 'legacy binary Office formats (.xls/.doc/.ppt) are not supported; save as the modern OOXML format and retry',
}

/** Whether a sniff result is a format we can read. */
export function isReadable(sniffed: SniffedFormat | RejectedFormat): sniffed is DocFormat {
  return sniffed === 'xlsx' || sniffed === 'pdf' || sniffed === 'docx' || sniffed === 'pptx' || sniffed === 'ipynb'
}
