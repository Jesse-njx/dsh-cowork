/**
 * ipynb reader — the notebook is plain JSON, so the whole job is bounded
 * windowing of cells + inline outputs. Outputs mirror Claude Code's notebook
 * handling: source and rendered outputs per cell.
 */

import type { CellWindow, DocReadOptions, WindowCaps } from '../types.ts'
import { DocError } from '../safety.ts'

interface Notebook {
  nbformat?: number
  cells?: unknown[]
}

interface NotebookCell {
  cell_type?: string
  source?: string | string[]
  outputs?: Array<{ output_type?: string; text?: string | string[]; data?: Record<string, unknown> }>
}

function asText(v: string | string[] | undefined): string {
  if (v === undefined) return ''
  if (typeof v === 'string') return v
  return v.join('')
}

/** Extract a cell's rendered outputs as bounded text. */
function cellOutputs(cell: NotebookCell): Array<{ type: string; text?: string }> {
  const out: Array<{ type: string; text?: string }> = []
  for (const o of cell.outputs ?? []) {
    const type = o.output_type ?? 'unknown'
    if (type === 'stream' || type === 'display_data' || type === 'execute_result') {
      const text = asText(o.text) || (typeof o.data?.['text/plain'] === 'string' ? o.data['text/plain'] : '')
      if (text.length > 0) out.push({ type, text: text.slice(0, 8000) })
    } else if (type === 'error') {
      out.push({ type, text: asText(o.text) })
    }
  }
  return out
}

export interface IpynbRead {
  format: 'ipynb'
  cells: CellWindow[]
  totalCells: number
}

/**
 * Parse and window an ipynb buffer.
 * @returns windowed cells starting at `options.cell`, plus the total count.
 */
export function readIpynb(data: Uint8Array, options: DocReadOptions, caps: WindowCaps): IpynbRead {
  let notebook: Notebook
  try {
    notebook = JSON.parse(new TextDecoder('utf-8').decode(data)) as Notebook
  } catch {
    throw new DocError('PARSE_FAILED', 'The file is not valid JSON for a Jupyter notebook.')
  }
  if (!Array.isArray(notebook.cells)) {
    throw new DocError('PARSE_FAILED', 'The notebook has no `cells` array; not a valid .ipynb file.')
  }
  const start = Math.max(0, options.cell ?? 0)
  const limit = Math.max(1, options.cells ?? caps.maxCells)
  const shown = Math.min(limit, caps.maxCells)
  const total = notebook.cells.length
  const cells: CellWindow[] = []
  for (let i = start; i < Math.min(total, start + shown); i++) {
    const raw = notebook.cells[i] as NotebookCell | undefined
    if (!raw) continue
    cells.push({
      cell: i,
      type: (['markdown', 'code', 'raw'] as const).includes(raw.cell_type as 'markdown')
        ? (raw.cell_type as 'markdown' | 'code' | 'raw')
        : 'raw',
      source: asText(raw.source),
      outputs: cellOutputs(raw),
    })
  }
  return { format: 'ipynb', cells, totalCells: total }
}
