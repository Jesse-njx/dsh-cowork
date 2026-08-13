/**
 * DSH Cowork core — public API.
 *
 * READ: `readDocument(buffer, { path, options }) → DocReadResult`
 * WRITE: `writeDocument({ format, ... }) → Uint8Array`
 * Render: `renderMarkdown(result, maxBytes) → string`
 */

export * from './types.ts'
export { readDocument } from './read/index.ts'
export type { ReadDocumentInput } from './read/index.ts'
export { writeDocument, WRITABLE_FORMATS } from './write/index.ts'
export type { WriteDocumentSpec } from './write/index.ts'
export type { XlsxWriteSpec, XlsxEditSpec, XlsxCreateSpec, XlsxEditOp, XlsxCellSpec, XlsxSheetSpec, XlsxValue } from './write/xlsx.ts'
export type { IpynbWriteSpec, IpynbCreateSpec, IpynbEditSpec, IpynbCellSpec, IpynbEditKind, IpynbCellType } from './write/ipynb.ts'
export { renderMarkdown } from './render/markdown.ts'
export { sniff, isReadable, REJECTION_MESSAGES } from './sniff.ts'
export type { SniffResult, RejectedFormat } from './sniff.ts'
export { DocError } from './safety.ts'
export type { DocErrorCode } from './safety.ts'
