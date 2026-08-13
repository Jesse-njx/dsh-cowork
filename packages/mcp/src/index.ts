/**
 * DSH Cowork MCP server — exposes `doc_read` and `doc_write` over the Model
 * Context Protocol (stdio), so Codex, Claude Code, and any MCP client can read
 * and edit office documents / notebooks with the same bounded, addressed
 * windows and guardrails as the DSH plugin.
 *
 * NOTE: MCP runs outside DSH's sandbox — the server reads/writes paths the
 * client gives it (relative to the server's cwd). Safety caps (zip bombs,
 * macros, byte limits, atomic writes) still apply inside the server.
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { readDocument, writeDocument, renderMarkdown, DocError, type DocReadOptions } from '@dsh-cowork/core'
import { atomicWrite, sha256Hex } from './io.ts'

const DEFAULT_MAX_BYTES = 256 * 1024

/** Shared tool handlers, exported for in-process tests. */
export function createCoworkServer(): McpServer {
  const server = new McpServer({
    name: 'dsh-cowork',
    version: '0.1.0',
  })

  server.registerTool('doc_read', {
    title: 'Read a document window',
    description: 'Read a bounded, addressed window from xlsx / pdf / docx / pptx / ipynb. ' +
      'Results include stable addresses (cell refs for xlsx, shape ids for pptx). ' +
      'Window further with page/pages, sheets/rows/row_offset, slide/slides, cell/cells. ' +
      'A "> Truncated:" notice means the window was cut short — continue with a higher offset.',
    inputSchema: {
      file_path: z.string().describe('Path to the document (relative to the server cwd).'),
      page: z.number().int().positive().optional().describe('PDF: 1-based first page.'),
      pages: z.number().int().positive().optional().describe('PDF: max pages.'),
      sheets: z.array(z.string()).optional().describe('xlsx: sheet names.'),
      row_offset: z.number().int().positive().optional().describe('xlsx: 1-based first row.'),
      rows: z.number().int().positive().optional().describe('xlsx: max rows per sheet.'),
      slide: z.number().int().nonnegative().optional().describe('pptx: 0-based first slide.'),
      slides: z.number().int().positive().optional().describe('pptx: max slides.'),
      cell: z.number().int().nonnegative().optional().describe('ipynb: 0-based first cell.'),
      cells: z.number().int().positive().optional().describe('ipynb: max cells.'),
      max_bytes: z.number().int().positive().optional().describe('Output byte budget.'),
    },
  }, async (args) => {
    const options: DocReadOptions = {}
    if (args.page !== undefined) options.page = args.page
    if (args.pages !== undefined) options.pages = args.pages
    if (args.sheets !== undefined) options.sheets = args.sheets
    if (args.row_offset !== undefined) options.rowOffset = args.row_offset
    if (args.rows !== undefined) options.rows = args.rows
    if (args.slide !== undefined) options.slide = args.slide
    if (args.slides !== undefined) options.slides = args.slides
    if (args.cell !== undefined) options.cell = args.cell
    if (args.cells !== undefined) options.cells = args.cells

    let data: Uint8Array
    try {
      data = new Uint8Array(readFileSync(args.file_path))
    } catch (error) {
      return errorText(`doc_read: cannot read ${args.file_path}: ${error instanceof Error ? error.message : String(error)}`)
    }
    try {
      const result = await readDocument({ data, path: args.file_path, options })
      const text = renderMarkdown(result, args.max_bytes ?? DEFAULT_MAX_BYTES)
      const footer = `\n\n<!-- dsh-cowork: sha256=${sha256Hex(data)} -->`
      return { content: [{ type: 'text', text: text + footer }] }
    } catch (error) {
      return errorText(docMessage(error))
    }
  })

  server.registerTool('doc_write', {
    title: 'Create or edit a document',
    description: 'Create or edit xlsx / ipynb by stable address. ' +
      'xlsx create: sheets=[{name, cells:[{ref, value}]}]. ' +
      'xlsx edit: edits=[{sheet, ref, value}]. ' +
      'ipynb create: cells=[{type, source}]. ' +
      'ipynb edit: edits=[{op: replace|insert|delete, cell?, at?, source?, cells?}] with format. ' +
      'Writes are atomic. Overwriting an existing file requires force=true. ' +
      'expected_sha256 (from doc_read) guards against editing a changed file.',
    inputSchema: {
      file_path: z.string().describe('Path to write (relative to the server cwd).'),
      format: z.enum(['xlsx', 'ipynb']),
      operation: z.enum(['create', 'edit']),
      sheets: z.array(z.object({
        name: z.string(),
        cells: z.array(z.object({
          ref: z.string(),
          value: z.union([z.string(), z.number(), z.boolean(), z.null(), z.object({ formula: z.string() })]),
        })),
      })).optional(),
      edits: z.array(z.object({
        sheet: z.string(),
        ref: z.string(),
        value: z.union([z.string(), z.number(), z.boolean(), z.null(), z.object({ formula: z.string() })]),
      })).optional(),
      cells: z.array(z.object({ type: z.enum(['markdown', 'code', 'raw']), source: z.string() })).optional(),
      ipynb_edits: z.array(z.object({
        op: z.enum(['replace', 'insert', 'delete']),
        cell: z.number().int().optional(),
        at: z.number().int().optional(),
        source: z.string().optional(),
        cells: z.array(z.object({ type: z.enum(['markdown', 'code', 'raw']), source: z.string() })).optional(),
      })).optional(),
      force: z.boolean().optional().describe('Allow overwriting an existing file on create.'),
      expected_sha256: z.string().optional().describe('Guard: fail if the file content changed since this hash was read.'),
    },
  }, async (args) => {
    if (args.format !== 'xlsx' && args.format !== 'ipynb') return errorText('doc_write: format must be xlsx or ipynb')
    const target = resolvePath(args.file_path)

    if (args.operation === 'edit') {
      let original: Uint8Array
      try {
        original = new Uint8Array(readFileSync(target))
      } catch (error) {
        return errorText(`doc_write: ${args.file_path} not found; read it with doc_read first (edit requires a prior read).`)
      }
      if (args.expected_sha256 !== undefined && sha256Hex(original) !== args.expected_sha256) {
        return errorText(`doc_write: content changed since it was read (sha256 mismatch); re-read with doc_read and retry.`)
      }
      const spec = args.format === 'xlsx'
        ? { format: 'xlsx' as const, kind: 'edit' as const, original, edits: args.edits ?? [] }
        : {
            format: 'ipynb' as const,
            kind: 'edit' as const,
            original,
            edits: (args.ipynb_edits ?? []).map((e) => {
              if (e.op === 'insert') return { op: 'insert' as const, at: e.at ?? 0, cells: e.cells ?? [] }
              if (e.op === 'delete') return { op: 'delete' as const, cell: e.cell ?? 0 }
              return { op: 'replace' as const, cell: e.cell ?? 0, source: e.source ?? '' }
            }),
          }
      return commitWrite(target, spec)
    }

    // create
    if (!args.force && existsSync(target)) {
      return errorText(`doc_write: ${args.file_path} already exists; pass force=true to overwrite.`)
    }
    const spec = args.format === 'xlsx'
      ? { format: 'xlsx' as const, kind: 'create' as const, sheets: args.sheets ?? [] }
      : { format: 'ipynb' as const, kind: 'create' as const, cells: args.cells ?? [] }
    return commitWrite(target, spec)
  })

  return server
}

async function commitWrite(target: string, spec: Parameters<typeof writeDocument>[0]): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  try {
    const bytes = await writeDocument(spec)
    atomicWrite(target, bytes)
    return { content: [{ type: 'text', text: `doc_write: ${existsSync(target) ? 'updated' : 'created'} ${target} (${bytes.byteLength} bytes, sha256 ${sha256Hex(bytes)})` }] }
  } catch (error) {
    return errorText(docMessage(error))
  }
}

function docMessage(error: unknown): string {
  if (error instanceof DocError) return `doc: ${error.message}`
  return error instanceof Error ? error.message : String(error)
}

function errorText(text: string): { content: Array<{ type: 'text'; text: string }>; isError: boolean } {
  return { content: [{ type: 'text', text }], isError: true }
}

/** Resolve a client path against the server cwd; absolute paths pass through. */
export function resolvePath(p: string): string {
  return p.startsWith('/') ? p : join(process.cwd(), p)
}

/** Main entry: connect over stdio. */
async function main(): Promise<void> {
  const server = createCoworkServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

// Auto-start only when executed directly (not when imported by tests).
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
