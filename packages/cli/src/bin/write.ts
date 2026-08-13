#!/usr/bin/env node
/**
 * doc-write — CLI front for DSH Cowork's document writing.
 *
 * Usage:
 *   doc-write create <file> xlsx --spec spec.json [--force]
 *   doc-write create <file> ipynb --spec spec.json [--force]
 *   doc-write edit <file> --spec spec.json [--force]
 *
 * spec.json shapes (match @dsh-cowork/core):
 *   xlsx create:  { "sheets": [{ "name": "S1", "cells": [{ "ref": "A1", "value": 42 }] }] }
 *   xlsx edit:    { "format": "xlsx", "edits": [{ "sheet": "S1", "ref": "A1", "value": "x" }] }
 *   ipynb create: { "cells": [{ "type": "markdown", "source": "# Hi" }] }
 *   ipynb edit:   { "format": "ipynb", "edits": [{ "op": "replace", "cell": 0, "source": "..." }] }
 *
 * Writes are temp-file + atomic rename. `--force` skips the overwrite refusal
 * for existing files (CLI users are the authority; the DSH tool stays strict).
 */

import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { writeDocument, DocError, type XlsxValue } from '@dsh-cowork/core'

function usage(): never {
  console.error(`Usage:
  doc-write create <file> <xlsx|ipynb> --spec <spec.json> [--force]
  doc-write edit <file> --spec <spec.json> [--force]`)
  process.exit(2)
}

function atomicWrite(target: string, bytes: Uint8Array): void {
  const tmp = join(dirname(target), `.${randomUUID()}.tmp`)
  try {
    writeFileSync(tmp, bytes, { flag: 'wx', mode: 0o644 })
    renameSync(tmp, target)
  } catch (error) {
    try {
      unlinkSync(tmp)
    } catch {
      // noop
    }
    throw error
  }
}

interface XlsxCellSpec { ref: string; value: XlsxValue }
interface XlsxSheetSpec { name: string; cells: XlsxCellSpec[] }
interface IpynbCellSpec { type: 'markdown' | 'code' | 'raw'; source: string }
interface EditOp {
  op?: 'replace' | 'insert' | 'delete'
  sheet?: string
  ref?: string
  value?: XlsxValue
  cell?: number
  at?: number
  source?: string
  cells?: IpynbCellSpec[]
}

function fail(message: string): never {
  console.error(`doc-write: ${message}`)
  process.exit(1)
}

function main(): void {
  const args = process.argv.slice(2)
  const force = args.includes('--force')
  const specAt = args.indexOf('--spec')
  if (specAt === -1 || !args[specAt + 1]) usage()
  const specPath = args[specAt + 1]!

  const nonFlag = args.filter((a) => a !== specPath && !a.startsWith('--'))
  const operation = nonFlag.find((a) => a === 'create' || a === 'edit')
  const words = nonFlag.filter((a) => a !== operation)
  const file = words[0]
  if (!operation || !file) usage()
  if (operation === 'create' && !['xlsx', 'ipynb'].includes(words[1] ?? '')) usage()

  let spec: Record<string, unknown>
  try {
    spec = JSON.parse(readFileSync(specPath, 'utf8')) as Record<string, unknown>
  } catch (error) {
    fail(`cannot read spec: ${error instanceof Error ? error.message : String(error)}`)
  }

  const format = operation === 'create' ? (words[1] as 'xlsx' | 'ipynb') : (spec.format as 'xlsx' | 'ipynb')
  if (format !== 'xlsx' && format !== 'ipynb') fail('format must be xlsx or ipynb')

  if (operation === 'create' && !force && existsSync(file)) {
    fail(`"${file}" already exists; pass --force to overwrite.`)
  }

  const run = async (): Promise<void> => {
    if (operation === 'create') {
      const bytes = await writeDocument(format === 'xlsx'
        ? { format: 'xlsx', kind: 'create', sheets: (spec.sheets ?? []) as XlsxSheetSpec[] }
        : { format: 'ipynb', kind: 'create', cells: (spec.cells ?? []) as IpynbCellSpec[] })
      atomicWrite(file, bytes)
      console.log(`doc-write: created ${file} (${bytes.byteLength} bytes)`)
      return
    }
    let original: Uint8Array
    try {
      original = new Uint8Array(readFileSync(file))
    } catch (error) {
      fail(`cannot read ${file} for editing: ${error instanceof Error ? error.message : String(error)}`)
    }
    const edits = (spec.edits ?? []) as EditOp[]
    const bytes = await writeDocument(format === 'xlsx'
      ? {
          format: 'xlsx',
          kind: 'edit',
          original,
          edits: edits.map((e) => ({ sheet: String(e.sheet), ref: String(e.ref), value: e.value ?? null })),
        }
      : {
          format: 'ipynb',
          kind: 'edit',
          original,
          edits: edits.map((e) => {
            if (e.op === 'insert') return { op: 'insert' as const, at: e.at ?? 0, cells: e.cells ?? [] }
            if (e.op === 'delete') return { op: 'delete' as const, cell: e.cell ?? 0 }
            return { op: 'replace' as const, cell: e.cell ?? 0, source: e.source ?? '' }
          }),
        })
    atomicWrite(file, bytes)
    console.log(`doc-write: updated ${file} (${bytes.byteLength} bytes)`)
  }

  run().catch((error: unknown) => {
    const msg = error instanceof DocError ? error.message : error instanceof Error ? error.message : String(error)
    fail(msg)
  })
}

main()
