#!/usr/bin/env node
/**
 * doc-read — CLI front for DSH Cowork's document reading. Pure Node + core,
 * no dependencies beyond @dsh-cowork/core.
 *
 * Usage:
 *   doc-read <file> [--page N] [--pages N] [--sheets a,b] [--row-offset N]
 *             [--rows N] [--slide N] [--slides N] [--cell N] [--cells N]
 *             [--max-bytes N] [--json]
 */

import { readFileSync } from 'node:fs'
import { readDocument, renderMarkdown, DocError, type DocReadOptions } from '@dsh-cowork/core'

function usage(): never {
  console.error(`Usage: doc-read <file> [options]
  --page N         PDF: 1-based first page
  --pages N        PDF: max pages
  --sheets a,b     xlsx: sheet names
  --row-offset N   xlsx: 1-based first row
  --rows N         xlsx: max rows per sheet
  --slide N        pptx: 0-based first slide
  --slides N       pptx: max slides
  --cell N         ipynb: 0-based first cell
  --cells N        ipynb: max cells
  --max-bytes N    output byte budget (default 262144)
  --json           print the structured window as JSON instead of markdown`)
  process.exit(2)
}

function numArg(args: string[], name: string): number | undefined {
  const i = args.indexOf(name)
  if (i === -1) return undefined
  const v = Number(args[i + 1])
  if (!Number.isFinite(v)) usage()
  return v
}

function main(): void {
  const args = process.argv.slice(2)
  const file = args.find((a) => !a.startsWith('--'))
  if (!file) usage()

  const options: DocReadOptions = {}
  const page = numArg(args, '--page')
  const pages = numArg(args, '--pages')
  const rowOffset = numArg(args, '--row-offset')
  const rows = numArg(args, '--rows')
  const slide = numArg(args, '--slide')
  const slides = numArg(args, '--slides')
  const cell = numArg(args, '--cell')
  const cells = numArg(args, '--cells')
  const maxBytes = numArg(args, '--max-bytes') ?? 256 * 1024
  if (page !== undefined) options.page = page
  if (pages !== undefined) options.pages = pages
  if (rowOffset !== undefined) options.rowOffset = rowOffset
  if (rows !== undefined) options.rows = rows
  if (slide !== undefined) options.slide = slide
  if (slides !== undefined) options.slides = slides
  if (cell !== undefined) options.cell = cell
  if (cells !== undefined) options.cells = cells
  const i = args.indexOf('--sheets')
  if (i !== -1) options.sheets = String(args[i + 1] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const asJson = args.includes('--json')

  let data: Uint8Array
  try {
    data = new Uint8Array(readFileSync(file))
  } catch (error) {
    console.error(`doc-read: cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }

  readDocument({ data, path: file, options })
    .then((result) => {
      if (asJson) {
        console.log(JSON.stringify(result, null, 2))
      } else {
        process.stdout.write(renderMarkdown(result, maxBytes))
        process.stdout.write('\n')
      }
    })
    .catch((error: unknown) => {
      const msg = error instanceof DocError ? `doc-read: ${error.message}` : error instanceof Error ? error.message : String(error)
      console.error(msg)
      process.exit(1)
    })
}

main()
