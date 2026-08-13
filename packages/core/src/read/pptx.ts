/**
 * pptx reader — a pptx is a zip of slide XML; we pull the `a:t` text runs
 * ourselves (no dependency) and emit stable per-slide shape ids so edits can
 * target individual shapes.
 */

import JSZip from 'jszip'
import type { DocReadOptions, SlideWindow, WindowCaps } from '../types.ts'
import { DocError } from '../safety.ts'
import { checkZipSafety } from '../safety.ts'
import type { SafetyCaps } from '../types.ts'

export interface PptxRead {
  format: 'pptx'
  slides: SlideWindow[]
  totalSlides: number
  truncated: boolean
}

interface ShapeText {
  shapeId: string
  text: string
}

/** Extract shapeId → text from one slide XML (namespace-agnostic). */
function parseSlideXml(xml: string): ShapeText[] {
  const shapes: ShapeText[] = []
  // Match each <p:sp>...</p:sp> shape block, then pull its a:t runs.
  const spRe = /<p:sp\b[^>]*>([\s\S]*?)<\/p:sp>/g
  const aTRe = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g
  const dec = (s: string): string => s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
  let m: RegExpExecArray | null
  while ((m = spRe.exec(xml)) !== null) {
    const block = m[1] ?? ''
    // Fresh regex per block: a shared `g` regex keeps lastIndex across execs.
    const idMatch = /<p:cNvPr\b[^>]*\bid="([^"]+)"[^>]*>/.exec(block)
    const text = dec([...block.matchAll(aTRe)].map((t) => t[1] ?? '').join('')).replace(/\s+/g, ' ').trim()
    if (text.length > 0) {
      shapes.push({ shapeId: idMatch?.[1] ?? '?', text })
    }
  }
  return shapes
}

/**
 * Read a bounded window of slides from a pptx buffer.
 */
export async function readPptx(
  data: Uint8Array,
  options: DocReadOptions,
  caps: WindowCaps,
  safety: SafetyCaps,
): Promise<PptxRead> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(data)
  } catch (e) {
    throw new DocError('PARSE_FAILED', `Could not open the presentation: ${e instanceof Error ? e.message : String(e)}`)
  }
  checkZipSafety(zip, safety)

  // Collect slide files in numeric order.
  const slideNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)/)?.[1] ?? 0)
      const nb = Number(b.match(/slide(\d+)/)?.[1] ?? 0)
      return na - nb
    })
  if (slideNames.length === 0) {
    throw new DocError('PARSE_FAILED', 'No slides found in the presentation.')
  }
  const start = Math.max(0, options.slide ?? 0)
  const limit = Math.min(Math.max(1, options.slides ?? caps.maxSlides), caps.maxSlides)
  const slides: SlideWindow[] = []
  for (let i = start; i < Math.min(slideNames.length, start + limit); i++) {
    const entry = zip.file(slideNames[i]!)
    if (!entry) continue
    const xml = await entry.async('string')
    slides.push({ slide: i, shapes: parseSlideXml(xml) })
  }
  return {
    format: 'pptx',
    slides,
    totalSlides: slideNames.length,
    truncated: slideNames.length > start + limit,
  }
}
