/**
 * The `doc_write` tool — create or edit xlsx / ipynb by stable address, with
 * the Fable-5 guardrails:
 * - read-only sandbox mode hard-blocks every write;
 * - edit requires the file to have been read this session (`expected_version`
 *   from the doc_read footer) and optionally a content-hash check
 *   (`expected_sha256`) — stale or changed files fail closed;
 * - create refuses to silently overwrite a file that was never read;
 * - every write is temp-file + atomic rename, with byte caps and the new
 *   version re-observed afterwards.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type DiffCallView, type DiffResultView, type ToolResult } from '@deepseek-ai/dsh-tools'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type { IpynbEditKind, XlsxEditOp, XlsxValue } from '@dsh-cowork/core'
import { writeDocument, DocError, type XlsxValue as CoreXlsxValue } from '@dsh-cowork/core'
import { sha256Hex, writeFileAtomicBytes } from './binary.ts'
import { fsErrorText, readOnlyDenial, sessionResolveOptions } from './helpers.ts'
import type { CoworkCaps } from './doc-read.ts'

interface DocWriteArgs {
  file_path: string
  format: 'xlsx' | 'ipynb'
  operation: 'create' | 'edit'
  sheets?: Array<{ name: string; cells: Array<{ ref: string; value: XlsxValue }> }>
  edits?: XlsxEditOp[]
  cells?: Array<{ type: 'markdown' | 'code' | 'raw'; source: string }>
  ipynb_edits?: Array<{
    op: 'replace' | 'insert' | 'delete'
    cell?: number
    at?: number
    source?: string
    cells?: Array<{ type: 'markdown' | 'code' | 'raw'; source: string }>
  }>
  expected_version?: string
  expected_sha256?: string
}

function toXlsxValue(v: unknown): XlsxValue {
  if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  if (typeof v === 'object' && v !== null && 'formula' in v && typeof (v as { formula: unknown }).formula === 'string') {
    return { formula: (v as { formula: string }).formula }
  }
  return String(v)
}

function toIpynbEdits(raw: DocWriteArgs['ipynb_edits']): IpynbEditKind[] {
  return (raw ?? []).map((e) => {
    if (e.op === 'replace') return { op: 'replace', cell: e.cell ?? 0, source: e.source ?? '' }
    if (e.op === 'insert') return { op: 'insert', at: e.at ?? 0, cells: e.cells ?? [] }
    return { op: 'delete', cell: e.cell ?? 0 }
  })
}

function assertValidated(
  target: FsTarget,
  exec: ToolExecution,
  expectedVersion: string | undefined,
  expectedSha256: string | undefined,
  info: { version: string },
  data: Uint8Array,
  forOverwrite: boolean,
): void {
  const current = String(info.version)
  if (expectedVersion !== undefined && current !== expectedVersion) {
    throw new Error(`doc_write: "${target.displayPath}" changed since it was read (version ${current} ≠ expected ${expectedVersion}); re-read with doc_read and retry.`)
  }
  if (expectedSha256 !== undefined) {
    const hash = sha256Hex(data)
    if (hash !== expectedSha256) {
      throw new Error(`doc_write: "${target.displayPath}" content changed since it was read (sha256 mismatch); re-read with doc_read and retry.`)
    }
  }
  if (forOverwrite && expectedVersion === undefined && expectedSha256 === undefined) {
    throw new Error(`doc_write: refusing to overwrite "${target.displayPath}" without a prior read; read it with doc_read first, or pass the expected_version from the read footer.`)
  }
}

/** Register the `doc_write` tool + system-prompt guidance. */
export function applyDocWriteTool(ctx: Context, caps: CoworkCaps): void {
  ctx.systemPrompt.section({
    name: 'tool:doc_write',
    order: 103,
    text: 'Use doc_write to create or edit xlsx / ipynb files by stable address. Editing requires the file to have been read this session: pass expected_version (and optionally expected_sha256) from the doc_read footer. Writes are atomic; never emit macro formats.',
  })

  ctx.tools.register(defineTool({
    name: 'doc_write',
    description: 'Create or edit an xlsx / ipynb file by stable address, with atomic writes and read-guards.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Path to write, resolved by the filesystem backend.' },
      format: { type: 'string', required: true, enum: ['xlsx', 'ipynb'], description: 'Document format to write.' },
      operation: { type: 'string', required: true, enum: ['create', 'edit'], description: 'create = new file (refuses to overwrite unread files); edit = modify an existing file.' },
      sheets: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { name: { type: 'string', required: true, description: 'Sheet name.' }, cells: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { ref: { type: 'string', required: true, description: 'Cell reference, e.g. A1.' }, value: { type: 'json', description: 'Cell value: string, number, boolean, null, or { formula: "SUM(A1:A2)" }.' } } } } } }, description: 'xlsx create: sheets to build.' },
      edits: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { sheet: { type: 'string', required: true, description: 'Sheet name.' }, ref: { type: 'string', required: true, description: 'Cell reference, e.g. B3.' }, value: { type: 'json', description: 'New cell value: string, number, boolean, null, or { formula }.' } } }, description: 'xlsx edit: cell patches by stable address.' },
      cells: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { type: { type: 'string', required: true, enum: ['markdown', 'code', 'raw'] }, source: { type: 'string', required: true, description: 'Cell source text.' } } }, description: 'ipynb create: notebook cells.' },
      ipynb_edits: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { op: { type: 'string', required: true, enum: ['replace', 'insert', 'delete'] }, cell: { type: 'integer', description: 'replace/delete: 0-based cell index.' }, at: { type: 'integer', description: 'insert: 0-based position.' }, source: { type: 'string', description: 'replace: new source.' }, cells: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { type: { type: 'string', required: true, enum: ['markdown', 'code', 'raw'] }, source: { type: 'string', required: true } } }, description: 'insert: cells to add.' } } }, description: 'ipynb edit: cell operations.' },
      expected_version: { type: 'string', description: 'Guard: the version from the doc_read footer; mismatches fail the write.' },
      expected_sha256: { type: 'string', description: 'Guard: the sha256 from the doc_read footer; content mismatches fail the write.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          operation: { type: 'string', required: true, enum: ['create', 'update'] },
          version: { type: 'string', required: true },
          sha256: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `<path>${value.path}</path>\n<type>file</type>\n<content>\n${value.operation === 'create' ? 'Created' : 'Updated'} file (sha256 ${value.sha256})\n</content>`,
      }],
      presentationMeta: (_args, value) => ({ path: value.path, operation: value.operation, version: value.version, sha256: value.sha256 }),
    },
    async execute(args, exec) {
      const raw = args as unknown as DocWriteArgs
      const denial = readOnlyDenial(ctx, exec)
      if (denial !== undefined) throw new Error(denial)
      if (raw.format !== 'xlsx' && raw.format !== 'ipynb') throw new Error('doc_write: format must be xlsx or ipynb')
      if (raw.operation !== 'create' && raw.operation !== 'edit') throw new Error('doc_write: operation must be create or edit')

      const target = await ctx.fs.resolve(raw.file_path, sessionResolveOptions(exec, raw.file_path))
      const info = await ctx.fs.stat(target, exec.signal)

      let newBytes: Uint8Array

      if (raw.operation === 'edit') {
        if (info === undefined) {
          ctx.emit('fs/observed', target, { kind: 'absent' }, exec)
          throw new Error(`doc_write: "${target.displayPath}" not found; read it with doc_read first (edit requires a prior read).`)
        }
        const existing = await ctx.fs.readBytes(target, exec.signal, caps.maxInputBytes)
        assertValidated(target, exec, raw.expected_version, raw.expected_sha256, { version: String(info.version) }, existing, false)
        if (raw.format === 'xlsx') {
          newBytes = await writeDocument({
            format: 'xlsx',
            kind: 'edit',
            original: existing,
            edits: (raw.edits ?? []).map((e) => ({ sheet: e.sheet, ref: e.ref, value: toXlsxValue(e.value) })),
          })
        } else {
          newBytes = await writeDocument({ format: 'ipynb', kind: 'edit', original: existing, edits: toIpynbEdits(raw.ipynb_edits) })
        }
      } else {
        // create: refuse to overwrite an existing file that was never read.
        if (info !== undefined) {
          const existing = await ctx.fs.readBytes(target, exec.signal, caps.maxInputBytes)
          assertValidated(target, exec, raw.expected_version, raw.expected_sha256, { version: String(info.version) }, existing, true)
        }
        if (raw.format === 'xlsx') {
          newBytes = await writeDocument({
            format: 'xlsx',
            kind: 'create',
            sheets: (raw.sheets ?? []).map((s) => ({ name: s.name, cells: s.cells.map((c) => ({ ref: c.ref, value: toXlsxValue(c.value) })) })),
          })
        } else {
          newBytes = await writeDocument({ format: 'ipynb', kind: 'create', cells: raw.cells ?? [] })
        }
      }

      if (newBytes.byteLength > caps.maxInputBytes) {
        throw new Error(`doc_write: generated ${newBytes.byteLength} bytes, exceeding the ${caps.maxInputBytes}-byte output cap.`)
      }

      // The one out-of-band primitive: atomic temp + rename (see binary.ts).
      let processPath: string
      try {
        processPath = ctx.fs.processPath(target)
      } catch (error) {
        throw new Error(`doc_write: the mounted filesystem backend does not expose a writable OS path (${fsErrorText(error)})`)
      }
      try {
        writeFileAtomicBytes(processPath, newBytes)
      } catch (error) {
        throw new Error(`doc_write: atomic write failed: ${fsErrorText(error)}`)
      }

      // Re-observe the real post-write version so later guarded reads/writes
      // (including the built-in fs tools) see a coherent observed state.
      const after = await ctx.fs.stat(target, exec.signal)
      const version = after?.version ?? (info?.version as never)
      ctx.emit('fs/observed', target, { kind: 'present', version }, exec)

      const operation: 'create' | 'update' = info === undefined ? 'create' : 'update'
      return {
        path: target.displayPath,
        operation,
        version: String(version),
        sha256: sha256Hex(newBytes),
      }
    },
    presentCall(args): DiffCallView {
      const raw = args as unknown as DocWriteArgs
      return {
        card: 'diff',
        title: `${raw.operation === 'edit' ? 'Edit' : 'Create'} doc ${raw.file_path}`,
        diffs: [{ path: raw.file_path, oldText: null, newText: `doc_write ${raw.format} (${raw.operation})` }],
        locations: [{ path: raw.file_path }],
      }
    },
    presentResult(args, result: ToolResult): DiffResultView | undefined {
      if (result.isError) return undefined
      const raw = args as unknown as DocWriteArgs
      return {
        card: 'diff',
        title: `Write doc ${raw.file_path}`,
        diffs: [{ path: raw.file_path, oldText: null, newText: `doc_write ${raw.format} (${raw.operation})` }],
      }
    },
  }))
}

/** Surface a DocError with its stable code. */
export function writeDocErrorText(error: unknown): string {
  if (error instanceof DocError) return `doc_write: ${error.message}`
  return error instanceof Error ? error.message : String(error)
}
