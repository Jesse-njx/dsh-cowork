/**
 * Binary persistence helpers for the DSH plugin.
 *
 * DSH's `ctx.fs` service is text-only for writes (writeText/editText), so
 * `doc_write` performs the byte-level write itself — but with the same
 * discipline as the built-in write path: temp file + atomic rename, version
 * re-observation after publication, and hard byte caps.
 */

import { createHash, randomUUID } from 'node:crypto'
import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, unlinkSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'

export function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

/**
 * Atomically write bytes: exclusive-create a temp file in the target
 * directory, fsync, then rename over the target. A failure cleans up the temp
 * file and never leaves a partial target.
 */
export function writeFileAtomicBytes(targetPath: string, data: Uint8Array): void {
  const dir = dirname(targetPath)
  mkdirSync(dir, { recursive: true })
  const tmp = `${targetPath}.dsh-cowork-${process.pid}-${randomUUID()}.tmp`
  let fd: number | undefined
  try {
    fd = openSync(tmp, 'wx', 0o644)
    writeSync(fd, data)
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    renameSync(tmp, targetPath)
  } catch (error) {
    if (fd !== undefined) {
      try {
        closeSync(fd)
      } catch {
        // already closed
      }
    }
    try {
      unlinkSync(tmp)
    } catch {
      // temp file never existed or already renamed
    }
    throw error
  }
}
