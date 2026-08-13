/**
 * `writeDocument` — the single entry point for Cowork writers. Produces the
 * new file bytes; the adapter (DSH ctx.fs / MCP / CLI) is responsible for the
 * atomic-write + hash-check lifecycle.
 */

import type { DocFormat } from '../types.ts'
import { writeXlsx, type XlsxWriteSpec } from './xlsx.ts'
import { writeIpynb, type IpynbWriteSpec } from './ipynb.ts'

export type WriteDocumentSpec =
  | (XlsxWriteSpec & { format: 'xlsx' })
  | (IpynbWriteSpec & { format: 'ipynb' })

/**
 * Produce new file bytes for the given format. The caller must bound the
 * output (byte caps are enforced by the adapter layer around this).
 */
export async function writeDocument(spec: WriteDocumentSpec): Promise<Uint8Array> {
  switch (spec.format) {
    case 'xlsx':
      return writeXlsx(spec)
    case 'ipynb':
      return writeIpynb(spec)
  }
}

/** Formats Cowork can write in v1. */
export const WRITABLE_FORMATS: readonly DocFormat[] = ['xlsx', 'ipynb']
