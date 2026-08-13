import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fileURLToPath as toPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = join(here, '..', '..', '..', 'test', 'fixtures')
const readBin = join(here, '..', 'lib', 'bin', 'read.js')
const writeBin = join(here, '..', 'lib', 'bin', 'write.js')

function run(bin: string, args: string[]): { out: string; code: number } {
  try {
    const out = execFileSync(process.execPath, [bin, ...args], { encoding: 'utf8', timeout: 60000 })
    return { out, code: 0 }
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; status?: number }
    return { out: (e.stdout ?? '') + (e.stderr ?? ''), code: e.status ?? 1 }
  }
}

test('doc-read xlsx renders markdown with refs', () => {
  const { out, code } = run(readBin, [join(fixtures, 'sample.xlsx')])
  assert.equal(code, 0)
  assert.ok(out.includes('| A2 | Widget |'))
  assert.ok(out.includes('## Sheet: Data'))
})

test('doc-read ipynb with --json', () => {
  const { out, code } = run(readBin, [join(fixtures, 'sample.ipynb'), '--json'])
  assert.equal(code, 0)
  const parsed = JSON.parse(out) as { format: string; ipynb?: { cells: unknown[] } }
  assert.equal(parsed.format, 'ipynb')
  assert.ok(parsed.ipynb!.cells.length === 3)
})

test('doc-read missing file exits non-zero', () => {
  const { code } = run(readBin, [join(fixtures, 'nope.xlsx')])
  assert.notEqual(code, 0)
})

test('doc-write create xlsx then doc-read it back', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cowork-cli-'))
  try {
    const spec = join(dir, 'spec.json')
    writeFileSync(spec, JSON.stringify({ sheets: [{ name: 'S1', cells: [{ ref: 'A1', value: 'hi' }, { ref: 'B1', value: 7 }] }] }))
    const target = join(dir, 'out.xlsx')
    const w = run(writeBin, ['create', target, 'xlsx', '--spec', spec])
    assert.equal(w.code, 0, w.out)
    const r = run(readBin, [target])
    assert.equal(r.code, 0)
    assert.ok(r.out.includes('| A1 | hi |'))
    assert.ok(r.out.includes('| B1 | 7 |'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('doc-write refuses overwrite without --force', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cowork-cli-'))
  try {
    copyFileSync(join(fixtures, 'sample.xlsx'), join(dir, 'exists.xlsx'))
    const spec = join(dir, 'spec.json')
    writeFileSync(spec, JSON.stringify({ sheets: [{ name: 'S', cells: [] }] }))
    const w = run(writeBin, ['create', join(dir, 'exists.xlsx'), 'xlsx', '--spec', spec])
    assert.notEqual(w.code, 0)
    assert.ok(w.out.includes('--force'))
    const w2 = run(writeBin, ['create', join(dir, 'exists.xlsx'), 'xlsx', '--spec', spec, '--force'])
    assert.equal(w2.code, 0, w2.out)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('doc-write edit xlsx by cell ref', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cowork-cli-'))
  try {
    copyFileSync(join(fixtures, 'sample.xlsx'), join(dir, 'edit.xlsx'))
    const spec = join(dir, 'spec.json')
    writeFileSync(spec, JSON.stringify({ format: 'xlsx', edits: [{ sheet: 'Data', ref: 'A2', value: 'Renamed' }] }))
    const w = run(writeBin, ['edit', join(dir, 'edit.xlsx'), '--spec', spec])
    assert.equal(w.code, 0, w.out)
    const r = run(readBin, [join(dir, 'edit.xlsx')])
    assert.ok(r.out.includes('| A2 | Renamed |'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

void toPath
