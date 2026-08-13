/**
 * DSH Cowork core types.
 *
 * The central design contract (from the Fable 5 consult):
 * - `doc_read` returns *stable addresses* per window — cell refs for xlsx,
 *   slide/shape ids for pptx — so `doc_write`/`doc_edit` can target them.
 *   Line numbers cannot do this for binary formats.
 * - Every read is *bounded*: format-specific windows (pages / rows / slides /
 *   cells) with hard byte caps, and an explicit truncation notice. Silent
 *   truncation is the cardinal sin.
 */

/** The five formats DSH Cowork understands. */
export type DocFormat = 'xlsx' | 'pdf' | 'docx' | 'pptx' | 'ipynb'

/** Sniff result: known format or a negative. */
export type SniffedFormat = DocFormat | 'unknown'

/** A spreadsheet cell value as surfaced to the model. */
export type CellValue =
  | string
  | number
  | boolean
  | null
  // Dates are surfaced as ISO strings so the model never guesses at
  // spreadsheet serial numbers.
  | { date: string }

/** One xlsx cell with its stable address. */
export interface CellEntry {
  /** Stable address, e.g. `A1`, `C12`. */
  ref: string
  value: CellValue
  /** Raw formula text when the cell holds one (e.g. `SUM(A1:A3)`). */
  formula?: string
}

/** One xlsx row: a list of populated cells with addresses. */
export interface RowEntry {
  /** 1-based row number, e.g. `3`. */
  row: number
  cells: CellEntry[]
}

/** One sheet window: bounded rows for one sheet. */
export interface SheetWindow {
  /** Sheet name — the stable address namespace for xlsx. */
  sheet: string
  /** Total rows in the sheet (count may be approximate for huge sheets). */
  totalRows: number
  /** Bounded row window, offset-adjusted. */
  rows: RowEntry[]
}

/** One pdf page's extracted text. */
export interface PageWindow {
  /** 1-based page number. */
  page: number
  /** Total pages in the document. */
  totalPages: number
  text: string
}

/** One pptx slide's extracted text runs. */
export interface SlideWindow {
  /** 0-based slide index (matches the pptx `ppt/slides/slideN.xml` numbering). */
  slide: number
  /** Stable per-slide addresses: shape id → text. */
  shapes: Array<{ shapeId: string; text: string }>
}

/** One ipynb cell. */
export interface CellWindow {
  /** 0-based cell index. */
  cell: number
  type: 'markdown' | 'code' | 'raw'
  source: string
  /** Rendered outputs for code cells (text/plain, text/html, image/png …). */
  outputs: Array<{ type: string; text?: string }>
}

/**
 * The canonical structured result of one `doc_read` call. JSON-serializable,
 * format-specific, and always bounded.
 */
export interface DocReadResult {
  format: DocFormat
  /** Resolved display path. */
  path: string
  /** 1-based byte offset of the window (for windowed re-reads). */
  offset: number
  /** Hard cap on the model-facing window; the window never exceeds it. */
  windowCaps: WindowCaps
  /** True when the result was cut short by a cap (rows/pages/slides/cells/bytes). */
  truncated: boolean
  /** Human-readable truncation notice. Present iff `truncated` is true. */
  notice?: string
  /** Format-specific payload. Exactly one is present. */
  pdf?: { pages: PageWindow[] }
  xlsx?: { sheets: SheetWindow[] }
  pptx?: { slides: SlideWindow[]; totalSlides?: number }
  ipynb?: { cells: CellWindow[] }
  docx?: { paragraphs: string[]; wordCount: number }
}

/** The windowing caps applied to a read. */
export interface WindowCaps {
  maxBytes: number
  maxPages: number
  maxSheetRows: number
  maxSheets: number
  maxSlides: number
  maxCells: number
}

/** Per-format windowing parameters passed to `doc_read`. */
export interface DocReadOptions {
  /** 1-based pdf page to start from. */
  page?: number
  /** Max pages to return (bounded by cap). */
  pages?: number
  /** Sheet name(s) to read; default: first sheet. */
  sheets?: string[]
  /** 1-based row offset within each sheet. */
  rowOffset?: number
  /** Max rows per sheet (bounded by cap). */
  rows?: number
  /** 0-based slide index to start from. */
  slide?: number
  /** Max slides (bounded by cap). */
  slides?: number
  /** 0-based cell index to start from. */
  cell?: number
  /** Max cells (bounded by cap). */
  cells?: number
}

/** Safety caps that apply to every input (zip bombs, macros). */
export interface SafetyCaps {
  /** Max raw input bytes accepted. */
  maxInputBytes: number
  /** Max decompressed bytes for OOXML zips (zip-bomb guard). */
  maxDecompressedBytes: number
  /** Max zip entries for OOXML zips. */
  maxZipEntries: number
}

export const DEFAULT_SAFETY_CAPS: SafetyCaps = {
  maxInputBytes: 64 * 1024 * 1024,
  maxDecompressedBytes: 512 * 1024 * 1024,
  maxZipEntries: 4096,
}

export const DEFAULT_WINDOW_CAPS: WindowCaps = {
  maxBytes: 256 * 1024,
  maxPages: 20,
  maxSheetRows: 200,
  maxSheets: 1,
  maxSlides: 20,
  maxCells: 200,
}

/** Format names in canonical order (used for docs and error messages). */
export const FORMATS: readonly DocFormat[] = ['xlsx', 'pdf', 'docx', 'pptx', 'ipynb']

/** Build the standard truncation notice text. */
export function truncationNotice(
  what: string,
  shown: number,
  total: number,
  kind: 'pages' | 'rows' | 'slides' | 'cells' | 'bytes',
): string {
  return `Truncated: showing ${shown} of ${total} ${kind}${total > shown ? `; call again with a higher offset to continue` : ''}.`
}
