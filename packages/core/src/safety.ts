/**
 * Safety checks that apply to every input before (and during) parsing:
 * - raw input byte cap
 * - zip entry-count cap and decompressed-size cap (zip bombs)
 * - macro-format rejection (enforced at sniff, surfaced here as errors)
 *
 * All failures raise `DocError` with a stable `code` the adapters can map to
 * model-facing messages.
 */

import JSZip from 'jszip'
import type { SafetyCaps } from './types.ts'

export type DocErrorCode =
  | 'INPUT_TOO_LARGE'
  | 'ZIP_TOO_MANY_ENTRIES'
  | 'ZIP_BOMB'
  | 'MACRO_FORMAT_REJECTED'
  | 'UNSUPPORTED_FORMAT'
  | 'PARSE_FAILED'
  | 'EMPTY_DOCUMENT'

export class DocError extends Error {
  readonly code: DocErrorCode
  constructor(code: DocErrorCode, message: string) {
    super(message)
    this.name = 'DocError'
    this.code = code
  }
}

/** Cap the raw input before any parsing. */
export function checkInputSize(data: Uint8Array, caps: SafetyCaps): void {
  if (data.byteLength > caps.maxInputBytes) {
    throw new DocError(
      'INPUT_TOO_LARGE',
      `Document is ${data.byteLength} bytes, exceeding the ${caps.maxInputBytes}-byte input cap.`,
    )
  }
}

/** Entry-count + decompressed-size checks after reading a zip directory. */
export function checkZipSafety(zip: JSZip, caps: SafetyCaps): void {
  const names = Object.keys(zip.files)
  if (names.length > caps.maxZipEntries) {
    throw new DocError(
      'ZIP_TOO_MANY_ENTRIES',
      `Archive contains ${names.length} entries, exceeding the ${caps.maxZipEntries}-entry cap.`,
    )
  }
  let total = 0
  for (const name of names) {
    const file = zip.files[name]
    if (file?.dir) continue
    // jszip exposes the uncompressed size on the internal data object.
    const size = (file as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize
    if (typeof size === 'number' && Number.isFinite(size)) {
      total += size
      if (total > caps.maxDecompressedBytes) break
    }
  }
  if (total > caps.maxDecompressedBytes) {
    throw new DocError(
      'ZIP_BOMB',
      `Archive decompresses to over ${caps.maxDecompressedBytes} bytes; refusing to expand a possible zip bomb.`,
    )
  }
}
