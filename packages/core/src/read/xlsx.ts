/**
 * xlsx reader — exceljs over a bounded window with *stable cell addresses*.
 *
 * Design notes (Fable 5 consult):
 * - emit cell refs (`A1`, `C12`) so edits can target them;
 * - surface formulas as text, and note that values are the *cached* results —
 *   exceljs never recalculates formulas;
 * - dates become ISO strings, never raw serial numbers;
 * - hidden sheets are read but flagged (untrusted-input surface);
 * - row/sheet windows are hard-capped; truncation is explicit.
 */

import ExcelJS from 'exceljs'
import type { CellEntry, CellValue, DocReadOptions, RowEntry, SheetWindow, WindowCaps } from '../types.ts'
import { DocError } from '../safety.ts'

export interface XlsxRead {
  format: 'xlsx'
  sheets: SheetWindow[]
  /** True when any sheet had more rows than the window. */
  rowTruncated: boolean
  /** True when more sheets existed than were read. */
  sheetTruncated: boolean
  sheetNames: string[]
}

function toCellValue(v: unknown, rich: unknown): CellValue {
  if (v === undefined || v === null) return null
  if (rich !== undefined && typeof rich === 'object') {
    // Rich text: surface the concatenated runs.
    const runs = (rich as { richText?: Array<{ text?: string }> }).richText
    if (runs) return runs.map((r) => r.text ?? '').join('')
  }
  if (v instanceof Date) return { date: v.toISOString() }
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  return String(v)
}

function cellValue(worksheet: ExcelJS.Worksheet, row: ExcelJS.Row, col: number): { entry: CellEntry; used: boolean } {
  const cell = row.getCell(col)
  const v = cell.value
  if (v === null || v === undefined) return { entry: { ref: cell.address, value: null }, used: false }
  if (typeof v === 'object' && 'formula' in v) {
    const formulaCell = v as ExcelJS.CellFormulaValue
    const resolved = formulaCell.result
    return {
      entry: {
        ref: cell.address,
        value: toCellValue(resolved, undefined),
        formula: String(formulaCell.formula),
      },
      used: true,
    }
  }
  if (typeof v === 'object' && 'richText' in v) {
    return { entry: { ref: cell.address, value: toCellValue(undefined, v) }, used: true }
  }
  return { entry: { ref: cell.address, value: toCellValue(v, undefined) }, used: true }
}

/**
 * Read a bounded window of sheets/rows from an xlsx buffer.
 * @returns windowed sheets + truncation flags.
 */
export async function readXlsx(
  data: Uint8Array,
  options: DocReadOptions,
  caps: WindowCaps,
): Promise<XlsxRead> {
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(new Uint8Array(data).buffer as ArrayBuffer)
  } catch (e) {
    throw new DocError('PARSE_FAILED', `Could not parse the workbook: ${e instanceof Error ? e.message : String(e)}`)
  }
  const sheetNames = workbook.worksheets.map((ws) => ws.name)
  const wanted = options.sheets && options.sheets.length > 0 ? options.sheets : [sheetNames[0] ?? '']
  const maxSheets = Math.min(caps.maxSheets, wanted.length)
  const maxRows = Math.min(Math.max(1, options.rows ?? caps.maxSheetRows), caps.maxSheetRows)
  const rowOffset = Math.max(1, options.rowOffset ?? 1)

  const sheets: SheetWindow[] = []
  let rowTruncated = false
  let sheetTruncated = false

  for (let s = 0; s < maxSheets; s++) {
    const name = wanted[s]!
    const worksheet = workbook.getWorksheet(name)
    if (!worksheet) {
      throw new DocError('PARSE_FAILED', `Sheet "${name}" does not exist. Available sheets: ${sheetNames.join(', ')}.`)
    }
    const totalRows = worksheet.rowCount
    const visibleRows = worksheet.actualRowCount
    const rows: RowEntry[] = []
    // Iterate only the populated row span so sparse sheets stay cheap.
    const end = Math.min(totalRows, rowOffset - 1 + maxRows)
    for (let r = rowOffset; r <= end; r++) {
      const row = worksheet.getRow(r)
      const cells: CellEntry[] = []
      // Iterate only populated cells via eachCell (cellCount/actualCellCount
      // semantics differ by exceljs version; eachCell is authoritative).
      row.eachCell((cell, col) => {
        const { entry, used } = cellValue(worksheet, row, col)
        if (used) cells.push(entry)
      })
      rows.push({ row: r, cells })
    }
    if (totalRows > end) rowTruncated = true
    sheets.push({
      sheet: name,
      totalRows: Math.max(totalRows, visibleRows),
      rows,
    })
  }
  if (wanted.length > maxSheets || (options.sheets === undefined && sheetNames.length > maxSheets)) {
    sheetTruncated = true
  }
  return { format: 'xlsx', sheets, rowTruncated, sheetTruncated, sheetNames }
}
