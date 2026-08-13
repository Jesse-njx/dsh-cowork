/**
 * xlsx writer — create new workbooks or edit existing ones by *stable cell
 * address*. Guardrails:
 * - never loads macro-enabled workbooks (checked before any edit);
 * - every touched sheet gets its cached formula results cleared so Excel /
 *   LibreOffice recalculate on open (exceljs never recalculates);
 * - outputs are plain .xlsx only.
 */

import ExcelJS from 'exceljs'
import { DocError } from '../safety.ts'
import { sniff } from '../sniff.ts'

export type XlsxValue = string | number | boolean | null | { formula: string }

export interface XlsxCellSpec {
  /** Stable address, e.g. `A1`. */
  ref: string
  value: XlsxValue
}

export interface XlsxSheetSpec {
  name: string
  cells: XlsxCellSpec[]
}

export interface XlsxCreateSpec {
  kind: 'create'
  sheets: XlsxSheetSpec[]
}

export interface XlsxEditOp {
  sheet: string
  ref: string
  value: XlsxValue
}

export interface XlsxEditSpec {
  kind: 'edit'
  /** Original workbook bytes; required for edit. */
  original: Uint8Array
  edits: XlsxEditOp[]
}

export type XlsxWriteSpec = XlsxCreateSpec | XlsxEditSpec

function columnIndex(ref: string): number {
  const m = /^([A-Za-z]+)(\d+)$/.exec(ref)
  if (!m) throw new DocError('PARSE_FAILED', `Invalid cell reference "${ref}".`)
  let col = 0
  for (const ch of m[1]!.toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64)
  return col
}

function rowIndex(ref: string): number {
  const m = /^[A-Za-z]+(\d+)$/.exec(ref)
  return m ? Number(m[1]) : NaN
}

function assign(worksheet: ExcelJS.Worksheet, ref: string, value: XlsxValue): void {
  const cell = worksheet.getCell(ref)
  if (value === null) {
    cell.value = null
  } else if (typeof value === 'object' && 'formula' in value) {
    // Formula without a cached result → engines recalculate on open.
    cell.value = { formula: value.formula }
  } else {
    cell.value = value
  }
  void columnIndex(ref)
  void rowIndex(ref)
}

/** Clear cached formula results across a worksheet so engines recalculate. */
function clearCachedResults(worksheet: ExcelJS.Worksheet): void {
  worksheet.eachRow((row) => {
    row.eachCell((cell) => {
      const v = cell.value
      if (v !== null && typeof v === 'object' && 'formula' in v) {
        cell.value = { formula: (v as { formula: string }).formula }
      }
    })
  })
}

function ensureNoMacros(data: Uint8Array, what: string): Promise<void> {
  return sniff(data).then((s) => {
    if (s.format === 'xlsm' || s.format === 'docm' || s.format === 'pptm') {
      throw new DocError('MACRO_FORMAT_REJECTED', `Cannot ${what}: macro-enabled formats are never read or written by DSH Cowork.`)
    }
  })
}

/** Serialize to .xlsx bytes. */
export async function writeXlsx(spec: XlsxWriteSpec): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook()

  if (spec.kind === 'edit') {
    await ensureNoMacros(spec.original, 'edit a macro-enabled workbook')
    try {
      await workbook.xlsx.load(spec.original.slice().buffer as ArrayBuffer)
    } catch (e) {
      throw new DocError('PARSE_FAILED', `Could not load the workbook for editing: ${e instanceof Error ? e.message : String(e)}`)
    }
    for (const op of spec.edits) {
      const ws = workbook.getWorksheet(op.sheet)
      if (!ws) throw new DocError('PARSE_FAILED', `Sheet "${op.sheet}" does not exist.`)
      assign(ws, op.ref, op.value)
      clearCachedResults(ws)
    }
  } else {
    for (const sheet of spec.sheets) {
      const ws = workbook.addWorksheet(sheet.name)
      for (const cell of sheet.cells) assign(ws, cell.ref, cell.value)
      clearCachedResults(ws)
    }
  }

  const buf = await workbook.xlsx.writeBuffer()
  return new Uint8Array(buf as ArrayBuffer)
}
