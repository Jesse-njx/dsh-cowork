/**
 * DSH Cowork — doc_read / doc_write tools for office documents and notebooks.
 *
 * A DSH bundle (`dsh plugin add @dsh-cowork/plugin`): registers the two tools
 * over the pure-TS @dsh-cowork/core, routing reads through `ctx.fs` (bounded
 * bytes, sandbox-aware resolution, observation events) and performing atomic
 * byte writes for the text-only fs service.
 * @module @dsh-cowork/plugin
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { DEFAULT_SAFETY_CAPS, DEFAULT_WINDOW_CAPS } from '@dsh-cowork/core'
import { applyDocReadTool, type CoworkCaps } from './doc-read.ts'
import { applyDocWriteTool } from './doc-write.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dsh-cowork'

/** Services required by the Cowork tool suite. */
export const inject = ['tools', 'fs', 'systemPrompt']

/** Plugin config (all optional — defaults match the core caps). */
export interface Config {
  /** Max raw input/output bytes for one document. */
  maxInputBytes?: number
  /** Max model-facing output bytes for one doc_read window. */
  maxOutputBytes?: number
  /** Max decompressed bytes for OOXML zips (zip-bomb guard). */
  maxDecompressedBytes?: number
  /** Max zip entries for OOXML zips. */
  maxZipEntries?: number
  /** PDF: max pages per window. */
  maxPages?: number
  /** xlsx: max rows per sheet window. */
  maxSheetRows?: number
  /** xlsx: max sheets per call. */
  maxSheets?: number
  /** pptx: max slides per window. */
  maxSlides?: number
  /** ipynb: max cells per window. */
  maxCells?: number
}

export const Config: z<Config> = z.object({
  maxInputBytes: z.number().default(DEFAULT_SAFETY_CAPS.maxInputBytes),
  maxOutputBytes: z.number().default(DEFAULT_WINDOW_CAPS.maxBytes),
  maxDecompressedBytes: z.number().default(DEFAULT_SAFETY_CAPS.maxDecompressedBytes),
  maxZipEntries: z.number().default(DEFAULT_SAFETY_CAPS.maxZipEntries),
  maxPages: z.number().default(DEFAULT_WINDOW_CAPS.maxPages),
  maxSheetRows: z.number().default(DEFAULT_WINDOW_CAPS.maxSheetRows),
  maxSheets: z.number().default(DEFAULT_WINDOW_CAPS.maxSheets),
  maxSlides: z.number().default(DEFAULT_WINDOW_CAPS.maxSlides),
  maxCells: z.number().default(DEFAULT_WINDOW_CAPS.maxCells),
})

/** The shape after schemastery applied the defaults. */
type ResolvedConfig = Required<Config>

/** Register the doc_read / doc_write tools. */
export function apply(ctx: Context, config: Config): void {
  const c = config as ResolvedConfig
  const caps: CoworkCaps = {
    maxInputBytes: c.maxInputBytes,
    maxOutputBytes: c.maxOutputBytes,
    maxDecompressedBytes: c.maxDecompressedBytes,
    maxZipEntries: c.maxZipEntries,
    window: {
      maxBytes: c.maxOutputBytes,
      maxPages: c.maxPages,
      maxSheetRows: c.maxSheetRows,
      maxSheets: c.maxSheets,
      maxSlides: c.maxSlides,
      maxCells: c.maxCells,
    },
  }
  applyDocReadTool(ctx, caps)
  applyDocWriteTool(ctx, caps)
}
