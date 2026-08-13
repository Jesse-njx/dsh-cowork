/**
 * The `doc_read` tool — bounded, addressed windows into office documents and
 * notebooks. Mirrors the shape of `dsh-tool-fs`'s `read`: one stat, bounded
 * bytes, windowed result, explicit truncation, observation emission.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type GenericCallView, type JsonValue, type ReadResultView, type ToolResult } from '@deepseek-ai/dsh-tools'
import type { DocReadResult, DocReadOptions, WindowCaps } from '@dsh-cowork/core'
import { readDocument, renderMarkdown, DocError, type SafetyCaps } from '@dsh-cowork/core'
import { sha256Hex } from './binary.ts'
import { fsErrorText, resolveRegularReadTarget } from './helpers.ts'

/** Resolved Cowork caps (plugin config after defaulting). */
export interface CoworkCaps {
  maxInputBytes: number
  maxOutputBytes: number
  maxDecompressedBytes: number
  maxZipEntries: number
  window: WindowCaps
}

function toOptions(args: Record<string, unknown>): DocReadOptions {
  const o: DocReadOptions = {}
  if (typeof args.page === 'number') o.page = args.page
  if (typeof args.pages === 'number') o.pages = args.pages
  if (Array.isArray(args.sheets) && args.sheets.every((s) => typeof s === 'string')) o.sheets = args.sheets as string[]
  if (typeof args.row_offset === 'number') o.rowOffset = args.row_offset
  if (typeof args.rows === 'number') o.rows = args.rows
  if (typeof args.slide === 'number') o.slide = args.slide
  if (typeof args.slides === 'number') o.slides = args.slides
  if (typeof args.cell === 'number') o.cell = args.cell
  if (typeof args.cells === 'number') o.cells = args.cells
  return o
}

/** The canonical doc_read output carried on the wire. */
export interface DocReadOutput {
  format: 'xlsx' | 'pdf' | 'docx' | 'pptx' | 'ipynb'
  path: string
  offset: number
  truncated: boolean
  notice?: string
  /** Content hash of the exact bytes read — the edit guard for doc_write. */
  sha256: string
  /** The fs version observed at read time — the stale guard for doc_write. */
  version: string
  /** The bounded, addressed read window (see @dsh-cowork/core DocReadResult). */
  payload: JsonValue
}

/** Register the `doc_read` tool + system-prompt guidance. */
export function applyDocReadTool(ctx: Context, caps: CoworkCaps): void {
  ctx.systemPrompt.section({
    name: 'tool:doc_read',
    order: 102,
    text: 'Use doc_read — not shell commands — to read office documents and notebooks (xlsx, pdf, docx, pptx, ipynb). Results are bounded windows with stable addresses (cell refs for xlsx, shape ids for pptx); pass page/pages, sheets/rows/row_offset, slide/slides, or cell/cells to window further. The result footer carries sha256 + version for a guarded doc_write.',
  })

  ctx.tools.register(defineTool({
    name: 'doc_read',
    description: 'Read a bounded, addressed window from an office document or notebook (xlsx, pdf, docx, pptx, ipynb).',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Path to the document, resolved by the filesystem backend.' },
      page: { type: 'integer', description: 'PDF: 1-based first page to return. Defaults to 1.' },
      pages: { type: 'integer', description: 'PDF: maximum pages to return (bounded by the deployment cap).' },
      sheets: { type: 'array', items: { type: 'string' }, description: 'xlsx: sheet name(s) to read; defaults to the first sheet.' },
      row_offset: { type: 'integer', description: 'xlsx: 1-based first row within each sheet. Defaults to 1.' },
      rows: { type: 'integer', description: 'xlsx: maximum rows per sheet (bounded by the deployment cap).' },
      slide: { type: 'integer', description: 'pptx: 0-based first slide to return. Defaults to 0.' },
      slides: { type: 'integer', description: 'pptx: maximum slides (bounded by the deployment cap).' },
      cell: { type: 'integer', description: 'ipynb: 0-based first cell to return. Defaults to 0.' },
      cells: { type: 'integer', description: 'ipynb: maximum cells (bounded by the deployment cap).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          format: { type: 'string', required: true, enum: ['xlsx', 'pdf', 'docx', 'pptx', 'ipynb'] },
          path: { type: 'string', required: true },
          offset: { type: 'integer', required: true },
          truncated: { type: 'boolean', required: true },
          notice: { type: 'string' },
          sha256: { type: 'string', required: true },
          version: { type: 'string', required: true },
          payload: { type: 'json', required: true },
        },
      },
      render: (args, value) => {
        const payload = value.payload as unknown as DocReadResult
        const md = renderMarkdown(payload, caps.maxOutputBytes)
        const footer = `\n\n<!-- dsh-cowork: sha256=${value.sha256} version=${value.version} -->`
        return [{ type: 'text', text: md + footer }]
      },
      presentationMeta: (_args, value) => ({
        path: value.path,
        format: value.format,
        offset: value.offset,
        truncated: value.truncated,
        sha256: value.sha256,
        version: value.version,
      }),
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const raw = args as Record<string, unknown>
      const filePath = String(raw.file_path)
      const safety: SafetyCaps = {
        maxInputBytes: caps.maxInputBytes,
        maxDecompressedBytes: caps.maxDecompressedBytes,
        maxZipEntries: caps.maxZipEntries,
      }
      const { target, info } = await resolveRegularReadTarget(ctx, exec, filePath)
      let data: Uint8Array
      try {
        data = await ctx.fs.readBytes(target, exec.signal, caps.maxInputBytes)
      } catch (error) {
        throw new Error(`doc_read: ${fsErrorText(error)}`)
      }
      const result = await readDocument({
        data,
        path: target.displayPath,
        options: toOptions(raw),
        windowCaps: caps.window,
        safetyCaps: safety,
      })
      ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, exec)
      const output: DocReadOutput = {
        format: result.format,
        path: result.path,
        offset: result.offset,
        truncated: result.truncated,
        ...(result.notice !== undefined ? { notice: result.notice } : {}),
        sha256: sha256Hex(data),
        version: String(info.version),
        payload: result as unknown as JsonValue,
      }
      return output
    },
    presentCall(args): GenericCallView {
      const raw = args as Record<string, unknown>
      const title = `Read doc ${raw.file_path}`
      return { card: 'generic', title, kind: 'read', locations: [{ path: String(raw.file_path) }] }
    },
    presentResult(_args, result: ToolResult): ReadResultView | undefined {
      if (result.isError) return undefined
      const meta = result.meta as { path?: string; offset?: number } | undefined
      if (meta?.path === undefined) return undefined
      const only = result.content.length === 1 ? result.content[0] : undefined
      const text = only?.type === 'text' ? only.text : undefined
      if (text === undefined) return undefined
      return {
        card: 'read',
        path: meta.path,
        offset: meta.offset ?? 1,
        lines: [],
        totalLines: 0,
        content: [{ type: 'text', text }],
      }
    },
  }))
}

/** Surface a DocError with its stable code to the model. */
export function docErrorText(error: unknown): string {
  if (error instanceof DocError) return `doc_read: ${error.message}`
  return error instanceof Error ? error.message : String(error)
}
