/**
 * ipynb writer — build notebooks from a cell spec, or edit an existing one
 * (replace/insert/delete by 0-based cell index). Pure JSON; no dependencies.
 */

import { DocError } from '../safety.ts'

export type IpynbCellType = 'markdown' | 'code' | 'raw'

export interface IpynbCellSpec {
  type: IpynbCellType
  source: string
}

export type IpynbEditKind =
  | { op: 'replace'; cell: number; source: string }
  | { op: 'insert'; at: number; cells: IpynbCellSpec[] }
  | { op: 'delete'; cell: number }

export interface IpynbCreateSpec {
  kind: 'create'
  cells: IpynbCellSpec[]
}

export interface IpynbEditSpec {
  kind: 'edit'
  /** Original notebook bytes; required for edit. */
  original: Uint8Array
  edits: IpynbEditKind[]
}

export type IpynbWriteSpec = IpynbCreateSpec | IpynbEditSpec

interface NotebookCell {
  cell_type: string
  metadata: Record<string, unknown>
  source: string[]
  execution_count: number | null
  outputs: unknown[]
}

function toCell(c: IpynbCellSpec): NotebookCell {
  return {
    cell_type: c.type,
    metadata: {},
    source: c.source.split('\n').map((l, i, a) => (i === a.length - 1 ? l : l + '\n')),
    execution_count: c.type === 'code' ? null : null,
    outputs: [],
  }
}

function sourceOf(c: NotebookCell): string {
  return Array.isArray(c.source) ? c.source.join('') : String(c.source ?? '')
}

/** Serialize a notebook spec to .ipynb bytes. */
export function writeIpynb(spec: IpynbWriteSpec): Uint8Array {
  let cells: NotebookCell[]

  if (spec.kind === 'edit') {
    let nb: { cells?: unknown[] }
    try {
      nb = JSON.parse(new TextDecoder('utf-8').decode(spec.original)) as { cells?: unknown[] }
    } catch {
      throw new DocError('PARSE_FAILED', 'The notebook is not valid JSON.')
    }
    if (!Array.isArray(nb.cells)) throw new DocError('PARSE_FAILED', 'The notebook has no `cells` array.')
    cells = nb.cells as NotebookCell[]
    for (const edit of spec.edits) {
      if (edit.op === 'replace') {
        if (edit.cell < 0 || edit.cell >= cells.length) throw new DocError('PARSE_FAILED', `Cell index ${edit.cell} out of range (0..${cells.length - 1}).`)
        cells[edit.cell] = toCell({ type: 'code', source: edit.source })
      } else if (edit.op === 'delete') {
        if (edit.cell < 0 || edit.cell >= cells.length) throw new DocError('PARSE_FAILED', `Cell index ${edit.cell} out of range (0..${cells.length - 1}).`)
        cells.splice(edit.cell, 1)
      } else {
        if (edit.at < 0 || edit.at > cells.length) throw new DocError('PARSE_FAILED', `Insert position ${edit.at} out of range (0..${cells.length}).`)
        cells.splice(edit.at, 0, ...edit.cells.map(toCell))
      }
    }
  } else {
    cells = spec.cells.map(toCell)
  }

  const notebook = {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: { kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' }, language_info: { name: 'python', version: '3.x' } },
    cells,
  }
  return new TextEncoder().encode(JSON.stringify(notebook, null, 1))
}

/** Read back the source of a notebook (used by tests and by edit verification). */
export function readIpynbSources(data: Uint8Array): string[] {
  let nb: { cells?: NotebookCell[] }
  try {
    nb = JSON.parse(new TextDecoder('utf-8').decode(data)) as { cells?: NotebookCell[] }
  } catch {
    throw new DocError('PARSE_FAILED', 'The notebook is not valid JSON.')
  }
  return (nb.cells ?? []).map(sourceOf)
}
