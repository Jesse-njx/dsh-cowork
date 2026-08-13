/**
 * Markdown rendering of a `DocReadResult` — the shared model-facing text for
 * every adapter (DSH tool render, MCP result, CLI stdout). Enforces the
 * `maxBytes` output budget; exceeding it truncates with an explicit notice
 * (never silently).
 */

import type { DocReadResult, WindowCaps } from '../types.ts'

const MAX_CELL_TEXT = 512

function capText(s: string, budget: { remaining: number }): string {
  if (s.length <= MAX_CELL_TEXT) return s
  return `${s.slice(0, MAX_CELL_TEXT)}…`
}

/** Render a windowed read result to markdown, capped at `maxBytes`. */
export function renderMarkdown(result: DocReadResult, maxBytes: number): string {
  let out = ''
  const push = (s: string): void => {
    if (out.length >= maxBytes) return
    out += s
  }
  const cap = (s: string): string => {
    const budget = maxBytes - out.length
    if (budget <= 0) return ''
    return s.slice(0, Math.min(s.length, budget))
  }

  push(`# ${result.format.toUpperCase()} · ${result.path}\n`)

  if (result.pdf) {
    for (const p of result.pdf.pages) {
      push(`\n## Page ${p.page}/${p.totalPages}\n\n`)
      push(cap(p.text))
      push('\n')
    }
  }

  if (result.xlsx) {
    for (const s of result.xlsx.sheets) {
      push(`\n## Sheet: ${s.sheet} (${s.rows.length} of ${s.totalRows} rows)\n\n`)
      push('| ref | value |\n| --- | --- |\n')
      for (const row of s.rows) {
        if (row.cells.length === 0) continue
        const line = row.cells
          .map((c) => {
            const v = c.value === null ? '' : typeof c.value === 'object' ? c.value.date : capText(String(c.value), { remaining: 0 })
            const f = c.formula ? ` (=${c.formula})` : ''
            return `| ${c.ref} | ${v}${f} |`
          })
          .join('')
        push(cap(line + '\n'))
      }
    }
  }

  if (result.pptx) {
    for (const s of result.pptx.slides) {
      push(`\n## Slide ${s.slide + 1}/${result.pptx.totalSlides ?? '?'}\n\n`)
      for (const shape of s.shapes) {
        push(cap(`- [${shape.shapeId}] ${shape.text}\n`))
      }
    }
  }

  if (result.ipynb) {
    for (const c of result.ipynb.cells) {
      push(`\n## Cell ${c.cell} (${c.type})\n\n`)
      if (c.source) push(cap('```\n' + c.source + '\n```\n'))
      for (const o of c.outputs) {
        if (o.text) push(cap(`\n*output (${o.type}):*\n${o.text}\n`))
      }
    }
  }

  if (result.docx) {
    for (const p of result.docx.paragraphs) {
      push(cap(p + '\n\n'))
    }
    push(`\n*${result.docx.wordCount} words*\n`)
  }

  if (result.notice) {
    push(`\n> ${result.notice}\n`)
  }
  return out
}
